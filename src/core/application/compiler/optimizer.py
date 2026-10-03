"""Otimizador de Plano (PlanOptimizer).

Transforma o plano lógico em plano otimizado através de regras que preservam semântica.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.core.application.compiler.logical_planner import LogicalPlan
from src.core.application.compiler.rules.base import OptimizationDetail, OptimizationRule
from src.core.application.compiler.rules.pushdown import (
    FilterPushdownRule,
    ProjectionPushdownRule,
)


@dataclass
class OptimizedPlan:
    """Representação do plano após transformações e otimizações semânticas."""
    pipeline_id: str
    plan: LogicalPlan
    optimizations: List[OptimizationDetail] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o plano otimizado com justificativas explicáveis."""
        return {
            "pipeline_id": self.pipeline_id,
            "logical_plan": self.plan.to_dict(),
            "optimizations_applied": [
                {
                    "rule": opt.rule_name,
                    "description": opt.description,
                    "affected_nodes": opt.affected_nodes
                }
                for opt in self.optimizations
            ]
        }


class PlanOptimizer:
    """Serviço de otimização de planos lógicos."""

    def __init__(self, rules: Optional[List[OptimizationRule]] = None):
        self.rules: List[OptimizationRule] = rules or [
            FilterPushdownRule(),
            ProjectionPushdownRule()
        ]

    def optimize(
        self,
        logical_plan: LogicalPlan,
        capabilities: Optional[Dict[str, Dict[str, bool]]] = None
    ) -> OptimizedPlan:
        """Executa a sequência de regras de otimização preservando semântica."""
        caps = capabilities or {}
        all_optimizations: List[OptimizationDetail] = []
        current_plan = logical_plan

        for rule in self.rules:
            current_plan, details = rule.apply(current_plan, caps)
            all_optimizations.extend(details)

        return OptimizedPlan(
            pipeline_id=logical_plan.pipeline_id,
            plan=current_plan,
            optimizations=all_optimizations
        )
