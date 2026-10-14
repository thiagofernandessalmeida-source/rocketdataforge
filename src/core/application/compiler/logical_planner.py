import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.core.application.compiler.operators import (
    LogicalFilter,
    LogicalJoin,
    LogicalOperator,
    LogicalProject,
    LogicalScan,
    LogicalSink,
    LogicalTMap,
)
from src.core.application.compiler.validator import ValidationReport
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

    def _map_node_to_operator(
        self,
        node_id: str,
        component_type: str,
        config: Dict[str, Any],
        input_ids: List[str]
    ) -> LogicalOperator:
        """Mapeia o tipo de componente e sua configuração para o operador algébrico correspondente."""
        cfg = config or {}

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
            return LogicalTMap(
                id=node_id,
                main_input_id=input_ids[0] if input_ids else "",
                lookups=cfg.get("lookups", []),
                variables=cfg.get("variables", []),
                outputs=cfg.get("outputs", []),
                input_ids=input_ids
            )

        if component_type == "core.filter":
            return LogicalFilter(
                id=node_id,
                predicate=cfg.get("expression", ""),
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
            return LogicalSink(
                id=node_id,
                target_ref=cfg.get("table", ""),
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
            return LogicalSink(
                id=node_id,
                target_ref=cfg.get("table", ""),
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
            query = cfg.get("query") or cfg.get("cql") or (f"SELECT * FROM {cfg.get('table')}" if cfg.get("table") else "")
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
            return LogicalSink(
                id=node_id,
                target_ref=cfg.get("table", ""),
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

        # Transformações tMap
        if component_type in ("core.tmap", "transform.tmap"):
            return LogicalTMap(
                id=node_id,
                main_input_id=cfg.get("main_input_id") or (input_ids[0] if input_ids else ""),
                lookups=cfg.get("lookups", []),
                variables=cfg.get("variables", []),
                outputs=cfg.get("outputs", []),
                input_ids=input_ids
            )

        # Fallback para operador genérico
        return LogicalOperator(id=node_id, operator_type=component_type, input_ids=input_ids)

