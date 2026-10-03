"""Compilador de Plano Lógico (LogicalPlanner).

Transforma o grafo visual validado em uma estrutura de operadores lógicos relacionais.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List

from src.core.application.compiler.operators import (
    LogicalFilter,
    LogicalJoin,
    LogicalOperator,
    LogicalProject,
    LogicalScan,
    LogicalSink,
)
from src.core.application.compiler.validator import ValidationReport
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import DomainValidationError


@dataclass
class LogicalPlan:
    """Representação canônica do plano lógico compilado."""
    pipeline_id: str
    operators: Dict[str, LogicalOperator] = field(default_factory=dict)
    execution_order: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o plano lógico em formato canônico estruturado."""
        return {
            "pipeline_id": self.pipeline_id,
            "execution_order": self.execution_order,
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

            # Descobre quais nós alimentam as portas deste nó
            input_operator_ids = [
                edge.from_port.node_id
                for edge in draft.edges.values()
                if edge.to_port.node_id == node_id
            ]

            op = self._map_node_to_operator(node_id, node.component_type, node.config, input_operator_ids)
            operators[node_id] = op

        return LogicalPlan(
            pipeline_id=draft.id,
            operators=operators,
            execution_order=list(validation_report.topological_order)
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

        # Fontes de Banco de Dados (PostgreSQL, Oracle, SQL Server, MySQL, etc.)
        if (
            component_type in ("core.database.source", "connector.db.postgresql")
            or (component_type.startswith("connector.db.") and not component_type.endswith(".output"))
        ):
            fmt = "postgres" if "postgres" in component_type else component_type.replace("connector.db.", "")
            query = cfg.get("query") or cfg.get("source_path_or_query") or cfg.get("source") or ""
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=query,
                format=fmt,
                input_ids=input_ids,
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
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=cfg.get("path", ""),
                format=fmt,
                input_ids=input_ids,
                connection_details=cfg.get("connection_details"),
                raw_config=cfg
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

        # Destinos de Banco de Dados
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
            return LogicalScan(
                id=node_id,
                connection_ref=cfg.get("connection_ref", ""),
                source_path_or_query=query,
                format="scylla",
                input_ids=input_ids,
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

        # Fallback para operador genérico
        return LogicalOperator(id=node_id, operator_type=component_type, input_ids=input_ids)
