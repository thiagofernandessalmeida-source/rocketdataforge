"""Entidade Edge do Pipeline.

Representa uma aresta direcionada entre duas portas de nós distintos.
"""

from dataclasses import dataclass

from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import PortId


@dataclass(frozen=True)
class Edge:
    """Aresta direcionada conectando porta de saída à porta de entrada."""
    id: str
    from_port: PortId
    to_port: PortId

    def __post_init__(self) -> None:
        if not self.id or not self.id.strip():
            raise DomainValidationError("Edge id não pode ser vazio")
        if self.from_port.node_id == self.to_port.node_id:
            raise DomainValidationError(
                f"Auto-conexão inválida no nó '{self.from_port.node_id}'. Conexão de nó para si mesmo é proibida."
            )

    @classmethod
    def create(cls, from_port: PortId, to_port: PortId) -> "Edge":
        edge_id = f"{from_port.node_id}:{from_port.port_name}->{to_port.node_id}:{to_port.port_name}"
        return cls(id=edge_id, from_port=from_port, to_port=to_port)
