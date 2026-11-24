"""Validador de Grafos de Pipeline (GraphValidator).

Aplica ordenação topológica (Algoritmo de Kahn) para garantir aciclicidade (DAG)
e verifica integridade estrutural de portas e nós.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.domain.catalog.definitions import get_component_definition
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.policy.evaluator import PolicyEvaluator
from src.core.domain.policy.policy_model import PolicyDocument
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
    iterator_edges: List[str] = field(default_factory=list)


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

                # Consistência de Paralelismo: Células com a mesma ordem não podem ter interdependência
                current_order = cell.get("order")
                target_cell = next((c for c in cells if (c.get("id") == target_id or c.get("name") == target_id)), None)
                if target_cell is not None:
                    target_order = target_cell.get("order")
                    if current_order is not None and target_order is not None:
                        if current_order == target_order:
                            errors.append(ValidationErrorItem(
                                code="ERR_PARALLEL_CELL_INTERDEPENDENCY",
                                node_id=cid,
                                message=(
                                    f"A canvas-cell '{cid}' possui pré-condição dependendo de '{target_id}', mas ambas "
                                    f"possuem a mesma ordem de execução ({current_order}). Células com a mesma ordem "
                                    f"executam em paralelo e não podem ter interdependência entre si."
                                )
                            ))
                            continue
                        elif target_order > current_order:
                            errors.append(ValidationErrorItem(
                                code="ERR_INVALID_ORDER_DEPENDENCY",
                                node_id=cid,
                                message=(
                                    f"A canvas-cell '{cid}' (ordem {current_order}) não pode depender da célula "
                                    f"'{target_id}' que possui ordem de execução posterior ({target_order})."
                                )
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

    def validate(
        self,
        draft: PipelineDraft,
        policy: Optional[Any] = None
    ) -> ValidationReport:
        """Executa validação completa do draft, incluindo constraints de componentes e políticas ABAC."""
        errors: List[ValidationErrorItem] = []
        warnings: List[ValidationWarningItem] = []
        cell_topological_order: List[str] = []

        # Validação macro de canvas-cells (se houver especificação de células)
        has_python_cells = False
        if draft.cells:
            cell_errors, cell_topological_order = self.validate_cell_topology(draft.cells)
            errors.extend(cell_errors)
            for c in draft.cells:
                c_type = str(c.get("cell_type") or c.get("cellType") or "CANVAS").upper()
                if c_type == "PYTHON":
                    has_python_cells = True
                    snippet = c.get("code_snippet") or c.get("codeSnippet") or ""
                    if not snippet.strip():
                        warnings.append(ValidationWarningItem(
                            code="WARN_EMPTY_PYTHON_CELL",
                            node_id=c.get("id"),
                            message=f"A célula Python '{c.get('name') or c.get('id')}' está sem código definido."
                        ))
                    else:
                        import ast
                        try:
                            ast.parse(snippet)
                        except SyntaxError as syn_err:
                            errors.append(ValidationErrorItem(
                                code="ERR_PYTHON_SYNTAX",
                                node_id=c.get("id"),
                                message=f"Erro de sintaxe Python na célula '{c.get('name') or c.get('id')}' (linha {syn_err.lineno}): {syn_err.msg}"
                            ))

        if not draft.nodes and not has_python_cells:
            errors.append(ValidationErrorItem(
                code="ERR_EMPTY_PIPELINE",
                message="O pipeline não possui nós cadastrados."
            ))
            return ValidationReport(is_valid=False, errors=errors)

        # 1. Construir lista de adjacências e graus de entrada para o algoritmo de Kahn
        adj_list: Dict[str, List[str]] = {node_id: [] for node_id in draft.nodes}
        in_degree: Dict[str, int] = {node_id: 0 for node_id in draft.nodes}
        connected_to_ports: Set[str] = set()
        seen_edge_signatures: Set[tuple] = set()

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
                to_comp_type = (draft.nodes[to_node].component_type or "").lower()
                is_control_port = (
                    edge.to_port.port_name == "trigger" or
                    edge.to_port.port_name.startswith("trigger") or
                    to_comp_type in ("control.sync", "control.barrier")
                )
                is_multi_input = (
                    is_control_port or
                    to_comp_type in (
                        "core.tmap", "transform.tmap", "processor.tmap", "tmap",
                        "core.union", "transform.union", "union",
                        "core.join", "transform.join", "join",
                    ) or
                    edge.to_port.port_name in ("lookup", "lookups", "lkp")
                )
                edge_sig = (from_node, edge.from_port.port_name, to_node, edge.to_port.port_name)

                if is_multi_input:
                    if edge_sig in seen_edge_signatures:
                        errors.append(ValidationErrorItem(
                            code="ERR_DUPLICATE_PORT_CONNECTION",
                            node_id=to_node,
                            message=f"Conexão duplicada entre '{edge.from_port}' e '{edge.to_port}'."
                        ))
                    seen_edge_signatures.add(edge_sig)
                else:
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

        # 3. Identificação e Validação de Arestas de Iteração (ITERATOR_EDGE)
        # Permite conectar a saída de um nó (Origem A) diretamente na entrada de outro nó (Origem B) para iteração linha a linha.
        iterator_edges: List[str] = []
        for edge_id, edge in draft.edges.items():
            to_node = draft.nodes.get(edge.to_port.node_id)
            from_node = draft.nodes.get(edge.from_port.node_id)
            if to_node and from_node:
                to_type = (to_node.component_type or "").lower()
                from_type = (from_node.component_type or "").lower()
                is_to_source = (
                    "source" in to_type
                    or (to_type.startswith("connector.db.") and not to_type.endswith(".output"))
                    or to_type.startswith("core.file.source")
                )
                if is_to_source:
                    iterator_edges.append(edge_id)

        # 4. Validações de integridade semântica (Sources e Sinks)
        sources = [
            node_id for node_id in draft.nodes
            if not any(edge.to_port.node_id == node_id for edge in draft.edges.values())
            or (draft.nodes[node_id].component_type or "").lower().startswith("connector.db.")
            or "source" in (draft.nodes[node_id].component_type or "").lower()
        ]
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

        # 4. Validação de Component Hard Constraints (ex: Componentes Customizados como mysql_agreements)
        for node_id, node in draft.nodes.items():
            try:
                comp_def = get_component_definition(node.component_type)
                if comp_def and comp_def.constraints:
                    if "max_batch_size" in comp_def.constraints:
                        max_b = comp_def.constraints["max_batch_size"]
                        cfg_batch = (node.config or {}).get("batch_size")
                        if cfg_batch is not None and int(cfg_batch) > max_b:
                            errors.append(ValidationErrorItem(
                                code="ERR_COMPONENT_CONSTRAINT_VIOLATION",
                                node_id=node_id,
                                message=(
                                    f"O componente '{node.component_type}' no nó '{node_id}' viola a Hard Constraint: "
                                    f"batch_size={cfg_batch} excede o limite máximo permitido de {max_b}."
                                )
                            ))
            except KeyError:
                # Componente não encontrado no catálogo
                pass

        # 4.1 Validação Semântica para nós Data Mapper (tMap)
        for node_id, node in draft.nodes.items():
            ctype = (node.component_type or "").lower()
            if ctype in ("core.tmap", "transform.tmap", "processor.tmap", "tmap"):
                incoming = [e for e in draft.edges.values() if e.to_port.node_id == node_id]
                if not incoming:
                    errors.append(ValidationErrorItem(
                        code="ERR_TMAP_NO_INPUT",
                        node_id=node_id,
                        message=f"O componente Data Mapper (tMap) '{node_id}' não possui conexões de entrada."
                    ))
                    continue

                cfg = node.config or {}
                main_input_id = cfg.get("main_input_id")
                connected_src_ids = {e.from_port.node_id for e in incoming}

                if main_input_id:
                    clean_main_id = str(main_input_id).split(":")[0].split(".")[0]
                    if clean_main_id not in draft.nodes:
                        errors.append(ValidationErrorItem(
                            code="ERR_TMAP_INVALID_MAIN_INPUT",
                            node_id=node_id,
                            message=f"O componente Data Mapper (tMap) '{node_id}' referencia uma entrada principal inexistente ('{main_input_id}')."
                        ))
                    elif clean_main_id not in connected_src_ids:
                        errors.append(ValidationErrorItem(
                            code="ERR_TMAP_INVALID_MAIN_INPUT",
                            node_id=node_id,
                            message=f"O componente Data Mapper (tMap) '{node_id}' referencia '{main_input_id}' como entrada principal, mas não há conexão ativa entre eles."
                        ))
                else:
                    has_main_candidate = any(
                        e.to_port.port_name not in ("lookup", "lookups", "lkp")
                        for e in incoming
                    )
                    if not has_main_candidate and len(incoming) > 0:
                        errors.append(ValidationErrorItem(
                            code="ERR_TMAP_NO_MAIN_INPUT",
                            node_id=node_id,
                            message=f"O componente Data Mapper (tMap) '{node_id}' não possui conexão de fluxo principal (porta 'main')."
                        ))

        # 4.2 Validação Semântica para nós Sink / Target (Ação DML e Chaves Obrigatórias - Regra 1)
        for node_id, node in draft.nodes.items():
            ctype = (node.component_type or "").lower()
            is_sink = (
                ctype.endswith(".output")
                or "target" in ctype
                or "sink" in ctype
                or ctype in ("core.database.target", "connector.db.duckdb.output", "connector.db.postgresql.output", "core.duckdb.target")
            )
            if is_sink:
                cfg = node.config or {}
                raw_cfg = cfg.get("raw_config") if isinstance(cfg.get("raw_config"), dict) else {}
                data_action = str(cfg.get("data_action") or raw_cfg.get("data_action") or "insert").lower().strip()
                if data_action in ("update", "update_or_insert", "insert_or_update", "upsert", "delete"):
                    use_fo = bool(cfg.get("use_field_options", raw_cfg.get("use_field_options", False)))
                    fo_list = cfg.get("field_options") or raw_cfg.get("field_options") or []
                    schema_defs = (
                        getattr(node, "schema_definitions", None)
                        or cfg.get("schema_definitions")
                        or raw_cfg.get("schema_definitions")
                        or cfg.get("schema")
                        or raw_cfg.get("schema")
                        or []
                    )
                    has_key = False
                    if use_fo and fo_list:
                        if data_action == "delete":
                            has_key = any(f.get("deletion_key") for f in fo_list if isinstance(f, dict))
                        else:
                            has_key = any(f.get("update_key") for f in fo_list if isinstance(f, dict))
                    else:
                        legacy_keys = cfg.get("keys") or raw_cfg.get("keys") or []
                        if legacy_keys:
                            has_key = True
                        elif schema_defs and isinstance(schema_defs, list):
                            has_key = any(c.get("isPrimaryKey") or c.get("is_primary_key") for c in schema_defs if isinstance(c, dict))

                    if not has_key:
                        req_type = "Deletion Key" if data_action == "delete" else "Update Key"
                        errors.append(ValidationErrorItem(
                            code="ERR_SINK_KEYS_REQUIRED",
                            node_id=node_id,
                            message=(
                                f"O componente '{node_id}' com ação '{data_action}' exige ao menos uma {req_type}. "
                                "Defina as chaves em 'Configurações avançadas' (Field Options) ou marque a chave primária no Schema."
                            )
                        ))

        # 5. Validação de Políticas Corporativas ABAC (se policy fornecida)
        if policy is not None:
            evaluator: PolicyEvaluator
            if isinstance(policy, PolicyEvaluator):
                evaluator = policy
            elif isinstance(policy, PolicyDocument):
                evaluator = PolicyEvaluator([policy])
            elif isinstance(policy, list):
                evaluator = PolicyEvaluator(policy)
            else:
                evaluator = PolicyEvaluator([])

            # 5.1 Verificar exigência de documentação do Job
            has_req_job_desc = False
            has_req_cell_desc = False
            for p in evaluator.policies:
                for stmt in p.statements:
                    if stmt.conditions.get("require_job_description"):
                        has_req_job_desc = True
                    if stmt.conditions.get("require_cell_description"):
                        has_req_cell_desc = True

            if has_req_job_desc and (not draft.description or not draft.description.strip()):
                errors.append(ValidationErrorItem(
                    code="ERR_POLICY_MISSING_JOB_DESCRIPTION",
                    message="A política corporativa de governança exige descrição obrigatória para o Pipeline (require_job_description)."
                ))

            if has_req_cell_desc and draft.cells:
                for cell in draft.cells:
                    c_id = cell.get("id") or cell.get("name") or "célula"
                    c_desc = cell.get("description")
                    if not c_desc or not str(c_desc).strip():
                        errors.append(ValidationErrorItem(
                            code="ERR_POLICY_MISSING_CELL_DESCRIPTION",
                            node_id=c_id,
                            message=f"A política corporativa de governança exige descrição obrigatória na célula '{c_id}' (require_cell_description)."
                        ))

            # 5.2 Verificar autorização de conectores utilizados nos nós
            for node_id, node in draft.nodes.items():
                eval_res = evaluator.evaluate(
                    action="connector:use",
                    resource=f"urn:rdf:connector:{node.component_type}",
                    context=node.config or {}
                )
                if not eval_res.allowed:
                    errors.append(ValidationErrorItem(
                        code="ERR_POLICY_FORBIDDEN_CONNECTOR",
                        node_id=node_id,
                        message=f"Uso do componente '{node.component_type}' no nó '{node_id}' negado pela política: {eval_res.reason}"
                    ))

        return ValidationReport(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            topological_order=topological_order,
            cell_topological_order=cell_topological_order,
            iterator_edges=iterator_edges
        )


DAGValidator = GraphValidator

