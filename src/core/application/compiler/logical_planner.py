from collections import defaultdict, deque
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from src.core.application.compiler.operators import (
    AggregateField,
    AggregateOperator,
    FilterCondition,
    FilterOperator,
    LogicalBarrier,
    LogicalFilter,
    LogicalJoin,
    LogicalOperator,
    LogicalProject,
    LogicalScan,
    LogicalSink,
    LogicalTMap,
)
from src.core.application.compiler.validator import ValidationReport
from src.core.application.security.masking import (
    MaskingRule,
    build_masked_projection_sql,
    extract_masking_rules,
    get_sql_masking_expression,
)
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import DomainValidationError


TEMPLATE_TOKEN_REGEX = re.compile(

    r"\{\{\s*([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_]+)\s*\}\}"
    r"|\{\s*([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_]+)\s*\}"
    r"|\{\{\s*([a-zA-Z0-9_]+)\s*\}\}"
    r"|\{\s*([a-zA-Z0-9_]+)\s*\}"
)


def extract_parameter_tokens(text: str) -> List[Dict[str, str]]:
    """Extrai referências a variáveis {{node.col}}, {{row.col}}, {{col}}, {node.col}, {row.col}, {col}."""
    if not text or not isinstance(text, str):
        return []
    tokens = []
    seen = set()
    for match in TEMPLATE_TOKEN_REGEX.finditer(text):
        raw_token = match.group(0)
        if raw_token in seen:
            continue
        seen.add(raw_token)
        if match.group(1) and match.group(2):
            node_ref, col_name = match.group(1), match.group(2)
        elif match.group(3) and match.group(4):
            node_ref, col_name = match.group(3), match.group(4)
        elif match.group(5):
            node_ref, col_name = "row", match.group(5)
        elif match.group(6):
            node_ref, col_name = "row", match.group(6)
        else:
            continue
        tokens.append({
            "node_ref": node_ref,
            "column_name": col_name,
            "raw_token": raw_token
        })
    return tokens


@dataclass
class LogicalPlan:
    """Representação canônica do plano lógico compilado."""
    pipeline_id: str
    operators: Dict[str, LogicalOperator] = field(default_factory=dict)
    execution_order: List[str] = field(default_factory=list)
    iterator_edges: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o plano lógico em formato canônico estruturado."""
        return {
            "pipeline_id": self.pipeline_id,
            "execution_order": self.execution_order,
            "iterator_edges": self.iterator_edges,
            "operators": {
                op_id: op.to_dict()
                for op_id, op in sorted(self.operators.items())
            }
        }


class LogicalPlanner:
    """Serviço de compilação do plano lógico a partir de um draft validado."""

    def compile(self, draft: PipelineDraft, validation_report: ValidationReport) -> LogicalPlan:
        """Gera o LogicalPlan obedecendo à ordem topológica validada."""
        if not validation_report.is_valid:
            raise DomainValidationError(
                f"Não é possível compilar plano lógico para draft inválido. Erros: {validation_report.errors}"
            )

        operators: Dict[str, LogicalOperator] = {}

        for node_id in validation_report.topological_order:
            node = draft.nodes[node_id]

            # Para tMap, tenta inferir main_alias se não estiver explícito no config
            if node.component_type in ("core.tmap", "transform.tmap", "processor.tmap", "tmap"):
                if not node.config.get("main_alias"):
                    for edge in draft.edges.values():
                        if edge.to_port.node_id == node_id and edge.to_port.port_name in ("main", "main_in", "in", ""):
                            flow_alias = getattr(edge, "data", {}).get("flowName") if hasattr(edge, "data") and isinstance(edge.data, dict) else None
                            from_port = edge.from_port.port_name
                            inferred = flow_alias or (from_port if from_port not in ("output", "out", "dataset", "main", "main_out") else None)
                            if inferred:
                                node.config["main_alias"] = inferred
                                break

            # Descobre quais nós e portas alimentam as portas deste nó
            input_operator_ids = [
                f"{edge.from_port.node_id}:{edge.from_port.port_name}"
                if (edge.from_port.port_name and edge.from_port.port_name not in ("main", "main_out", "dataset", "output", "out"))
                else edge.from_port.node_id
                for edge in draft.edges.values()
                if edge.to_port.node_id == node_id
            ]

            op = self._map_node_to_operator(node_id, node.component_type, node.config, input_operator_ids)
            operators[node_id] = op

        return LogicalPlan(
            pipeline_id=draft.id,
            operators=operators,
            execution_order=list(validation_report.topological_order),
            iterator_edges=list(getattr(validation_report, "iterator_edges", []))
        )

    def find_upstream_ancestors(self, draft: PipelineDraft, target_node_id: str) -> Set[str]:
        """Realiza travessia reversa (upstream BFS) a partir do nó alvo coletando todos os nós ancestrais obrigatórios."""
        if target_node_id not in draft.nodes:
            raise DomainValidationError(f"Nó alvo '{target_node_id}' não existe no pipeline")

        ancestors: Set[str] = {target_node_id}
        queue: deque[str] = deque([target_node_id])

        # Mapeia arestas de entrada para cada nó (to_node -> list[from_node])
        incoming: Dict[str, List[str]] = defaultdict(list)
        for edge in draft.edges.values():
            incoming[edge.to_port.node_id].append(edge.from_port.node_id)

        while queue:
            curr = queue.popleft()
            for src in incoming[curr]:
                if src not in ancestors:
                    ancestors.add(src)
                    queue.append(src)

        return ancestors

    def build_subdag(
        self,
        draft: PipelineDraft,
        target_node_id: str,
        validation_report: Optional[ValidationReport] = None
    ) -> LogicalPlan:
        """Realiza a poda de DAG (Sub-DAG Pruning) compilando apenas os nós a montante necessários (RF-02.2)."""
        ancestors = self.find_upstream_ancestors(draft, target_node_id)

        # Obtém a ordenação topológica do grafo
        if validation_report and validation_report.is_valid:
            full_order = validation_report.topological_order
        else:
            from src.core.application.compiler.validator import GraphValidator
            report = GraphValidator().validate(draft)
            if not report.is_valid:
                # Se houver nós inválidos, mas eles estiverem FORA do sub-DAG de ancestrais, valida apenas o subgrafo
                # Cria sub-draft isolado para validação
                sub_draft = PipelineDraft(
                    id=f"{draft.id}_sub_{target_node_id}",
                    project_id=draft.project_id,
                    name=f"{draft.name} (Sub-DAG {target_node_id})",
                    revision=draft.revision
                )
                for nid in ancestors:
                    sub_draft.nodes[nid] = draft.nodes[nid]
                for eid, e in draft.edges.items():
                    if e.from_port.node_id in ancestors and e.to_port.node_id in ancestors:
                        sub_draft.edges[eid] = e
                sub_report = GraphValidator().validate(sub_draft)
                if not sub_report.is_valid:
                    raise DomainValidationError(
                        f"Não é possível podar sub-DAG inválido para o nó '{target_node_id}'. Erros: {sub_report.errors}"
                    )
                full_order = sub_report.topological_order
            else:
                full_order = report.topological_order

        # Filtra a ordem topológica mantendo apenas os ancestrais obrigatórios
        subdag_order = [n_id for n_id in full_order if n_id in ancestors]
        if target_node_id not in subdag_order:
            subdag_order.append(target_node_id)

        operators: Dict[str, LogicalOperator] = {}

        for node_id in subdag_order:
            node = draft.nodes[node_id]

            # Para tMap, tenta inferir main_alias se não estiver explícito no config
            if node.component_type in ("core.tmap", "transform.tmap", "processor.tmap", "tmap"):
                if not node.config.get("main_alias"):
                    for edge in draft.edges.values():
                        if edge.to_port.node_id == node_id and edge.to_port.port_name in ("main", "main_in", "in", ""):
                            flow_alias = getattr(edge, "data", {}).get("flowName") if hasattr(edge, "data") and isinstance(edge.data, dict) else None
                            from_port = edge.from_port.port_name
                            inferred = flow_alias or (from_port if from_port not in ("output", "out", "dataset", "main", "main_out") else None)
                            if inferred:
                                node.config["main_alias"] = inferred
                                break

            # Descobre quais nós e portas alimentam este nó (restringido aos nós no sub-DAG)
            input_operator_ids = [
                f"{edge.from_port.node_id}:{edge.from_port.port_name}"
                if (edge.from_port.port_name and edge.from_port.port_name not in ("main", "main_out", "dataset", "output", "out"))
                else edge.from_port.node_id
                for edge in draft.edges.values()
                if edge.to_port.node_id == node_id and edge.from_port.node_id in ancestors
            ]

            op = self._map_node_to_operator(node_id, node.component_type, node.config, input_operator_ids)
            operators[node_id] = op

        return LogicalPlan(
            pipeline_id=draft.id,
            operators=operators,
            execution_order=subdag_order,
            iterator_edges=[
                e.id for e in draft.edges.values()
                if e.from_port.node_id in ancestors and e.to_port.node_id in ancestors and getattr(e, "is_iterator", False)
            ]
        )

    def inject_sql_masking(self, query: str, rules: List[Dict[str, Any]]) -> str:
        """Injeta funções SQL escalares de mascaramento em uma consulta ou projeção SQL."""
        if not rules:
            return query
        mask_rules = [
            MaskingRule(
                column_name=r["column_name"],
                masking_type=r["masking_type"],
                salt=r.get("salt"),
                custom_value=r.get("custom_value")
            ) if isinstance(r, dict) else r
            for r in rules
        ]
        cols = [r.column_name for r in mask_rules]
        return f"SELECT {build_masked_projection_sql(cols, mask_rules)} FROM ({query}) AS _sub"

    def _map_node_to_operator(
        self,
        node_id: str,
        component_type: str,
        config: Dict[str, Any],
        input_ids: List[str]
    ) -> LogicalOperator:
        """Mapeia o tipo de componente e sua configuração para o operador algébrico correspondente."""
        cfg = dict(config or {})
        extracted_rules = extract_masking_rules(cfg)
        if extracted_rules:
            cfg["masking_rules"] = extracted_rules

        # DuckDB Source Dedicado

        if component_type in ("connector.db.duckdb", "core.duckdb.source"):
            query = cfg.get("query") or ""
            tokens = extract_parameter_tokens(query)
            conn_details = cfg.get("connection_details") or {}
            db_path = conn_details.get("database_path") or conn_details.get("database") or cfg.get("database_path") or cfg.get("connection_ref") or ":memory:"
            return LogicalScan(
                id=node_id,
                connection_ref=db_path,
                source_path_or_query=query,
                format="duckdb",
                input_ids=input_ids,
                is_iterative=bool(input_ids) or bool(tokens),
                parameter_tokens=tokens,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Fontes de Banco de Dados (PostgreSQL, Oracle, SQL Server, MySQL, etc.)
        if (
            component_type in ("core.database.source", "connector.db.postgresql")
            or (component_type.startswith("connector.db.") and not component_type.endswith(".output"))
        ):
            fmt = "postgres" if "postgres" in component_type else component_type.replace("connector.db.", "")
            query = cfg.get("query") or cfg.get("source_path_or_query") or cfg.get("source") or ""
            tokens = extract_parameter_tokens(query)
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=query,
                format=fmt,
                input_ids=input_ids,
                is_iterative=bool(input_ids) or bool(tokens),
                parameter_tokens=tokens,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Fontes de Arquivo (CSV, Parquet, JSON, Excel, etc.)
        if component_type.startswith("core.file.source") or component_type == "core.file.source":
            fmt = "csv"
            if ".parquet" in component_type:
                fmt = "parquet"
            elif ".json" in component_type:
                fmt = "json"
            elif ".excel" in component_type:
                fmt = "excel"
            else:
                fmt = cfg.get("format", "csv").lower()

            source_path = cfg.get("path", "")
            tokens = extract_parameter_tokens(source_path) + extract_parameter_tokens(cfg.get("duckdb_query", ""))
            schema_defs = cfg.get("schema_definitions") or []
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=source_path,
                format=fmt,
                input_ids=input_ids,
                is_iterative=bool(input_ids) or bool(tokens),
                parameter_tokens=tokens,
                schema_definitions=schema_defs,
                enable_duckdb_view=bool(cfg.get("enable_duckdb_view", False)),
                duckdb_query=cfg.get("duckdb_query"),
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # tMap Transform
        if component_type in ("core.tmap", "transform.tmap", "processor.tmap", "tmap"):
            main_id = cfg.get("main_input_id") or (input_ids[0] if input_ids else "")
            main_alias = cfg.get("main_alias") or "main"
            return LogicalTMap(
                id=node_id,
                main_input_id=main_id,
                main_alias=str(main_alias).strip() or "main",
                lookups=cfg.get("lookups", []),
                variables=cfg.get("variables", []),
                outputs=cfg.get("outputs", []),
                input_ids=input_ids,
                raw_config=cfg
            )

        if component_type in ("core.filter", "transform.filter", "tFilterRow", "tfilterrow", "filter"):
            conditions = []
            for cond_data in cfg.get("conditions", []):
                if isinstance(cond_data, dict):
                    conditions.append(FilterCondition(
                        column=cond_data.get("column", ""),
                        operator=cond_data.get("operator", "=="),
                        value=cond_data.get("value")
                    ))
                elif isinstance(cond_data, FilterCondition):
                    conditions.append(cond_data)

            return FilterOperator(
                id=node_id,
                conditions=conditions,
                logical_operator=cfg.get("logical_operator") or cfg.get("operator") or "AND",
                predicate=cfg.get("expression") or cfg.get("predicate") or "",
                input_ids=input_ids
            )

        if component_type in ("core.aggregate", "transform.aggregate", "tAggregateRow", "taggregaterow", "aggregate"):
            group_by = cfg.get("group_by") or cfg.get("group_columns") or []
            if isinstance(group_by, str):
                group_by = [c.strip() for c in group_by.split(",") if c.strip()]

            aggregations = []
            for agg_data in (cfg.get("aggregations") or cfg.get("operations") or []):
                if isinstance(agg_data, dict):
                    aggregations.append(AggregateField(
                        column=agg_data.get("column", "*"),
                        function=agg_data.get("function", "COUNT"),
                        alias=agg_data.get("alias"),
                        delimiter=agg_data.get("delimiter", ", ")
                    ))
                elif isinstance(agg_data, AggregateField):
                    aggregations.append(agg_data)

            return AggregateOperator(
                id=node_id,
                group_by=list(group_by),
                aggregations=aggregations,
                input_ids=input_ids
            )

        if component_type == "core.select":
            return LogicalProject(
                id=node_id,
                columns=cfg.get("columns", []),
                input_ids=input_ids
            )

        if component_type == "core.join":
            return LogicalJoin(
                id=node_id,
                join_type=cfg.get("type", "inner"),
                left_keys=cfg.get("left_on", []),
                right_keys=cfg.get("right_on", []),
                input_ids=input_ids
            )

        # DuckDB Target Dedicado
        if component_type in ("connector.db.duckdb.output", "core.duckdb.target"):
            tbl_name = str(cfg.get("table") or cfg.get("target") or "").strip()
            return LogicalSink(
                id=node_id,
                target_ref=tbl_name,
                format="duckdb",
                write_mode=cfg.get("write_mode", "append"),
                table_action=cfg.get("table_action", "none"),
                data_action=cfg.get("data_action", "insert"),
                keys=cfg.get("keys", []),
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Destinos de Banco de Dados (PostgreSQL, MySQL, Oracle, etc.)
        if (
            component_type in ("core.database.target", "connector.db.postgresql.output")
            or (component_type.startswith("connector.db.") and component_type.endswith(".output"))
        ):
            fmt = "postgres" if "postgres" in component_type else "db"
            tbl_name = str(cfg.get("table") or cfg.get("target") or "").strip()
            return LogicalSink(
                id=node_id,
                target_ref=tbl_name,
                format=fmt,
                write_mode=cfg.get("write_mode", "append"),
                table_action=cfg.get("table_action", "none"),
                data_action=cfg.get("data_action", "insert"),
                keys=cfg.get("keys", []),
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Destinos de Arquivo
        if component_type.startswith("core.file.target") or component_type == "core.file.target":
            fmt = cfg.get("format", "csv").lower()
            target_path = (cfg.get("path", "") or cfg.get("target", "") or "").strip().strip('"').strip("'")
            return LogicalSink(
                id=node_id,
                target_ref=target_path,
                format=fmt,
                write_mode=cfg.get("write_mode", "append"),
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Fontes NoSQL & Streaming / Mensageria (ScyllaDB, Kafka, AWS SQS)
        if "scylla" in component_type and not component_type.endswith(".output"):
            tbl = cfg.get("table", "")
            ks = cfg.get("keyspace", "")
            tbl_ref = f"{ks}.{tbl}" if (ks and tbl and "." not in tbl) else tbl
            query = cfg.get("query") or cfg.get("cql") or (f"SELECT * FROM {tbl_ref}" if tbl_ref else "")
            tokens = extract_parameter_tokens(query)
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=query,
                format="scylla",
                input_ids=input_ids,
                is_iterative=bool(input_ids) or bool(tokens),
                parameter_tokens=tokens,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        if "kafka" in component_type and not component_type.endswith(".output"):
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=cfg.get("topic", ""),
                format="kafka",
                input_ids=input_ids,
                is_iterative=bool(input_ids),
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        if ("sqs" in component_type or "aws_sqs" in component_type) and not component_type.endswith(".output"):
            q_target = cfg.get("queue_url") or cfg.get("queue_name") or cfg.get("endpoint", "")
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=q_target,
                format="sqs",
                input_ids=input_ids,
                is_iterative=bool(input_ids),
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        # Destinos NoSQL & Streaming / Mensageria (ScyllaDB, Kafka, AWS SQS, AWS SNS)
        if "scylla" in component_type and component_type.endswith(".output"):
            tbl = cfg.get("table", "")
            ks = cfg.get("keyspace", "")
            target_ref = f"{ks}.{tbl}" if (ks and tbl and "." not in tbl) else (tbl or cfg.get("target", ""))
            return LogicalSink(
                id=node_id,
                target_ref=target_ref,
                format="scylla",
                write_mode=cfg.get("write_mode", "append"),
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        if "kafka" in component_type and component_type.endswith(".output"):
            return LogicalSink(
                id=node_id,
                target_ref=cfg.get("topic", ""),
                format="kafka",
                write_mode="append",
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        if ("sqs" in component_type or "aws_sqs" in component_type) and component_type.endswith(".output"):
            q_target = cfg.get("queue_url") or cfg.get("queue_name") or cfg.get("endpoint", "")
            return LogicalSink(
                id=node_id,
                target_ref=q_target,
                format="sqs",
                write_mode="append",
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )

        if "sns" in component_type or "aws_sns" in component_type:
            t_arn = cfg.get("topic_arn") or cfg.get("endpoint", "")
            return LogicalSink(
                id=node_id,
                target_ref=t_arn,
                format="sns",
                write_mode="append",
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
            )


        # Controle / Sincronização (Barrier / Wait All)
        if component_type in ("control.sync", "control.barrier"):
            return LogicalBarrier(
                id=node_id,
                input_ids=input_ids,
                mode=cfg.get("mode", "wait_all"),
                timeout_seconds=int(cfg.get("timeout_seconds") or 0),
                failure_policy=cfg.get("failure_policy", "fail_fast")
            )

        # Fallback para operador genérico
        return LogicalOperator(id=node_id, operator_type=component_type, input_ids=input_ids)

