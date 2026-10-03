"""Classe base para regras de otimização do compilador."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from src.core.application.compiler.logical_planner import LogicalPlan


@dataclass
class OptimizationDetail:
    """Registro auditável e explicável de uma regra de otimização aplicada."""
    rule_name: str
    description: str
    affected_nodes: List[str]


class OptimizationRule(ABC):
    """Interface abstrata para regras de transformação algébrica de planos."""

    @abstractmethod
    def apply(
        self,
        plan: LogicalPlan,
        capabilities: Dict[str, Dict[str, bool]]
    ) -> Tuple[LogicalPlan, List[OptimizationDetail]]:
        """Aplica a regra de otimização preservando estritamente a semântica."""
        pass
