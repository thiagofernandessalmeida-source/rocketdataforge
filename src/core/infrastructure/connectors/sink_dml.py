"""Módulo puro de lógica DML para conectores de saída (Sinks) estilo tDBOutput do Talend.

Implementa:
- Resolução de Field Options (Update Key, Deletion Key, Updatable, Insertable)
- Planejamento de escrita com validação estrita de chaves obrigatórias (Regra 1)
- Construtores de SQL por dialeto (Postgres, Oracle, DuckDB) com identificadores seguros
- Deduplicação de lotes (última linha vence) e tratamento de chaves nulas
"""

from dataclasses import dataclass, field
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.domain.shared.exceptions import DomainValidationError

logger = logging.getLogger(__name__)


@dataclass
class SinkFieldOptions:
    """Opções de campo resolvidas para gravação DML."""
    use_field_options: bool
    update_keys: List[str] = field(default_factory=list)
    deletion_keys: List[str] = field(default_factory=list)
    updatable_cols: List[str] = field(default_factory=list)
    insertable_cols: List[str] = field(default_factory=list)
    fail_on_no_match: bool = False


@dataclass
class SinkWritePlan:
    """Plano de execução DML validado para o conector."""
    data_action: str
    keys: List[str]
    updatable_cols: List[str]
    insertable_cols: List[str]
    fail_on_no_match: bool
    field_options: SinkFieldOptions


class SinkWriteResult(int):
    """Resultado de gravação DML que se comporta como int para compatibilidade total,
    mas expõe contadores granulares das 4 métricas."""
    rows_inserted: int
    rows_updated: int
    rows_deleted: int
    rows_not_matched: int
    duplicates_in_batch: int
    null_keys_in_batch: int

    def __new__(
        cls,
        rows_inserted: int = 0,
        rows_updated: int = 0,
        rows_deleted: int = 0,
        rows_not_matched: int = 0,
        duplicates_in_batch: int = 0,
        null_keys_in_batch: int = 0,
    ):
        total = rows_inserted + rows_updated + rows_deleted
        obj = super().__new__(cls, total)
        obj.rows_inserted = rows_inserted
        obj.rows_updated = rows_updated
        obj.rows_deleted = rows_deleted
        obj.rows_not_matched = rows_not_matched
        obj.duplicates_in_batch = duplicates_in_batch
        obj.null_keys_in_batch = null_keys_in_batch
        return obj

    @property
    def total_affected(self) -> int:
        return self.rows_inserted + self.rows_updated + self.rows_deleted

    def to_dict(self) -> Dict[str, int]:
        return {
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_deleted": self.rows_deleted,
            "rows_not_matched": self.rows_not_matched,
            "duplicates_in_batch": self.duplicates_in_batch,
            "null_keys_in_batch": self.null_keys_in_batch,
            "total_affected": self.total_affected
        }

    def __repr__(self) -> str:
        return (
            f"SinkWriteResult(total={self.total_affected}, inserted={self.rows_inserted}, "
            f"updated={self.rows_updated}, deleted={self.rows_deleted}, not_matched={self.rows_not_matched})"
        )


def format_sink_dml_log(
    connector_label: str,
    node_id: str,
    data_action: str,
    rows_read: int,
    result: SinkWriteResult
) -> str:
    """Formata log padronizado conforme especificação tDBOutput do Talend.
    Ex: 'Nó PostgreSQL sink 'x': 5 lidas, 4 atualizadas, 1 sem correspondência'
    """
    parts = [f"{rows_read} lidas"]
    act = (data_action or "insert").lower().strip()
    if act in ("update", "update_or_insert", "insert_or_update", "upsert") or result.rows_updated > 0:
        parts.append(f"{result.rows_updated} atualizadas")
    if act in ("insert", "update_or_insert", "insert_or_update", "upsert") or result.rows_inserted > 0:
        parts.append(f"{result.rows_inserted} inseridas")
    if act == "delete" or result.rows_deleted > 0:
        parts.append(f"{result.rows_deleted} removidas")
    if result.rows_not_matched > 0 or act in ("update", "delete"):
        parts.append(f"{result.rows_not_matched} sem correspondência")

    details = ", ".join(parts)
    return f"Nó {connector_label} sink '{node_id}': {details}"


def quote_identifier(name: str, dialect: str = "postgres") -> str:
    """Escapa e coloca aspas em identificadores de coluna ou tabela com segurança."""
    clean = str(name).strip().strip('"').strip("'")
    escaped = clean.replace('"', '""')
    return f'"{escaped}"'


def quote_table_name(table_name: str, dialect: str = "postgres") -> str:
    """Escapa e coloca aspas em nomes de tabela, suportando schema.tabela."""
    clean = str(table_name).strip().strip('"').strip("'")
    if "." in clean:
        parts = clean.split(".")
        return ".".join(quote_identifier(p, dialect) for p in parts)
    return quote_identifier(clean, dialect)


def resolve_sink_field_options(
    cfg: Dict[str, Any],
    schema_definitions: Optional[List[Dict[str, Any]]] = None,
    df_columns: Optional[List[str]] = None
) -> SinkFieldOptions:
    """Resolve opções de campo para operações DML conforme as regras do tDBOutput.

    Regras:
    1. Se use_field_options for verdadeiro, as chaves e flags vêm de config.field_options.
    2. Se for falso/ausente, vêm de config.keys (compatibilidade) e, se não houver,
       das colunas com isPrimaryKey no schema.
    3. Colunas não-updatable ficam fora do SET; chave não entra no SET.
    4. Colunas não-insertable ficam fora do INSERT.
    """
    raw_cfg = cfg.get("raw_config", {}) if isinstance(cfg.get("raw_config"), dict) else {}
    use_field_options = bool(
        cfg.get("use_field_options", raw_cfg.get("use_field_options", False))
    )
    fail_on_no_match = bool(
        cfg.get("fail_on_no_match", raw_cfg.get("fail_on_no_match", False))
    )

    available_cols = list(df_columns) if df_columns is not None else []
    if not available_cols and schema_definitions:
        available_cols = [
            c.get("name") for c in schema_definitions
            if isinstance(c, dict) and c.get("name")
        ]

    field_options_list = cfg.get("field_options") or raw_cfg.get("field_options") or []

    if use_field_options and field_options_list:
        update_keys: List[str] = []
        deletion_keys: List[str] = []
        updatable_cols: List[str] = []
        insertable_cols: List[str] = []

        for fo in field_options_list:
            if not isinstance(fo, dict):
                continue
            col = str(fo.get("column") or "").strip()
            if not col:
                continue

            if fo.get("update_key"):
                update_keys.append(col)
            if fo.get("deletion_key"):
                deletion_keys.append(col)
            if fo.get("updatable", True):
                # Regra 3: Coluna que é chave não entra no SET
                if not fo.get("update_key"):
                    updatable_cols.append(col)
            if fo.get("insertable", True):
                insertable_cols.append(col)

        # Se df_columns fornecido, filtra colunas que de fato existem na entrada
        if available_cols:
            available_set = set(available_cols)
            # Regra 4: Validar se chaves existem na entrada
            for k in update_keys:
                if k not in available_set:
                    raise DomainValidationError(
                        f"A Update Key '{k}' configurada nas opções de campo não existe no conjunto de colunas de entrada.",
                        code="ERR_SINK_COLUMN_NOT_FOUND"
                    )
            for k in deletion_keys:
                if k not in available_set:
                    raise DomainValidationError(
                        f"A Deletion Key '{k}' configurada nas opções de campo não existe no conjunto de colunas de entrada.",
                        code="ERR_SINK_COLUMN_NOT_FOUND"
                    )
            updatable_cols = [c for c in updatable_cols if c in available_set]
            insertable_cols = [c for c in insertable_cols if c in available_set]

        return SinkFieldOptions(
            use_field_options=True,
            update_keys=update_keys,
            deletion_keys=deletion_keys,
            updatable_cols=updatable_cols,
            insertable_cols=insertable_cols,
            fail_on_no_match=fail_on_no_match,
        )

    # Modo legado / compatibilidade: use_field_options falso ou ausente
    keys = list(cfg.get("keys") or raw_cfg.get("keys") or [])
    if not keys and schema_definitions:
        for c in schema_definitions:
            if isinstance(c, dict) and (c.get("isPrimaryKey") or c.get("is_primary_key")):
                c_name = c.get("name")
                if c_name and c_name not in keys:
                    keys.append(c_name)

    # Regra 4: Validação de colunas se disponíveis
    if available_cols and keys:
        available_set = set(available_cols)
        for k in keys:
            if k not in available_set:
                raise DomainValidationError(
                    f"A chave '{k}' configurada não existe no conjunto de colunas de entrada ({available_cols}).",
                    code="ERR_SINK_COLUMN_NOT_FOUND"
                )

    updatable_cols = [c for c in available_cols if c not in keys]
    insertable_cols = list(available_cols)

    return SinkFieldOptions(
        use_field_options=False,
        update_keys=keys,
        deletion_keys=keys,
        updatable_cols=updatable_cols,
        insertable_cols=insertable_cols,
        fail_on_no_match=fail_on_no_match,
    )


def plan_write(
    data_action: str,
    field_options: SinkFieldOptions,
    component_name: str = "sink"
) -> SinkWritePlan:
    """Valida a Regra 1 (Sem chave não grava) e devolve o plano de gravação DML."""
    act = str(data_action or "insert").lower().strip()

    if act in ("update", "update_or_insert", "insert_or_update", "upsert"):
        keys = field_options.update_keys
        if not keys:
            raise DomainValidationError(
                f"O componente '{component_name}' com ação '{data_action}' exige ao menos uma Update Key. "
                "Defina as chaves em 'Configurações avançadas' (Field Options) ou marque a chave primária no Schema.",
                code="ERR_SINK_KEYS_REQUIRED"
            )
        return SinkWritePlan(
            data_action=act,
            keys=keys,
            updatable_cols=field_options.updatable_cols,
            insertable_cols=field_options.insertable_cols,
            fail_on_no_match=field_options.fail_on_no_match,
            field_options=field_options,
        )

    if act == "delete":
        keys = field_options.deletion_keys
        if not keys:
            raise DomainValidationError(
                f"O componente '{component_name}' com ação 'delete' exige ao menos uma Deletion Key. "
                "Defina as chaves de deleção em 'Configurações avançadas' (Field Options) ou marque a chave primária no Schema.",
                code="ERR_SINK_KEYS_REQUIRED"
            )
        return SinkWritePlan(
            data_action=act,
            keys=keys,
            updatable_cols=[],
            insertable_cols=[],
            fail_on_no_match=field_options.fail_on_no_match,
            field_options=field_options,
        )

    # Insert padrão
    return SinkWritePlan(
        data_action="insert",
        keys=[],
        updatable_cols=[],
        insertable_cols=field_options.insertable_cols,
        fail_on_no_match=field_options.fail_on_no_match,
        field_options=field_options,
    )


def prepare_batch_records(
    records: List[Any],
    columns: List[str],
    keys: List[str],
    is_update_or_delete: bool = True
) -> Tuple[List[Any], int, int]:
    """Filtra chaves nulas (Regra 5) e deduplica por chave no lote (Regra 6: última linha vence).

    Retorna: (records_validos, contagem_duplicados, contagem_chaves_nulas)
    """
    if not keys or not is_update_or_delete:
        return records, 0, 0

    col_index_map = {col: i for i, col in enumerate(columns)}
    key_indices = [col_index_map[k] for k in keys if k in col_index_map]

    if not key_indices:
        return records, 0, 0

    null_key_count = 0
    duplicate_count = 0
    dedup_dict: Dict[tuple, Any] = {}

    for rec in records:
        # Regra 5: Linha com chave nula não casa com ninguém
        has_null = any(rec[idx] is None for idx in key_indices)
        if has_null:
            null_key_count += 1
            continue

        key_tuple = tuple(rec[idx] for idx in key_indices)
        if key_tuple in dedup_dict:
            duplicate_count += 1
        # Regra 6: Última linha vence
        dedup_dict[key_tuple] = rec

    valid_records = list(dedup_dict.values())
    return valid_records, duplicate_count, null_key_count


def prepare_batch_df(
    df: Any,
    keys: List[str],
    is_update_or_delete: bool = True
) -> Tuple[Any, int, int]:
    """Filtra chaves nulas (Regra 5) e deduplica DataFrame Polars por chave (Regra 6: última linha vence).

    Retorna: (df_valido, contagem_duplicados, contagem_chaves_nulas)
    """
    if df is None or df.height == 0 or not keys or not is_update_or_delete:
        return df, 0, 0

    import polars as pl
    existing_keys = [k for k in keys if k in df.columns]
    if not existing_keys:
        return df, 0, 0

    null_cond = pl.any_horizontal([pl.col(k).is_null() for k in existing_keys])
    null_count = df.filter(null_cond).height
    valid_df = df.filter(~null_cond)

    dedup_df = valid_df.unique(subset=existing_keys, keep="last", maintain_order=True)
    dup_count = valid_df.height - dedup_df.height

    return dedup_df, dup_count, null_count


# ─── Construtores de SQL por Dialeto ──────────────────────────────────────────

def build_postgres_staging_create_sql(target_table: str, stage_table: str, columns: List[str]) -> str:
    """Cria tabela temporária de staging com as colunas e tipos exatos da tabela de destino."""
    quoted_target = quote_table_name(target_table, "postgres")
    quoted_cols = ", ".join(quote_identifier(c, "postgres") for c in columns)
    return f"CREATE TEMP TABLE {stage_table} ON COMMIT DROP AS SELECT {quoted_cols} FROM {quoted_target} WITH NO DATA;"


def build_postgres_update_from_stage_sql(
    target_table: str,
    stage_table: str,
    keys: List[str],
    updatable_cols: List[str]
) -> str:
    """Gera UPDATE destino t SET c = s.c FROM _rdf_stage s WHERE t.k = s.k."""
    quoted_target = quote_table_name(target_table, "postgres")
    set_clauses = [
        f'{quote_identifier(c, "postgres")} = s.{quote_identifier(c, "postgres")}'
        for c in updatable_cols
    ]
    set_str = ", ".join(set_clauses)
    where_clauses = [
        f't.{quote_identifier(k, "postgres")} = s.{quote_identifier(k, "postgres")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return f"UPDATE {quoted_target} AS t SET {set_str} FROM {stage_table} AS s WHERE {where_str};"


def build_postgres_insert_from_stage_sql(
    target_table: str,
    stage_table: str,
    keys: List[str],
    insertable_cols: List[str]
) -> str:
    """Gera INSERT INTO destino SELECT FROM _rdf_stage s WHERE NOT EXISTS (SELECT 1 FROM destino t WHERE t.k = s.k)."""
    quoted_target = quote_table_name(target_table, "postgres")
    cols_str = ", ".join(quote_identifier(c, "postgres") for c in insertable_cols)
    where_clauses = [
        f't.{quote_identifier(k, "postgres")} = s.{quote_identifier(k, "postgres")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return (
        f"INSERT INTO {quoted_target} ({cols_str}) "
        f"SELECT {cols_str} FROM {stage_table} AS s "
        f"WHERE NOT EXISTS (SELECT 1 FROM {quoted_target} AS t WHERE {where_str});"
    )


def build_postgres_delete_from_stage_sql(target_table: str, stage_table: str, keys: List[str]) -> str:
    """Gera DELETE FROM destino t USING _rdf_stage s WHERE t.k = s.k."""
    quoted_target = quote_table_name(target_table, "postgres")
    where_clauses = [
        f't.{quote_identifier(k, "postgres")} = s.{quote_identifier(k, "postgres")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return f"DELETE FROM {quoted_target} AS t USING {stage_table} AS s WHERE {where_str};"


def build_postgres_direct_insert_sql(target_table: str, insertable_cols: List[str]) -> str:
    """Gera INSERT padrão com %s para psycopg2.extras.execute_values."""
    quoted_target = quote_table_name(target_table, "postgres")
    cols_str = ", ".join(quote_identifier(c, "postgres") for c in insertable_cols)
    return f"INSERT INTO {quoted_target} ({cols_str}) VALUES %s;"


# ─── Dialeto Oracle ──────────────────────────────────────────────────────────

def build_oracle_merge_sql(
    target_table: str,
    keys: List[str],
    updatable_cols: List[str],
    insertable_cols: List[str],
    columns: List[str],
    only_update: bool = False
) -> str:
    """Gera MERGE INTO Oracle para Update ou Update or Insert."""
    quoted_target = quote_table_name(target_table, "oracle")
    on_clauses = [
        f'tgt.{quote_identifier(k, "oracle")} = src.{quote_identifier(k, "oracle")}'
        for k in keys
    ]
    on_str = " AND ".join(on_clauses)

    select_binds = [
        f':{i+1} AS {quote_identifier(c, "oracle")}'
        for i, c in enumerate(columns)
    ]
    select_src = ", ".join(select_binds)

    update_set = ", ".join([
        f'tgt.{quote_identifier(c, "oracle")} = src.{quote_identifier(c, "oracle")}'
        for c in updatable_cols
    ])

    merge_sql = (
        f"MERGE INTO {quoted_target} tgt "
        f"USING (SELECT {select_src} FROM DUAL) src "
        f"ON ({on_str}) "
    )
    if updatable_cols:
        merge_sql += f"WHEN MATCHED THEN UPDATE SET {update_set} "

    if not only_update and insertable_cols:
        ins_cols = ", ".join(quote_identifier(c, "oracle") for c in insertable_cols)
        ins_vals = ", ".join(f'src.{quote_identifier(c, "oracle")}' for c in insertable_cols)
        merge_sql += f"WHEN NOT MATCHED THEN INSERT ({ins_cols}) VALUES ({ins_vals})"

    return merge_sql.strip()


def build_oracle_delete_sql(target_table: str, keys: List[str]) -> str:
    """Gera DELETE por chaves para Oracle."""
    quoted_target = quote_table_name(target_table, "oracle")
    where_str = " AND ".join([f'{quote_identifier(k, "oracle")} = :{i+1}' for i, k in enumerate(keys)])
    return f"DELETE FROM {quoted_target} WHERE {where_str}"


def build_oracle_insert_sql(target_table: str, insertable_cols: List[str]) -> str:
    """Gera INSERT com bind variables para Oracle."""
    quoted_target = quote_table_name(target_table, "oracle")
    cols_str = ", ".join(quote_identifier(c, "oracle") for c in insertable_cols)
    binds_str = ", ".join(f":{i+1}" for i in range(len(insertable_cols)))
    return f"INSERT INTO {quoted_target} ({cols_str}) VALUES ({binds_str})"


# ─── Dialeto DuckDB ──────────────────────────────────────────────────────────

def build_duckdb_update_from_batch_sql(
    target_table: str,
    batch_table: str,
    keys: List[str],
    updatable_cols: List[str]
) -> str:
    """Gera UPDATE destino SET c = b.c FROM _chunk_batch b WHERE t.k = b.k para DuckDB."""
    quoted_target = quote_table_name(target_table, "duckdb")
    set_clauses = [
        f'{quote_identifier(c, "duckdb")} = {batch_table}.{quote_identifier(c, "duckdb")}'
        for c in updatable_cols
    ]
    set_str = ", ".join(set_clauses)
    where_clauses = [
        f'{quoted_target}.{quote_identifier(k, "duckdb")} = {batch_table}.{quote_identifier(k, "duckdb")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return f"UPDATE {quoted_target} SET {set_str} FROM {batch_table} WHERE {where_str};"


def build_duckdb_insert_from_batch_sql(
    target_table: str,
    batch_table: str,
    keys: List[str],
    insertable_cols: List[str]
) -> str:
    """Gera INSERT INTO destino SELECT FROM _chunk_batch b WHERE NOT EXISTS (SELECT 1 FROM destino t WHERE t.k = b.k)."""
    quoted_target = quote_table_name(target_table, "duckdb")
    cols_str = ", ".join(quote_identifier(c, "duckdb") for c in insertable_cols)
    where_clauses = [
        f't.{quote_identifier(k, "duckdb")} = {batch_table}.{quote_identifier(k, "duckdb")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return (
        f"INSERT INTO {quoted_target} ({cols_str}) "
        f"SELECT {cols_str} FROM {batch_table} "
        f"WHERE NOT EXISTS (SELECT 1 FROM {quoted_target} AS t WHERE {where_str});"
    )


def build_duckdb_delete_from_batch_sql(target_table: str, batch_table: str, keys: List[str]) -> str:
    """Gera DELETE FROM destino WHERE EXISTS (SELECT 1 FROM _chunk_batch b WHERE ...)."""
    quoted_target = quote_table_name(target_table, "duckdb")
    where_clauses = [
        f'{quoted_target}.{quote_identifier(k, "duckdb")} = {batch_table}.{quote_identifier(k, "duckdb")}'
        for k in keys
    ]
    where_str = " AND ".join(where_clauses)
    return f"DELETE FROM {quoted_target} WHERE EXISTS (SELECT 1 FROM {batch_table} WHERE {where_str});"


def build_duckdb_direct_insert_sql(target_table: str, batch_table: str, insertable_cols: List[str]) -> str:
    """Gera INSERT INTO destino (cols) SELECT cols FROM _chunk_batch para DuckDB."""
    quoted_target = quote_table_name(target_table, "duckdb")
    cols_str = ", ".join(quote_identifier(c, "duckdb") for c in insertable_cols)
    return f"INSERT INTO {quoted_target} ({cols_str}) SELECT {cols_str} FROM {batch_table};"
