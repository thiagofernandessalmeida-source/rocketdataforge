"""Validador de Grafos de Pipeline (GraphValidator).

Aplica ordenação topológica (Algoritmo de Kahn) para garantir aciclicidade (DAG)
e verifica integridade estrutural de portas e nós.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import CyclicDependencyError, DomainValidationError


@dataclass
class ValidationErrorItem:
    """Item individual de erro de validação."""
    code: str
    message: str
    node_id: Optional[str] = None


@dataclass
class ValidationWarningItem:
    """Item individual de aviso de validação."""
    code: str
    message: str
    node_id: Optional[str] = None


@dataclass
class ValidationReport:
    """Relatório consolidado de validação estrutural do grafo."""
    is_valid: bool
    errors: List[ValidationErrorItem] = field(default_factory=list)
    warnings: List[ValidationWarningItem] = field(default_factory=list)
    topological_order: List[str] = field(default_factory=list)


class GraphValidator:
    """Serviço de validação estrutural e acíclica de pipelines."""

    def validate(self, draft: PipelineDraft) -> ValidationReport:
        """Executa validação completa do draft."""
        errors: List[ValidationErrorItem] = []
        warnings: List[ValidationWarningItem] = []

        if not draft.nodes:
            errors.append(ValidationErrorItem(
                code="ERR_EMPTY_PIPELINE",
                message="O pipeline não possui nós cadastrados."
            ))
            return ValidationReport(is_valid=False, errors=errors)

        # 1. Construir lista de adjacências e graus de entrada para o algoritmo de Kahn
        adj_list: Dict[str, List[str]] = {node_id: [] for node_id in draft.nodes}
        in_degree: Dict[str, int] = {node_id: 0 for node_id in draft.nodes}
        connected_to_ports: Set[str] = set()

        for edge in draft.edges.values():
            from_node = edge.from_port.node_id
            to_node = edge.to_port.node_id

            if from_node not in draft.nodes:
                errors.append(ValidationErrorItem(
                    code="ERR_INVALID_PORT_SOURCE",
                    node_id=from_node,
                    message=f"Nó de origem '{from_node}' na aresta '{edge.id}' não existe."
                ))
            if to_node not in draft.nodes:
                errors.append(ValidationErrorItem(
                    code="ERR_INVALID_PORT_TARGET",
                    node_id=to_node,
                    message=f"Nó de destino '{to_node}' na aresta '{edge.id}' não existe."
                ))

            if from_node in draft.nodes and to_node in draft.nodes:
                adj_list[from_node].append(to_node)
                in_degree[to_node] += 1

                to_port_key = str(edge.to_port)
                if to_port_key in connected_to_ports:
                    errors.append(ValidationErrorItem(
                        code="ERR_DUPLICATE_PORT_CONNECTION",
                        node_id=to_node,
                        message=f"Porta de entrada '{to_port_key}' possui múltiplas conexões."
                    ))
                connected_to_ports.add(to_port_key)

        # Se já houver erros críticos de integridade de nós, interrompe antes de ordenar
        if errors:
            return ValidationReport(is_valid=False, errors=errors, warnings=warnings)

        # 2. Algoritmo de Kahn para Ordenação Topológica e Detecção de Ciclos
        queue = deque([node_id for node_id, degree in in_degree.items() if degree == 0])
        topological_order: List[str] = []

        while queue:
            current = queue.popleft()
            topological_order.append(current)

            for neighbor in adj_list[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Se o número de nós visitados for menor que o total, existe pelo menos um ciclo
        if len(topological_order) < len(draft.nodes):
            cyclic_nodes = [node_id for node_id, deg in in_degree.items() if deg > 0]
            errors.append(ValidationErrorItem(
                code="ERR_CYCLIC_DEPENDENCY",
                message=f"Ciclo detectado no pipeline envolvendo os nós: {', '.join(cyclic_nodes)}"
            ))
            return ValidationReport(is_valid=False, errors=errors, warnings=warnings)

        # 3. Validações de integridade semântica (Sources e Sinks)
        sources = [node_id for node_id in draft.nodes if not any(edge.to_port.node_id == node_id for edge in draft.edges.values())]
        sinks = [node_id for node_id in draft.nodes if not any(edge.from_port.node_id == node_id for edge in draft.edges.values())]

        if not sources:
            warnings.append(ValidationWarningItem(
                code="WARN_NO_SOURCE",
                message="Nenhum nó de entrada (Source) identificado no pipeline."
            ))
        if not sinks:
            warnings.append(ValidationWarningItem(
                code="WARN_NO_SINK",
                message="Nenhum nó de saída (Sink/Target) identificado no pipeline."
            ))

        return ValidationReport(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            topological_order=topological_order
        )
