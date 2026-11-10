"""Entidade e Modelo de Dados para Célula de Pipeline (Multi-Canvas / Python)."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class PipelineCell:
    """Entidade que representa uma célula isolada de processamento (Canvas ou Python)."""
    id: str
    name: str
    order: int = 1
    cell_type: str = "CANVAS"  # "CANVAS" | "PYTHON"
    is_active: bool = True
    is_minimized: bool = False
    description: Optional[str] = None
    code_snippet: Optional[str] = None
    preconditions: List[Dict[str, Any]] = field(default_factory=list)
    precondition_operator: str = "AND"
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa a célula para o JSON canônico do backend."""
        res: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "order": self.order,
            "cell_type": self.cell_type,
            "is_active": self.is_active,
            "is_minimized": self.is_minimized,
            "preconditions": self.preconditions,
            "precondition_operator": self.precondition_operator,
            "nodes": self.nodes,
            "edges": self.edges,
        }
        if self.description:
            res["description"] = self.description
        if self.code_snippet is not None:
            res["code_snippet"] = self.code_snippet
        return res

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PipelineCell":
        """Instancia uma PipelineCell a partir de dicionário com valores default seguros."""
        return cls(
            id=data.get("id") or data.get("name", "cell"),
            name=data.get("name") or data.get("id", "cell"),
            order=int(data.get("order", 1)),
            cell_type=data.get("cell_type") or data.get("cellType", "CANVAS"),
            is_active=data.get("is_active", True) if data.get("is_active") is not None else True,
            is_minimized=bool(data.get("is_minimized", False)),
            description=data.get("description"),
            code_snippet=data.get("code_snippet") or data.get("codeSnippet"),
            preconditions=data.get("preconditions") or [],
            precondition_operator=data.get("precondition_operator") or data.get("preconditionOperator", "AND"),
            nodes=data.get("nodes") or [],
            edges=data.get("edges") or [],
        )
