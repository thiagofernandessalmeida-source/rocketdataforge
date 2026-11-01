"""Analisador de Linhagem SQL (Camada B).

Utiliza sqlglot para:
1. Parsear e qualificar AST de queries SQL (com CTEs, joins, subqueries).
2. Rastrear a linhagem precisa de cada coluna de saída até sua coluna e tabela de origem.
3. Obter do catálogo metadados enriquecidos (PK, tamanho, precisão, escala, comentário).
4. Ajustar nulabilidade considerando outer joins (LEFT, RIGHT, FULL).
5. Identificar colunas computadas (sem origem em tabela física).

Adere estritamente ao princípio de Domínio Puro (Constituição 2.4).
"""

from dataclasses import dataclass, field
import logging
from typing import Any, Dict, List, Optional, Set

import sqlglot
from sqlglot import exp
from sqlglot.lineage import lineage
from sqlglot.optimizer.qualify import qualify

from src.core.application.metadata.catalog_provider import CatalogColumn, CatalogProvider
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType

logger = logging.getLogger(__name__)


@dataclass
class ColumnLineage:
    """Metadados e linhagem de uma coluna de saída."""
    name: str
    logical_type: Optional[LogicalDataType] = None
    physical_type: Optional[str] = None
    nullable: bool = True
    is_primary_key: bool = False
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    comment: Optional[str] = None
    origin: List[str] = field(default_factory=list)
    computed: bool = False


@dataclass
class LineageAnalysisResult:
    """Resultado da análise de linhagem da query."""
    columns: Dict[str, ColumnLineage] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    base_tables: List[str] = field(default_factory=list)


class SqlLineageAnalyzer:
    """Analisador de linhagem semântica de consultas SQL com sqlglot."""

    def __init__(
        self,
        catalog_provider: Optional[CatalogProvider] = None,
        dialect: str = "postgres",
    ):
        self.catalog_provider = catalog_provider
        self.dialect = dialect or "postgres"

    def analyze_lineage(
        self,
        query: str,
        validate_tables_exist: bool = True,
    ) -> LineageAnalysisResult:
        """Analisa a consulta SQL, extrai linhagem por coluna e enriquece com catálogo."""
        result = LineageAnalysisResult()
        clean_query = query.strip()
        if not clean_query:
            return result

        try:
            tree = sqlglot.parse_one(clean_query, dialect=self.dialect)
        except Exception as parse_err:
            logger.warning(f"Erro ao parsear query com sqlglot: {parse_err}")
            result.warnings.append("lineage_unavailable")
            return result

        # 1. Identifica CTEs para não confundi-las com tabelas físicas
        cte_names: Set[str] = {cte.alias.lower() for cte in tree.find_all(exp.CTE) if cte.alias}

        # 2. Coleta tabelas base da consulta
        base_tables_nodes: List[exp.Table] = []
        seen_tables: Set[str] = set()

        for t in tree.find_all(exp.Table):
            tbl_name = t.name
            if not tbl_name or tbl_name.lower() in cte_names:
                continue
            key = f"{t.catalog or ''}.{t.db or ''}.{tbl_name}".lower()
            if key not in seen_tables:
                seen_tables.add(key)
                base_tables_nodes.append(t)

        # 3. Consulta o catálogo apenas para as tabelas base identificadas
        catalog_cols_map: Dict[str, Dict[str, CatalogColumn]] = {}
        schema_dict: Dict[str, Any] = {}

        for t_node in base_tables_nodes:
            catalog = t_node.catalog or None
            schema = t_node.db or None
            tbl_name = t_node.name

            cols: List[CatalogColumn] = []
            if self.catalog_provider:
                cols = self.catalog_provider.get_table_columns(catalog, schema, tbl_name)

            if not cols and validate_tables_exist:
                full_tbl_id = f"{schema}.{tbl_name}" if schema else tbl_name
                raise DomainValidationError(f"Tabela '{full_tbl_id}' não encontrada no catálogo.")

            # Monta mapa rápido por identificador
            identifiers = [
                tbl_name.lower(),
                f"{schema}.{tbl_name}".lower() if schema else None,
                f"{catalog}.{schema}.{tbl_name}".lower() if catalog and schema else None,
            ]
            col_by_name = {c.name.lower(): c for c in cols}
            for ident in identifiers:
                if ident:
                    catalog_cols_map[ident] = col_by_name

            # Monta estrutura de schema para o sqlglot qualify
            type_mapping = {c.name: (c.data_type or "VARCHAR") for c in cols}
            if catalog and schema:
                schema_dict.setdefault(catalog, {}).setdefault(schema, {})[tbl_name] = type_mapping
            elif schema:
                schema_dict.setdefault(schema, {})[tbl_name] = type_mapping
            else:
                schema_dict[tbl_name] = type_mapping

            result.base_tables.append(f"{schema}.{tbl_name}" if schema else tbl_name)

        # 4. Identifica tabelas que ficam no lado anulável de OUTER JOINS
        nullable_tables: Set[str] = set()
        for join in tree.find_all(exp.Join):
            side = str(join.side or "").upper()
            kind = str(join.kind or "").upper()
            join_this = join.this

            if isinstance(join_this, exp.Table):
                joined_name = (join_this.alias or join_this.name).lower()
            else:
                joined_name = str(getattr(join_this, "alias_or_name", "")).lower()

            if side == "LEFT" or "LEFT" in kind:
                if joined_name:
                    nullable_tables.add(joined_name)
            elif side == "RIGHT" or "RIGHT" in kind:
                # No RIGHT JOIN, as tabelas à esquerda tornam-se anuláveis
                parent = join.parent
                if parent and hasattr(parent, "this") and isinstance(parent.this, exp.Table):
                    from_name = (parent.this.alias or parent.this.name).lower()
                    if from_name:
                        nullable_tables.add(from_name)
            elif side == "FULL" or "FULL" in kind:
                if joined_name:
                    nullable_tables.add(joined_name)
                parent = join.parent
                if parent and hasattr(parent, "this") and isinstance(parent.this, exp.Table):
                    from_name = (parent.this.alias or parent.this.name).lower()
                    if from_name:
                        nullable_tables.add(from_name)

        # 5. Qualifica a query com o schema para resolver asteriscos e CTEs
        try:
            qualified = qualify(
                tree.copy(),
                schema=schema_dict,
                dialect=self.dialect,
                expand_stars=True,
            )
        except Exception as qual_err:
            logger.warning(f"Erro ao qualificar query no sqlglot: {qual_err}")
            result.warnings.append("lineage_unavailable")
            qualified = tree

        # 6. Rastreia linhagem para cada coluna de saída
        output_selects = getattr(qualified, "selects", [])

        for sel in output_selects:
            col_name = sel.output_name or sel.alias_or_name
            if not col_name or col_name == "*":
                continue

            # Rastreia linhagem desta coluna de saída
            lineage_node = None
            try:
                lineage_node = lineage(
                    col_name,
                    clean_query,
                    schema=schema_dict,
                    dialect=self.dialect,
                )
            except Exception as lin_err:
                logger.debug(f"Falha ao extrair linhagem da coluna '{col_name}': {lin_err}")

            if lineage_node is None:
                result.columns[col_name] = ColumnLineage(name=col_name, computed=True)
                continue

            # Coleta nós folha (sem downstream)
            leaves = [leaf for leaf in lineage_node.walk() if not leaf.downstream]
            table_leaves = [leaf for leaf in leaves if isinstance(leaf.source, exp.Table)]

            if not table_leaves:
                result.columns[col_name] = ColumnLineage(name=col_name, computed=True)
                continue

            origins: List[str] = []
            matched_columns: List[CatalogColumn] = []
            is_outer_joined = False

            for leaf in table_leaves:
                t_src: exp.Table = leaf.source
                col_leaf_name = leaf.name.split(".")[-1]
                src_tbl_name = t_src.name
                src_schema = t_src.db or None
                src_catalog = t_src.catalog or None
                src_alias = (t_src.alias or "").lower()

                # Verifica se a tabela ou seu alias estão no lado anulável de um outer join
                if src_alias in nullable_tables or src_tbl_name.lower() in nullable_tables:
                    is_outer_joined = True

                # Formata identificador de origem canônico
                parts = [p for p in [src_catalog, src_schema, src_tbl_name, col_leaf_name] if p]
                origin_str = ".".join(parts)
                if origin_str not in origins:
                    origins.append(origin_str)

                # Busca metadados da coluna no catálogo
                cat_col = None
                for candidate_key in [
                    f"{src_catalog}.{src_schema}.{src_tbl_name}".lower() if src_catalog and src_schema else None,
                    f"{src_schema}.{src_tbl_name}".lower() if src_schema else None,
                    src_tbl_name.lower(),
                ]:
                    if candidate_key and candidate_key in catalog_cols_map:
                        cat_col = catalog_cols_map[candidate_key].get(col_leaf_name.lower())
                        if cat_col:
                            break

                if cat_col:
                    matched_columns.append(cat_col)

            # Consolida metadados
            final_nullable = any(c.nullable for c in matched_columns) if matched_columns else True
            if is_outer_joined:
                final_nullable = True

            final_pk = all(c.is_primary_key for c in matched_columns) if matched_columns else False
            final_length = max([c.length for c in matched_columns if c.length is not None], default=None)
            final_prec = max([c.precision for c in matched_columns if c.precision is not None], default=None)
            final_scale = max([c.scale for c in matched_columns if c.scale is not None], default=None)
            comments = [c.comment for c in matched_columns if c.comment]
            final_comment = "; ".join(comments) if comments else None

            logical_type = None
            physical_type = None
            if matched_columns:
                first_cat = matched_columns[0]
                physical_type = first_cat.data_type
                if self.catalog_provider:
                    logical_type = self.catalog_provider.resolve_type(first_cat.data_type)

            inner = sel.this if isinstance(sel, exp.Alias) else sel
            is_computed = (not table_leaves) or (not isinstance(inner, exp.Column))

            result.columns[col_name] = ColumnLineage(
                name=col_name,
                logical_type=logical_type,
                physical_type=physical_type,
                nullable=final_nullable,
                is_primary_key=final_pk if not is_computed else False,
                length=final_length,
                precision=final_prec,
                scale=final_scale,
                comment=final_comment,
                origin=origins if not (is_computed and not table_leaves) else [],
                computed=is_computed,
            )

        return result

    def infer_offline(
        self,
        query: str,
        dataset_name: str = "dataset",
    ) -> Any:
        """Infere schema em modo estático/offline com qualify + annotate_types (Camada C)."""
        from src.core.application.metadata.schema_inferer import InferredField, InferredSchema
        from src.core.infrastructure.security.redaction import sanitize_message
        from sqlglot.optimizer.annotate_types import annotate_types

        clean_query = query.strip()
        if not clean_query:
            raise DomainValidationError("A consulta SQL informada está vazia.")

        try:
            tree = sqlglot.parse_one(clean_query, dialect=self.dialect)
        except Exception as e:
            sanitized = sanitize_message(str(e))
            raise DomainValidationError(f"Erro de sintaxe SQL na inferência estática: {sanitized}")

        # Análise de linhagem (Camada B)
        lineage_result = self.analyze_lineage(clean_query, validate_tables_exist=True)

        # Monta schema para annotate_types a partir do catálogo das tabelas identificadas
        cte_names = {cte.alias.lower() for cte in tree.find_all(exp.CTE) if cte.alias}
        schema_dict: Dict[str, Any] = {}
        for t in tree.find_all(exp.Table):
            if not t.name or t.name.lower() in cte_names:
                continue
            cols = []
            if self.catalog_provider:
                cols = self.catalog_provider.get_table_columns(t.catalog or None, t.db or None, t.name)
            type_mapping = {c.name: (c.data_type or "VARCHAR") for c in cols}
            if t.catalog and t.db:
                schema_dict.setdefault(t.catalog, {}).setdefault(t.db, {})[t.name] = type_mapping
            elif t.db:
                schema_dict.setdefault(t.db, {})[t.name] = type_mapping
            else:
                schema_dict[t.name] = type_mapping

        annotated_tree = tree
        try:
            qualified = qualify(tree.copy(), schema=schema_dict, dialect=self.dialect, expand_stars=True)
            annotated_tree = annotate_types(qualified, schema=schema_dict)
        except Exception as ann_err:
            logger.debug(f"Falha em qualify/annotate_types estático: {ann_err}")

        type_by_col: Dict[str, str] = {}
        if hasattr(annotated_tree, "selects"):
            for sel in annotated_tree.selects:
                col_name = sel.output_name or sel.alias_or_name
                if col_name and sel.type:
                    type_by_col[col_name] = sel.type.sql()

        warnings = ["estimado, não confirmado pelo banco"]
        if lineage_result.warnings:
            warnings.extend(lineage_result.warnings)

        fields: List[InferredField] = []
        for col_name, lin in lineage_result.columns.items():
            physical = lin.physical_type or type_by_col.get(col_name) or "VARCHAR"
            logical = lin.logical_type
            if logical is None:
                if self.catalog_provider:
                    logical = self.catalog_provider.resolve_type(physical)
                else:
                    logical = LogicalDataType.STRING

            fields.append(
                InferredField(
                    name=col_name,
                    logical_type=logical,
                    physical_type=physical,
                    nullable=lin.nullable,
                    description=lin.comment,
                    length=lin.length,
                    precision=lin.precision,
                    scale=lin.scale,
                    is_primary_key=lin.is_primary_key,
                    origin=lin.origin,
                    computed=lin.computed,
                )
            )

        return InferredSchema(
            dataset_name=dataset_name,
            fields=fields,
            inference_source="static",
            warnings=warnings,
        )
