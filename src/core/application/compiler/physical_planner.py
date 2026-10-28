"""Compilador de Plano Físico (PhysicalPlanner).

Mapeia operadores lógicos otimizados para nós de execução concretos,
selecionando a engine de runtime adequada (DuckDB vs Polars) e configurando chunking.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List

from src.core.application.compiler.operators import (
    AggregateOperator,
    LogicalBarrier,
    LogicalFilter,
    LogicalJoin,
    LogicalProject,
    LogicalScan,
    LogicalSink,
)
from src.core.application.compiler.optimizer import OptimizedPlan


@dataclass
class PhysicalOperator:
    """Nó de execução concreto associado a uma engine física de runtime."""
    id: str
    operator_type: str
    engine: str  # "duckdb" ou "polars"
    input_ids: List[str] = field(default_factory=list)
    config: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o operador físico em formato canônico."""
        return {
            "id": self.id,
            "type": self.operator_type,
            "engine": self.engine,
            "inputs": self.input_ids,
            "config": self.config
        }


@dataclass
class PhysicalPlan:
    """Plano de execução físico executável pelo worker."""
    pipeline_id: str
    operators: Dict[str, PhysicalOperator] = field(default_factory=dict)
    execution_order: List[str] = field(default_factory=list)
    default_chunk_size: int = 10000

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o plano físico completo."""
        return {
            "pipeline_id": self.pipeline_id,
            "default_chunk_size": self.default_chunk_size,
            "execution_order": self.execution_order,
            "operators": {
                op_id: op.to_dict()
                for op_id, op in sorted(self.operators.items())
            }
        }


class PhysicalPlanner:
    """Serviço de compilação do plano físico a partir do plano otimizado."""

    def compile(self, optimized_plan: OptimizedPlan, default_chunk_size: int = 10000) -> PhysicalPlan:
        """Gera o PhysicalPlan com seleção de engines e parâmetros de buffer/chunks."""
        logical_plan = optimized_plan.plan
        physical_operators: Dict[str, PhysicalOperator] = {}

        # Determina se há nós relacionais complexos (ex: joins) que favorecem DuckDB
        has_relational_join = any(
            isinstance(op, LogicalJoin)
            for op in logical_plan.operators.values()
        )

        for op_id in logical_plan.execution_order:
            logical_op = logical_plan.operators[op_id]
            engine = self._select_engine(logical_op, has_relational_join)

            phys_op = PhysicalOperator(
                id=op_id,
                operator_type=logical_op.operator_type,
                engine=engine,
                input_ids=list(logical_op.input_ids),
                config=logical_op.to_dict()
            )
            physical_operators[op_id] = phys_op

        return PhysicalPlan(
            pipeline_id=optimized_plan.pipeline_id,
            operators=physical_operators,
            execution_order=list(logical_plan.execution_order),
            default_chunk_size=default_chunk_size
        )

    def _select_engine(self, op: Any, has_relational_join: bool) -> str:
        """Regra determinística de seleção de engine (ADR-010)."""
        # Joins, Agregações, DuckDB e tMap utilizam o motor DuckDB
        if isinstance(op, (LogicalJoin, AggregateOperator)) or getattr(op, "operator_type", None) == "aggregate":
            return "duckdb"

        if isinstance(op, LogicalBarrier) or getattr(op, "operator_type", None) == "barrier":
            return "duckdb"

        # Leitura e escrita PostgreSQL e DuckDB utilizam DuckDB
        if isinstance(op, (LogicalScan, LogicalSink)) and (op.format in ("postgres", "duckdb") or getattr(op, "enable_duckdb_view", False)):
            return "duckdb"

        # Se há joins relacionais no pipeline, manter nós intermediários em DuckDB para evitar conversões
        if has_relational_join:
            return "duckdb"

        # Leitura/escrita de arquivos (CSV, Parquet) e transformações de colunas/filtros em streaming
        if isinstance(op, (LogicalScan, LogicalSink)) and op.format in {"csv", "parquet", "json", "excel"}:
            return "polars"

        if isinstance(op, (LogicalFilter, LogicalProject)):
            return "polars"

        return "duckdb"

