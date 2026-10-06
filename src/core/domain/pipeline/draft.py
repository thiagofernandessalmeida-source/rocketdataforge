"""Agregado PipelineDraft.

Root aggregate responsável pelo grafo funcional editável de um pipeline.
Não contém referências a coordenadas visuais (layout.json).
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.core.domain.pipeline.edge import Edge
from src.core.domain.pipeline.node import Node
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import PortId, SemanticVersion


@dataclass
class PipelineDraft:
    """Aggregate Root para edição de pipeline funcional."""
    id: str
    project_id: str
    name: str
    description: Optional[str] = None
    revision: int = 1
    nodes: Dict[str, Node] = field(default_factory=dict)
    edges: Dict[str, Edge] = field(default_factory=dict)
    parameters: Dict[str, Any] = field(default_factory=dict)
    cells: List[Dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.id or not self.id.strip():
            raise DomainValidationError("PipelineDraft id não pode ser vazio")
        if not self.project_id or not self.project_id.strip():
            raise DomainValidationError("PipelineDraft project_id não pode ser vazio")
        if not self.name or not self.name.strip():
            raise DomainValidationError("PipelineDraft name não pode ser vazio")
        if self.revision < 1:
            raise DomainValidationError("Revision deve ser um inteiro positivo maior ou igual a 1")

    def add_node(
        self,
        node_id: str,
        component_type: str,
        component_version: SemanticVersion,
        config: Optional[Dict[str, Any]] = None
    ) -> Node:
        """Adiciona um novo nó ao draft."""
        if node_id in self.nodes:
            raise DomainValidationError(f"Nó com id '{node_id}' já existe no pipeline draft")

        node = Node(
            id=node_id,
            component_type=component_type,
            component_version=component_version,
            config=config or {}
        )
        self.nodes[node_id] = node
        self._increment_revision()
        return node

    def remove_node(self, node_id: str) -> None:
        """Remove um nó e todas as arestas conectadas a ele."""
        if node_id not in self.nodes:
            raise DomainValidationError(f"Nó com id '{node_id}' não encontrado no pipeline draft")

        # Deleta arestas conectadas a este nó
        edges_to_remove = [
            edge_id for edge_id, edge in self.edges.items()
            if edge.from_port.node_id == node_id or edge.to_port.node_id == node_id
        ]
        for edge_id in edges_to_remove:
            del self.edges[edge_id]

        del self.nodes[node_id]
        self._increment_revision()

    def connect_ports(self, from_port: PortId, to_port: PortId) -> Edge:
        """Cria uma conexão entre duas portas compatíveis."""
        if from_port.node_id not in self.nodes:
            raise DomainValidationError(f"Nó de origem '{from_port.node_id}' não existe no draft")
        if to_port.node_id not in self.nodes:
            raise DomainValidationError(f"Nó de destino '{to_port.node_id}' não existe no draft")

        # Invariante: uma porta de entrada recebe no máximo uma conexão
        for edge in self.edges.values():
            if edge.to_port == to_port:
                raise DomainValidationError(
                    f"A porta de entrada '{to_port}' já está conectada pela aresta '{edge.id}'"
                )

        edge = Edge.create(from_port=from_port, to_port=to_port)
        if edge.id in self.edges:
            raise DomainValidationError(f"A aresta '{edge.id}' já existe no pipeline draft")

        self.edges[edge.id] = edge
        self._increment_revision()
        return edge

    def disconnect_edge(self, edge_id: str) -> None:
        """Remove uma aresta existente."""
        if edge_id not in self.edges:
            raise DomainValidationError(f"Aresta com id '{edge_id}' não encontrada")
        del self.edges[edge_id]
        self._increment_revision()

    def configure_node(self, node_id: str, new_config: Dict[str, Any]) -> None:
        """Atualiza a configuração de um nó existente."""
        if node_id not in self.nodes:
            raise DomainValidationError(f"Nó com id '{node_id}' não encontrado")
        self.nodes[node_id].update_config(new_config)
        self._increment_revision()

    def to_canonical_dict(self) -> Dict[str, Any]:
        """Gera a representação de dicionário canônica ordenada da lógica funcional.
        
        Estritamente excludes layout visual.
        """
        sorted_nodes = sorted(
            [
                {
                    "id": n.id,
                    "component": {
                        "type": n.component_type,
                        "version": str(n.component_version)
                    },
                    "config": dict(sorted(n.config.items()))
                }
                for n in self.nodes.values()
            ],
            key=lambda x: x["id"]
        )

        sorted_edges = sorted(
            [
                {
                    "id": e.id,
                    "from": str(e.from_port),
                    "to": str(e.to_port)
                }
                for e in self.edges.values()
            ],
            key=lambda x: x["id"]
        )

        result = {
            "schemaVersion": "rdf.pipeline/v1",
            "kind": "Pipeline",
            "metadata": {
                "id": self.id,
                "name": self.name,
                "description": self.description or ""
            },
            "spec": {
                "parameters": dict(sorted(self.parameters.items())),
                "nodes": sorted_nodes,
                "edges": sorted_edges
            }
        }
        if self.cells:
            result["spec"]["cells"] = self.cells
        return result

    def _increment_revision(self) -> None:
        self.revision += 1
