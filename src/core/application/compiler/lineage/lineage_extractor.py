"""Serviço Extrator de Column-Level Data Lineage via AST (Fase 1 - Spec 005).

Rastreia dependências campo a campo (origem, destino e tipo de transformação:
PASSTHROUGH, EXPRESSION, LOOKUP_MATCH) inspecionando a AST de expressões do tMap
e operadores relacionais como tFilterRow e tAggregateRow.
"""

from collections import deque
from dataclasses import dataclass, field
from enum import Enum
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.application.compiler.expressions.lexer import Lexer
from src.core.application.compiler.expressions.parser import Parser
from src.core.application.compiler.expressions.nodes import (
    ASTNode,
    BinaryOpNode,
    FunctionCallNode,
    GroupNode,
    IdentifierNode,
    MethodCallNode,
    QualifiedIdentifierNode,
    TernaryNode,
    UnaryOpNode,
)

logger = logging.getLogger(__name__)


class TransformationType(str, Enum):
    """Classificação do tipo de transformação aplicada na linhagem de colunas."""
    PASSTHROUGH = "PASSTHROUGH"       # Mapeamento direto 1:1 sem modificações
    EXPRESSION = "EXPRESSION"         # Transformação computada (expressão, funções, cálculos)
    LOOKUP_MATCH = "LOOKUP_MATCH"     # Coluna proveniente de tabela secundária (join/lookup)


@dataclass
class ColumnLineageRelation:
    """Representa a relação direcionada de linhagem entre uma coluna de origem e uma de destino."""
    source_node_id: str
    source_port: str
    source_column: str
    target_node_id: str
    target_port: str
    target_column: str
    transformation_type: TransformationType
    expression: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": {
                "node_id": self.source_node_id,
                "port": self.source_port,
                "column_name": self.source_column,
            },
            "target": {
                "node_id": self.target_node_id,
                "port": self.target_port,
                "column_name": self.target_column,
            },
            "transformation_type": self.transformation_type.value,
            "expression": self.expression,
            "details": self.details or {},
        }


@dataclass
class ColumnLineageGraph:
    """Grafo direcionado de linhagem de colunas com suporte a buscas de sub-grafo a montante."""
    relations: List[ColumnLineageRelation] = field(default_factory=list)

    def add_relation(self, relation: ColumnLineageRelation) -> None:
        self.relations.append(relation)

    def filter(
        self,
        target_node_id: Optional[str] = None,
        target_column: Optional[str] = None
    ) -> List[ColumnLineageRelation]:
        """Realiza busca reversa (upstream BFS) para encontrar toda a cadeia de proveniência de uma coluna."""
        if not target_node_id and not target_column:
            return list(self.relations)

        matched_relations: List[ColumnLineageRelation] = []
        visited_nodes_and_cols: Set[Tuple[str, str]] = set()
        queue: deque[Tuple[str, str]] = deque()

        # Encontra as relações terminais imediatas
        for r in self.relations:
            node_match = not target_node_id or r.target_node_id == target_node_id
            col_match = not target_column or r.target_column == target_column
            if node_match and col_match:
                matched_relations.append(r)
                endpoint = (r.source_node_id, r.source_column)
                if endpoint not in visited_nodes_and_cols:
                    visited_nodes_and_cols.add(endpoint)
                    queue.append(endpoint)

        # Busca recursiva upstream
        while queue:
            curr_node, curr_col = queue.popleft()
            for r in self.relations:
                if r.target_node_id == curr_node and r.target_column == curr_col:
                    if r not in matched_relations:
                        matched_relations.append(r)
                    upstream_endpoint = (r.source_node_id, r.source_column)
                    if upstream_endpoint not in visited_nodes_and_cols:
                        visited_nodes_and_cols.add(upstream_endpoint)
                        queue.append(upstream_endpoint)

        return matched_relations

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o grafo completo para consumo via REST API e visualização no Canvas."""
        unique_nodes: Dict[str, Dict[str, Any]] = {}
        for r in self.relations:
            src_key = f"{r.source_node_id}:{r.source_column}"
            tgt_key = f"{r.target_node_id}:{r.target_column}"
            unique_nodes[src_key] = {
                "id": src_key,
                "node_id": r.source_node_id,
                "column_name": r.source_column,
                "port": r.source_port,
            }
            unique_nodes[tgt_key] = {
                "id": tgt_key,
                "node_id": r.target_node_id,
                "column_name": r.target_column,
                "port": r.target_port,
            }

        return {
            "relations": [r.to_dict() for r in self.relations],
            "nodes": list(unique_nodes.values()),
            "total_relations": len(self.relations),
        }


def _extract_column_refs_from_ast(node: ASTNode) -> List[Tuple[Optional[str], str]]:
    """Extrai recursivamente todos os pares (alias, column_name) da AST de expressão."""
    refs: List[Tuple[Optional[str], str]] = []
    if isinstance(node, QualifiedIdentifierNode):
        if len(node.parts) == 1:
            refs.append((None, node.parts[0]))
        else:
            refs.append((node.parts[0], node.parts[1]))
    elif isinstance(node, IdentifierNode):
        refs.append((None, node.name))
    elif isinstance(node, UnaryOpNode):
        refs.extend(_extract_column_refs_from_ast(node.operand))
    elif isinstance(node, BinaryOpNode):
        refs.extend(_extract_column_refs_from_ast(node.left))
        refs.extend(_extract_column_refs_from_ast(node.right))
    elif isinstance(node, TernaryNode):
        refs.extend(_extract_column_refs_from_ast(node.condition))
        refs.extend(_extract_column_refs_from_ast(node.true_expr))
        refs.extend(_extract_column_refs_from_ast(node.false_expr))
    elif isinstance(node, FunctionCallNode):
        for arg in node.args:
            refs.extend(_extract_column_refs_from_ast(arg))
    elif isinstance(node, MethodCallNode):
        refs.extend(_extract_column_refs_from_ast(node.object_expr))
        for arg in node.args:
            refs.extend(_extract_column_refs_from_ast(arg))
    elif isinstance(node, GroupNode):
        refs.extend(_extract_column_refs_from_ast(node.expression))
    return refs


def _is_simple_reference(node: ASTNode) -> bool:
    """Indica se a AST é puramente uma referência direta a um identificador (sem cálculos)."""
    if isinstance(node, (QualifiedIdentifierNode, IdentifierNode)):
        return True
    if isinstance(node, GroupNode):
        return _is_simple_reference(node.expression)
    return False


class LineageExtractor:
    """Extrai e compõe relações de linhagem entre colunas inspecionando ASTs e operadores."""

    def extract_tmap_lineage(
        self,
        tmap_node_id: str,
        tmap_config: Dict[str, Any],
        upstream_alias_to_node: Dict[str, Tuple[str, str]],
    ) -> List[ColumnLineageRelation]:
        """Extrai a linhagem campo a campo para o componente tMap a partir de suas expressões."""
        relations: List[ColumnLineageRelation] = []

        main_table_alias = tmap_config.get("main_table", "main")
        lookups = tmap_config.get("lookups", [])
        lookup_aliases = {lk.get("alias") for lk in lookups if lk.get("alias")}

        # Mapeia variáveis intermediárias (Var)
        vars_definitions = tmap_config.get("vars", [])
        var_ast_map: Dict[str, ASTNode] = {}
        for v in vars_definitions:
            v_name = v.get("name")
            v_expr = (v.get("expression") or "").strip()
            if v_name and v_expr:
                try:
                    tokens = Lexer(v_expr).tokenize()
                    var_ast_map[v_name] = Parser(tokens).parse()
                except Exception as e:
                    logger.debug(f"Não foi possível parsear Var.{v_name}: {e}")

        # Resolve referências transitivas em Var recursivamente
        def resolve_ast_refs(ast: ASTNode, is_root: bool = True) -> List[Tuple[Tuple[Optional[str], str], TransformationType]]:
            raw_refs: List[Tuple[Tuple[Optional[str], str], TransformationType]] = []
            simple = is_root and _is_simple_reference(ast)

            for alias, col in _extract_column_refs_from_ast(ast):
                if alias == "Var" and col in var_ast_map:
                    # Variável intermediária: resolve para as fontes da variável
                    var_ast = var_ast_map[col]
                    sub_refs = resolve_ast_refs(var_ast, is_root=False)
                    for (sub_alias, sub_col), _ in sub_refs:
                        raw_refs.append(((sub_alias, sub_col), TransformationType.EXPRESSION))
                else:
                    if simple:
                        ttype = TransformationType.LOOKUP_MATCH if alias in lookup_aliases else TransformationType.PASSTHROUGH
                    else:
                        ttype = TransformationType.EXPRESSION
                    raw_refs.append(((alias, col), ttype))
            return raw_refs

        # Processa saídas do tMap
        outputs = tmap_config.get("outputs", [])
        for out in outputs:
            out_port = out.get("name", "out")
            columns = out.get("columns", [])
            for col_def in columns:
                col_name = col_def.get("name")
                expr_str = (col_def.get("expression") or "").strip()
                if not col_name or not expr_str:
                    continue

                try:
                    tokens = Lexer(expr_str).tokenize()
                    ast = Parser(tokens).parse()
                    resolved = resolve_ast_refs(ast, is_root=True)

                    seen_sources: Set[Tuple[str, str, str]] = set()
                    for (alias, col), ttype in resolved:
                        # Identifica nó de origem
                        lookup_key = alias or main_table_alias
                        if lookup_key in upstream_alias_to_node:
                            src_node_id, src_port = upstream_alias_to_node[lookup_key]
                        elif main_table_alias in upstream_alias_to_node:
                            src_node_id, src_port = upstream_alias_to_node[main_table_alias]
                        else:
                            # Fallback para o primeiro upstream disponível
                            first_upstream = next(iter(upstream_alias_to_node.values()), (lookup_key, "out"))
                            src_node_id, src_port = first_upstream

                        endpoint_key = (src_node_id, src_port, col)
                        if endpoint_key in seen_sources:
                            continue
                        seen_sources.add(endpoint_key)

                        relations.append(
                            ColumnLineageRelation(
                                source_node_id=src_node_id,
                                source_port=src_port,
                                source_column=col,
                                target_node_id=tmap_node_id,
                                target_port=out_port,
                                target_column=col_name,
                                transformation_type=ttype,
                                expression=expr_str,
                            )
                        )
                except Exception as e:
                    logger.debug(f"Erro ao extrair linhagem da expressão '{expr_str}' em {col_name}: {e}")

        return relations

    def extract_filter_lineage(
        self,
        node_id: str,
        config: Dict[str, Any],
        upstream_node_id: str,
        upstream_port: str = "output",
        output_port: str = "output",
    ) -> List[ColumnLineageRelation]:
        """Gera linhagem de pass-through para tFilterRow."""
        relations: List[ColumnLineageRelation] = []
        schema = config.get("schema", [])

        # Se não houver schema explícito, extrai colunas das condições do filtro
        columns = [c.get("name") for c in schema if c.get("name")]
        if not columns:
            conditions = config.get("conditions", [])
            columns = [c.get("column") for c in conditions if c.get("column")]

        for col in columns:
            relations.append(
                ColumnLineageRelation(
                    source_node_id=upstream_node_id,
                    source_port=upstream_port,
                    source_column=col,
                    target_node_id=node_id,
                    target_port=output_port,
                    target_column=col,
                    transformation_type=TransformationType.PASSTHROUGH,
                    details={"filter_conditions": config.get("conditions", [])},
                )
            )

        return relations

    def extract_aggregate_lineage(
        self,
        node_id: str,
        config: Dict[str, Any],
        upstream_node_id: str,
        upstream_port: str = "output",
        output_port: str = "output",
    ) -> List[ColumnLineageRelation]:
        """Gera linhagem para tAggregateRow (chaves de group_by como PASSTHROUGH, agregações como EXPRESSION)."""
        relations: List[ColumnLineageRelation] = []

        # 1. Chaves de Agrupamento (Group By)
        for key in config.get("group_by", []):
            relations.append(
                ColumnLineageRelation(
                    source_node_id=upstream_node_id,
                    source_port=upstream_port,
                    source_column=key,
                    target_node_id=node_id,
                    target_port=output_port,
                    target_column=key,
                    transformation_type=TransformationType.PASSTHROUGH,
                )
            )

        # 2. Funções de Agregação
        for agg in config.get("aggregations", []):
            out_col = agg.get("output_column")
            in_col = agg.get("input_column")
            func = agg.get("function", "SUM")
            if out_col and in_col:
                relations.append(
                    ColumnLineageRelation(
                        source_node_id=upstream_node_id,
                        source_port=upstream_port,
                        source_column=in_col,
                        target_node_id=node_id,
                        target_port=output_port,
                        target_column=out_col,
                        transformation_type=TransformationType.EXPRESSION,
                        expression=f"{func}({in_col})",
                        details={"aggregation_function": func},
                    )
                )

        return relations

    def extract_pipeline_lineage(self, pipeline_spec: Dict[str, Any]) -> ColumnLineageGraph:
        """Gera o grafo completo de linhagem de colunas para todos os nós de um pipeline."""
        graph = ColumnLineageGraph()

        nodes = pipeline_spec.get("nodes", [])
        edges = pipeline_spec.get("edges", [])

        def parse_port_endpoint(endpoint_str: str, explicit_port: Optional[str] = None) -> Tuple[str, str]:
            if not endpoint_str:
                return ("", explicit_port or "output")
            if "." in endpoint_str:
                parts = endpoint_str.split(".", 1)
                return (parts[0].strip(), explicit_port or parts[1].strip())
            return (endpoint_str.strip(), explicit_port or "output")

        # Mapeia arestas de entrada por nó destino
        incoming_edges: Dict[str, List[Dict[str, Any]]] = {}
        for edge in edges:
            tgt_raw = edge.get("to", "")
            tgt_node, _ = parse_port_endpoint(tgt_raw, edge.get("to_port"))
            if tgt_node:
                incoming_edges.setdefault(tgt_node, []).append(edge)

        nodes_map = {n.get("id"): n for n in nodes if n.get("id")}

        for node in nodes:
            n_id = node.get("id")
            comp = node.get("component", {})
            c_type = comp.get("type", "")
            cfg = node.get("config", {})
            in_edges = incoming_edges.get(n_id, [])

            if "tmap" in c_type.lower():
                alias_map: Dict[str, Tuple[str, str]] = {}
                main_alias = cfg.get("main_table", "main")
                if in_edges:
                    src_id, src_port = parse_port_endpoint(in_edges[0].get("from", ""), in_edges[0].get("from_port"))
                    alias_map[main_alias] = (src_id, src_port)
                for idx, edge in enumerate(in_edges[1:], start=1):
                    alias = edge.get("flow_name") or edge.get("label") or f"lookup_{idx}"
                    src_id, src_port = parse_port_endpoint(edge.get("from", ""), edge.get("from_port"))
                    alias_map[alias] = (src_id, src_port)

                # Extrai do tMap
                tmap_rels = self.extract_tmap_lineage(
                    tmap_node_id=n_id,
                    tmap_config=cfg,
                    upstream_alias_to_node=alias_map,
                )
                for r in tmap_rels:
                    graph.add_relation(r)

            elif "filter" in c_type.lower():
                if in_edges:
                    src_id, src_port = parse_port_endpoint(in_edges[0].get("from", ""), in_edges[0].get("from_port"))
                    filter_rels = self.extract_filter_lineage(
                        node_id=n_id,
                        config=cfg,
                        upstream_node_id=src_id,
                        upstream_port=src_port,
                    )
                    for r in filter_rels:
                        graph.add_relation(r)

            elif "aggregate" in c_type.lower():
                if in_edges:
                    src_id, src_port = parse_port_endpoint(in_edges[0].get("from", ""), in_edges[0].get("from_port"))
                    agg_rels = self.extract_aggregate_lineage(
                        node_id=n_id,
                        config=cfg,
                        upstream_node_id=src_id,
                        upstream_port=src_port,
                    )
                    for r in agg_rels:
                        graph.add_relation(r)

            elif in_edges:
                # Nós de destino / conectores genéricos: propagam colunas do nó anterior
                src_id, src_port = parse_port_endpoint(in_edges[0].get("from", ""), in_edges[0].get("from_port"))
                _, tgt_port = parse_port_endpoint(in_edges[0].get("to", ""), in_edges[0].get("to_port", "input"))
                # Coleta as colunas que o nó upstream produz no grafo
                upstream_cols = {r.target_column for r in graph.relations if r.target_node_id == src_id}
                if not upstream_cols and "schema" in nodes_map.get(src_id, {}).get("config", {}):
                    upstream_cols = {c.get("name") for c in nodes_map[src_id]["config"]["schema"] if c.get("name")}

                for col in upstream_cols:
                    graph.add_relation(
                        ColumnLineageRelation(
                            source_node_id=src_id,
                            source_port=src_port,
                            source_column=col,
                            target_node_id=n_id,
                            target_port=tgt_port,
                            target_column=col,
                            transformation_type=TransformationType.PASSTHROUGH,
                        )
                    )

        return graph
