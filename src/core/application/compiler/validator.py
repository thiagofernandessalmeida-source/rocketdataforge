"""Validador de Grafos de Pipeline (GraphValidator).

Aplica ordenação topológica (Algoritmo de Kahn) para garantir aciclicidade (DAG)
e verifica integridade estrutural de portas e nós.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

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
    cell_topological_order: List[str] = field(default_factory=list)


class GraphValidator:
    """Serviço de validação estrutural e acíclica de pipelines."""

    def validate_cell_topology(
        self, cells: List[Dict[str, Any]]
    ) -> tuple[List[ValidationErrorItem], List[str]]:
        """Valida a topologia macro de canvas-cells prevenindo ciclos globais e referências inválidas."""
        errors: List[ValidationErrorItem] = []
        cell_order: List[str] = []
        if not cells:
            return errors, cell_order

        cell_ids = [c.get("id") or c.get("name") for c in cells if c.get("id") or c.get("name")]
        cell_id_set = set(cell_ids)

        # 1. Construir lista de adjacências de dependência entre células
        # target_cell_id -> cell_id (target deve executar antes de cell)
        adj_list: Dict[str, List[str]] = {cid: [] for cid in cell_ids}
        in_degree: Dict[str, int] = {cid: 0 for cid in cell_ids}

        for cell in cells:
            cid = cell.get("id") or cell.get("name")
            if not cid:
                continue

            preconditions = cell.get("preconditions") or []
            for pre in preconditions:
                target_id = pre.get("target_cell_id") or pre.get("targetCellId")
                if not target_id:
                    continue

                if target_id == cid:
                    errors.append(ValidationErrorItem(
                        code="ERR_CYCLIC_CELL_DEPENDENCY",
                        node_id=cid,
                        message=f"A canvas-cell '{cid}' possui dependência circular direta para si mesma."
                    ))
                    continue

                if target_id not in cell_id_set:
                    errors.append(ValidationErrorItem(
                        code="ERR_INVALID_CELL_REFERENCE",
                        node_id=cid,
                        message=f"A canvas-cell '{cid}' possui pré-condição referenciando a célula inexistente '{target_id}'."
                    ))
                    continue

                adj_list[target_id].append(cid)
                in_degree[cid] += 1

        if errors:
            return errors, []

        # 2. Algoritmo de Kahn para Ordenação Macro e Detecção de Ciclos entre Células
        queue = deque([cid for cid in cell_ids if in_degree[cid] == 0])

        while queue:
            curr = queue.popleft()
            cell_order.append(curr)

            for neighbor in adj_list.get(curr, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(cell_order) < len(cell_ids):
            cyclic_cells = sorted([cid for cid, deg in in_degree.items() if deg > 0])
            errors.append(ValidationErrorItem(
                code="ERR_CYCLIC_CELL_DEPENDENCY",
                message=f"Ciclo global de dependência detectado entre as canvas-cells: {', '.join(cyclic_cells)}"
            ))

        return errors, cell_order

    def validate(self, draft: PipelineDraft) -> ValidationReport:
        """Executa validação completa do draft."""
        errors: List[ValidationErrorItem] = []
        warnings: List[ValidationWarningItem] = []
        cell_topological_order: List[str] = []

        # Validação macro de canvas-cells (se houver especificação de células)
        if draft.cells:
            cell_errors, cell_topological_order = self.validate_cell_topology(draft.cells)
            errors.extend(cell_errors)

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
            topological_order=topological_order,
            cell_topological_order=cell_topological_order
        )
