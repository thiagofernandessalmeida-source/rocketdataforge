"""Regras de Otimização: Pushdown de Filtro e Projeção orientadas por Capabilities."""

from typing import Dict, List, Tuple

from src.core.application.compiler.logical_planner import LogicalPlan
from src.core.application.compiler.operators import LogicalFilter, LogicalProject, LogicalScan
from src.core.application.compiler.rules.base import OptimizationDetail, OptimizationRule


class FilterPushdownRule(OptimizationRule):
    """Empurra predicados de nós LogicalFilter para a query ou scan da fonte."""

    def apply(
        self,
        plan: LogicalPlan,
        capabilities: Dict[str, Dict[str, bool]]
    ) -> Tuple[LogicalPlan, List[OptimizationDetail]]:
        details: List[OptimizationDetail] = []

        for op_id, op in plan.operators.items():
            if isinstance(op, LogicalFilter) and len(op.input_ids) == 1:
                input_id = op.input_ids[0]
                input_op = plan.operators.get(input_id)

                if isinstance(input_op, LogicalScan):
                    node_caps = capabilities.get(input_id, {})
                    # PostgreSQL ou conectores com capability explícita
                    if node_caps.get("supports_filter_pushdown", False) or input_op.format == "postgres":
                        existing_filter = input_op.pushed_filter
                        new_filter = f"({existing_filter}) AND ({op.predicate})" if existing_filter else op.predicate
                        input_op.pushed_filter = new_filter

                        details.append(OptimizationDetail(
                            rule_name="FilterPushdownRule",
                            description=f"Predicado de filtro '{op.predicate}' empurrado para a fonte '{input_id}'.",
                            affected_nodes=[input_id, op_id]
                        ))

        return plan, details


class ProjectionPushdownRule(OptimizationRule):
    """Empurra a seleção de colunas de um LogicalProject através de filtros até o Scan da fonte."""

    def apply(
        self,
        plan: LogicalPlan,
        capabilities: Dict[str, Dict[str, bool]]
    ) -> Tuple[LogicalPlan, List[OptimizationDetail]]:
        details: List[OptimizationDetail] = []

        for op_id, op in plan.operators.items():
            if isinstance(op, LogicalProject) and len(op.input_ids) == 1:
                # Navega upstream através de filtros unários até o Scan de origem
                current_id = op.input_ids[0]
                while current_id:
                    current_op = plan.operators.get(current_id)
                    if isinstance(current_op, LogicalScan):
                        node_caps = capabilities.get(current_id, {})
                        if node_caps.get("supports_projection_pushdown", True) or current_op.format in {"postgres", "parquet", "csv"}:
                            current_op.projected_columns = list(op.columns)
                            details.append(OptimizationDetail(
                                rule_name="ProjectionPushdownRule",
                                description=f"Projeção das colunas {op.columns} empurrada para a fonte '{current_id}'.",
                                affected_nodes=[current_id, op_id]
                            ))
                        break
                    elif isinstance(current_op, LogicalFilter) and len(current_op.input_ids) == 1:
                        current_id = current_op.input_ids[0]
                    else:
                        break

        return plan, details
