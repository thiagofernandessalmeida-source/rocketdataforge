"""Implementação do CatalogProvider para PostgreSQL.

Executa consultas otimizadas no pg_catalog utilizando parâmetros estritamente ligados
e sanitização automática de mensagens de erro.
"""

from typing import Any, List, Optional
import re

from src.core.application.metadata.catalog_provider import (
    CatalogColumn,
    CatalogProvider,
    parse_format_type,
)
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


POSTGRES_CATALOG_QUERY = """
SELECT a.attname                                         AS name,
       format_type(a.atttypid, a.atttypmod)              AS data_type,
       NOT a.attnotnull                                  AS nullable,
       COALESCE(pk.is_pk, false)                         AS is_primary_key,
       col_description(a.attrelid, a.attnum)             AS comment
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
    SELECT true AS is_pk
    FROM pg_index x
    WHERE x.indrelid = c.oid AND x.indisprimary AND a.attnum = ANY (x.indkey)
) pk ON true
WHERE n.nspname = %(schema)s
  AND c.relname = %(table)s
  AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
""".strip()


class PostgresCatalogProvider(CatalogProvider):
    """Provedor de introspecção de catálogo para PostgreSQL."""

    def __init__(
        self,
        connection: Optional[Connection] = None,
        conn: Optional[Any] = None,
        secret_resolver: Optional[SecretResolver] = None,
        pool_manager: Optional[Any] = None,
    ):
        self.connection = connection
        self._conn = conn
        self.secret_resolver = secret_resolver or SecretResolver()
        self.pool_manager = pool_manager

    def resolve_type(self, catalog_type: str) -> LogicalDataType:
        """Mapeia tipo do catálogo Postgres para LogicalDataType (Seção 4.3 da proposta)."""
        if not catalog_type:
            return LogicalDataType.UNKNOWN

        clean_type = catalog_type.strip().lower()

        # Arrays
        if clean_type.endswith("[]"):
            return LogicalDataType.ARRAY

        # Remove modifiers como (50), (12,2)
        base_type = re.sub(r"\(.*?\)", "", clean_type).strip()

        if base_type in ("smallint", "int2"):
            return LogicalDataType.INT16
        if base_type in ("integer", "int", "int4"):
            return LogicalDataType.INT32
        if base_type in ("bigint", "int8"):
            return LogicalDataType.INT64
        if base_type in ("real", "float4"):
            return LogicalDataType.FLOAT32
        if base_type in ("double precision", "float8"):
            return LogicalDataType.FLOAT64
        if base_type in ("numeric", "decimal"):
            return LogicalDataType.DECIMAL
        if base_type in ("boolean", "bool"):
            return LogicalDataType.BOOLEAN
        if base_type in (
            "text",
            "character varying",
            "varchar",
            "character",
            "char",
            "bpchar",
            "uuid",
            "citext",
        ):
            return LogicalDataType.STRING
        if base_type == "bytea":
            return LogicalDataType.BINARY
        if base_type == "date":
            return LogicalDataType.DATE
        if base_type in ("time", "time without time zone", "time with time zone", "timetz"):
            return LogicalDataType.TIME
        if base_type in ("timestamp", "timestamp without time zone"):
            return LogicalDataType.TIMESTAMP
        if base_type in ("timestamp with time zone", "timestamptz"):
            return LogicalDataType.TIMESTAMP_TZ
        if base_type in ("json", "jsonb"):
            return LogicalDataType.JSON

        return LogicalDataType.UNKNOWN

    def get_table_columns(
        self,
        catalog: Optional[str],
        schema: Optional[str],
        table: str,
    ) -> List[CatalogColumn]:
        """Obtém colunas da tabela via catálogo do PostgreSQL com parâmetros ligados."""
        target_schema = (schema or "public").strip()
        target_table = table.strip()

        # Se conexão injetada diretamente (ex.: testes ou sessão ativa)
        if self._conn is not None:
            return self._fetch_columns(self._conn, target_schema, target_table)

        if not self.connection:
            raise DomainValidationError("Conexão ou sessão de banco de dados não configurada.")

        # Obtém conexão via pool gerenciado com timeout
        if self.pool_manager is None:
            from src.core.infrastructure.connectors.pool_manager import ConnectionPoolManager
            pool = ConnectionPoolManager.get_instance(secret_resolver=self.secret_resolver)
        else:
            pool = self.pool_manager

        try:
            with pool.get_postgres_connection(self.connection, timeout=10) as conn:
                return self._fetch_columns(conn, target_schema, target_table)
        except Exception as e:
            sanitized = sanitize_message(str(e))
            raise DomainValidationError(f"Erro ao consultar catálogo do PostgreSQL: {sanitized}")

    def _fetch_columns(self, conn: Any, schema: str, table: str) -> List[CatalogColumn]:
        try:
            with conn.cursor() as cur:
                cur.execute(POSTGRES_CATALOG_QUERY, {"schema": schema, "table": table})
                rows = cur.fetchall()

            columns: List[CatalogColumn] = []
            for row in rows:
                col_name, data_type, nullable, is_pk, comment = row
                length, precision, scale = parse_format_type(data_type)
                columns.append(
                    CatalogColumn(
                        name=col_name,
                        data_type=data_type,
                        nullable=bool(nullable),
                        is_primary_key=bool(is_pk),
                        length=length,
                        precision=precision,
                        scale=scale,
                        comment=comment,
                    )
                )
            return columns
        except Exception as e:
            sanitized = sanitize_message(str(e))
            raise DomainValidationError(f"Falha na leitura do catálogo para {schema}.{table}: {sanitized}")
