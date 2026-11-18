"""Conector PostgreSQL (Source & Target).

Gerencia conexões com bancos de dados relacionais utilizando resolução segura de segredos
e sanitização automática de mensagens de erro.
"""

import time
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import quote_plus

import psycopg2
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


def map_col_to_postgres_ddl(
    col_name: str,
    col_def: Optional[Dict[str, Any]] = None,
    polars_dtype: Optional[Any] = None
) -> str:
    """Mapeia o nome e a definição de uma coluna (ou dtype Polars) para a cláusula DDL do PostgreSQL."""
    import polars as pl
    pg_type = None

    if col_def and isinstance(col_def, dict):
        col_type_str = str(col_def.get("type") or "").strip().lower()
        physical_type_str = str(col_def.get("physicalType") or col_def.get("physical_type") or "").strip()
        length = col_def.get("length")
        precision = col_def.get("precision")
        scale = col_def.get("scale")

        # 1. Se physicalType for fornecido e representar um tipo SQL PostgreSQL válido
        if physical_type_str and physical_type_str.lower() not in ("string", "unknown", "object", ""):
            valid_pg_prefixes = (
                "int", "bigint", "smallint", "serial", "bigserial",
                "varchar", "char", "text", "numeric", "decimal", "float", "real", "double",
                "bool", "date", "time", "timestamp", "json", "bytea", "uuid"
            )
            if any(physical_type_str.lower().startswith(p) for p in valid_pg_prefixes):
                pg_type = physical_type_str.upper()

        # 2. Mapeamento a partir do tipo lógico (Logical Type)
        if not pg_type and col_type_str:
            if col_type_str in ("integer", "int", "int32"):
                pg_type = "INTEGER"
            elif col_type_str in ("long", "int64", "bigint"):
                pg_type = "BIGINT"
            elif col_type_str in ("short", "smallint", "int16", "int8", "byte", "tinyint"):
                pg_type = "SMALLINT"
            elif col_type_str in ("double", "float64", "float8"):
                pg_type = "DOUBLE PRECISION"
            elif col_type_str in ("float", "float32", "float4", "real"):
                pg_type = "REAL"
            elif col_type_str in ("decimal", "numeric", "number"):
                if precision is not None and scale is not None:
                    pg_type = f"NUMERIC({precision}, {scale})"
                elif precision is not None:
                    pg_type = f"NUMERIC({precision})"
                else:
                    pg_type = "NUMERIC"
            elif col_type_str in ("boolean", "bool"):
                pg_type = "BOOLEAN"
            elif col_type_str in ("date",):
                pg_type = "DATE"
            elif col_type_str in ("datetime", "timestamp"):
                pg_type = "TIMESTAMP"
            elif col_type_str in ("timestamp_tz", "timestamptz"):
                pg_type = "TIMESTAMPTZ"
            elif col_type_str in ("time",):
                pg_type = "TIME"
            elif col_type_str in ("json", "object", "array"):
                pg_type = "JSONB"
            elif col_type_str in ("bytes", "binary", "blob"):
                pg_type = "BYTEA"
            elif col_type_str in ("string", "str", "varchar", "text", "char"):
                if length and isinstance(length, int) and length > 0:
                    pg_type = f"VARCHAR({length})"
                else:
                    pg_type = "TEXT"

    # 3. Fallback: dtype Polars no DataFrame
    if not pg_type and polars_dtype is not None:
        if polars_dtype in (pl.Int8, pl.Int16):
            pg_type = "SMALLINT"
        elif polars_dtype == pl.Int32:
            pg_type = "INTEGER"
        elif polars_dtype in (pl.Int64, pl.UInt32, pl.UInt64):
            pg_type = "BIGINT"
        elif polars_dtype == pl.Float32:
            pg_type = "REAL"
        elif polars_dtype == pl.Float64:
            pg_type = "DOUBLE PRECISION"
        elif polars_dtype == pl.Boolean:
            pg_type = "BOOLEAN"
        elif polars_dtype == pl.Date:
            pg_type = "DATE"
        elif polars_dtype in (pl.Time,):
            pg_type = "TIME"
        elif isinstance(polars_dtype, pl.Datetime):
            pg_type = "TIMESTAMPTZ" if polars_dtype.time_zone else "TIMESTAMP"
        elif polars_dtype == pl.Binary:
            pg_type = "BYTEA"
        else:
            pg_type = "TEXT"

    if not pg_type:
        pg_type = "TEXT"

    return f'"{col_name}" {pg_type}'


class PostgresConnector:
    """Conector para banco de dados PostgreSQL com integração ao SecretResolver."""

    def __init__(self, secret_resolver: SecretResolver, pool_manager: Optional[Any] = None):
        self.secret_resolver = secret_resolver
        if pool_manager is None:
            from src.core.infrastructure.connectors.pool_manager import ConnectionPoolManager
            self.pool_manager = ConnectionPoolManager.get_instance(secret_resolver=self.secret_resolver)
        else:
            self.pool_manager = pool_manager

    def build_dsn(self, connection: Connection) -> str:
        r"""Constrói a string de conexão (DSN) em tempo de execução sem persistir a senha.

        No formato libpq (keyword='value'), caracteres especiais como @, /, #, :, ? são literais
        dentro das aspas. Apenas barras invertidas (\) e aspas simples (') precisam de escape.
        """
        if connection.connector_type != "postgres":
            raise DomainValidationError(
                f"Conector incompatível: esperado 'postgres', recebido '{connection.connector_type}'"
            )

        raw_password = self.secret_resolver.resolve(connection.secret_ref)
        safe_password = raw_password.replace('\\', '\\\\').replace("'", "\\'")

        endpoint = connection.endpoint.strip()

        # Parse simplificado do endpoint: host:port/database ou host/database
        port = int(connection.options.get("port") or 5432)
        if "/" in endpoint:
            host_port, dbname = endpoint.split("/", 1)
        else:
            host_port, dbname = endpoint, connection.options.get("database") or connection.options.get("dbname") or "postgres"

        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str)
        else:
            host = host_port

        user = connection.options.get("user") or connection.options.get("username") or "postgres"
        sslmode = connection.options.get("ssl_mode") or connection.options.get("sslMode") or connection.options.get("sslmode") or "prefer"

        # Usa formato libpq keyword=value — caracteres especiais como @ e # são mantidos literais.
        return (
            f"dbname='{dbname}' "
            f"user='{user}' "
            f"host='{host}' "
            f"port='{port}' "
            f"password='{safe_password}' "
            f"sslmode='{sslmode}'"
        )

    def build_sqlalchemy_url(self, connection: Connection) -> str:
        """Constrói URL SQLAlchemy com senha encodada via quote_plus.

        Útil para engines SQLAlchemy (ex: Pandas, Polars via ConnectorX).
        Sem quote_plus, senhas com '@' gerariam uma URL inválida.
        """
        raw_password = self.secret_resolver.resolve(connection.secret_ref)
        safe_password = quote_plus(raw_password)
        endpoint = connection.endpoint.strip()

        port = int(connection.options.get("port") or 5432)
        if "/" in endpoint:
            host_port, dbname = endpoint.split("/", 1)
        else:
            host_port, dbname = endpoint, connection.options.get("database") or connection.options.get("dbname") or "postgres"

        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str)
        else:
            host = host_port

        raw_user = connection.options.get("user") or connection.options.get("username") or "postgres"
        user = quote_plus(raw_user)
        sslmode = connection.options.get("ssl_mode") or connection.options.get("sslMode") or connection.options.get("sslmode") or "prefer"

        return f"postgresql+psycopg2://{user}:{safe_password}@{host}:{port}/{dbname}?sslmode={sslmode}"

    def test_connection(self, connection: Connection) -> Tuple[bool, str, Optional[int]]:
        """Testa a conectividade executando 'SELECT 1'.

        Retorna (sucesso, mensagem_sanitizada, latência_ms).
        """
        start_time = time.time()
        try:
            with self.pool_manager.get_postgres_connection(connection, timeout=5) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
                    cur.fetchone()
            latency = int((time.time() - start_time) * 1000)
            return True, "Conexão com PostgreSQL estabelecida com sucesso.", latency
        except Exception as e:
            raw_err = str(e)
            sanitized_err = sanitize_message(raw_err)
            return False, f"Falha na conexão: {sanitized_err}", None

    def execute_query(self, connection: Connection, query: str) -> Any:
        """Executa consulta SQL retornando cursor de leitura."""
        dsn = self.build_dsn(connection)
        conn = psycopg2.connect(dsn)
        cur = conn.cursor()
        cur.execute(query)
        return cur

    def execute_query_chunks(
        self,
        connection: Connection,
        query: str,
        fetch_size: int = 10000
    ):
        """Executa consulta com cursor de streaming do banco (Fetch Size), gerando DataFrames em chunks para evitar estouro de memória."""
        import polars as pl
        with self.pool_manager.get_postgres_connection(connection) as conn:
            try:
                with conn.cursor() as setup_cur:
                    setup_cur.execute("SET statement_timeout = 0;")
            except Exception:
                pass

            # Cria cursor nomeado para forçar cursor server-side no PostgreSQL
            cur = conn.cursor(name=f"cur_fetch_{int(time.time() * 1000)}")
            cur.itersize = fetch_size
            cur.execute(query)
            col_names = [desc[0] for desc in cur.description] if cur.description else None

            while True:
                batch = cur.fetchmany(fetch_size)
                if not batch:
                    break
                if not col_names and cur.description:
                    col_names = [desc[0] for desc in cur.description]
                actual_cols = col_names or (["result"] if not batch else [f"col_{i}" for i in range(len(batch[0]))])
                from src.core.infrastructure.engines.polars_runner import batch_to_polars_df
                chunk_df = batch_to_polars_df(batch, actual_cols)
                yield chunk_df

            cur.close()

    def stream_extract(
        self,
        connection: Connection,
        query: str,
        fetch_size: int = 10000
    ) -> Iterator[Any]:
        """Método gerador base de extração com Server-Side Cursors para controle de memória (Multi-Tiered Fetch)."""
        yield from self.execute_query_chunks(connection, query, fetch_size=fetch_size)

    def execute_write(
        self,
        connection: Connection,
        table_name: str,
        df: Any,
        table_action: str = "none",
        data_action: str = "insert",
        keys: Optional[List[str]] = None,
        is_first_chunk: bool = True,
        use_batch_mode: bool = True,
        batch_size: int = 10000,
        schema_definitions: Optional[List[Dict[str, Any]]] = None
    ) -> int:
        """Executa gravação com suporte a ações DDL na tabela, DML nos dados e escrita em lotes (Batch Mode / Batch Size)."""
        import polars as pl
        with self.pool_manager.get_postgres_connection(connection) as conn:
            with conn.cursor() as cur:
                # 1. Pre-Table Action
                if is_first_chunk:
                    schema_map = {}
                    if schema_definitions and isinstance(schema_definitions, list):
                        schema_map = {
                            c.get("name"): c
                            for c in schema_definitions
                            if isinstance(c, dict) and c.get("name")
                        }

                    col_clauses = [
                        map_col_to_postgres_ddl(c, schema_map.get(c), df.schema.get(c) if hasattr(df, "schema") else None)
                        for c in df.columns
                    ]

                    # Chaves primárias
                    effective_pks = [k for k in (keys or []) if k in df.columns]
                    if not effective_pks:
                        effective_pks = [
                            c.get("name")
                            for c in (schema_definitions or [])
                            if isinstance(c, dict) and (c.get("isPrimaryKey") or c.get("is_primary_key")) and c.get("name") in df.columns
                        ]
                    if effective_pks:
                        pk_cols = ", ".join([f'"{k}"' for k in effective_pks])
                        col_clauses.append(f"PRIMARY KEY ({pk_cols})")

                    cols_sql = ", ".join(col_clauses)

                    if table_action in ("drop_create", "drop_if_exists_create"):
                        cur.execute(f"DROP TABLE IF EXISTS {table_name};")
                        cur.execute(f"CREATE TABLE {table_name} ({cols_sql});")
                    elif table_action == "create_if_not_exists":
                        cur.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({cols_sql});")
                    elif table_action in ("truncate", "delete_all"):
                        try:
                            cur.execute(f"TRUNCATE TABLE {table_name};")
                        except Exception:
                            cur.execute(f"DELETE FROM {table_name};")

                if df.height == 0:
                    conn.commit()
                    return 0

                # 2. Data Action
                cols = [f'"{c}"' for c in df.columns]
                placeholders = ", ".join(["%s"] * len(cols))
                cols_str = ", ".join(cols)

                records = df.rows()

                if data_action == "insert":
                    query = f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders});"
                    target_records = records
                elif data_action in ("upsert", "update_or_insert", "insert_or_update") and keys:
                    key_cols = [f'"{k}"' for k in keys]
                    update_set = ", ".join([f'"{c}" = EXCLUDED."{c}"' for c in df.columns if c not in keys])
                    query = f"""
                        INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders})
                        ON CONFLICT ({", ".join(key_cols)}) DO UPDATE SET {update_set};
                    """
                    target_records = records
                elif data_action == "delete" and keys:
                    where_clause = " AND ".join([f'"{k}" = %s' for k in keys])
                    key_indices = [df.columns.index(k) for k in keys]
                    target_records = [[rec[i] for i in key_indices] for rec in records]
                    query = f"DELETE FROM {table_name} WHERE {where_clause};"
                else:
                    query = f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders});"
                    target_records = records

                # Execução em lote (Batch Mode) com commits intermediários
                if use_batch_mode and batch_size > 0:
                    for i in range(0, len(target_records), batch_size):
                        batch_slice = target_records[i:i + batch_size]
                        cur.executemany(query, batch_slice)
                        conn.commit()
                else:
                    cur.executemany(query, target_records)
                    conn.commit()

                return df.height

