"""Entidade Node do Pipeline.

Representa uma instância configurada de um componente funcional no grafo.
"""

from dataclasses import dataclass, field
from typing import Any, Dict

from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import SemanticVersion


@dataclass
class Node:
    """Nó do pipeline funcional."""
    id: str
    component_type: str
    component_version: SemanticVersion
    config: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id or not self.id.strip():
            raise DomainValidationError("Node id não pode ser vazio")
        if not self.component_type or not self.component_type.strip():
            raise DomainValidationError("Node component_type não pode ser vazio")

    def update_config(self, new_config: Dict[str, Any]) -> None:
        """Atualiza o dicionário de configurações do nó."""
        if not isinstance(new_config, dict):
            raise DomainValidationError("A configuração do nó deve ser um dicionário")
        self.config = new_config.copy()
