"""Conector PostgreSQL (Source & Target).

Gerencia conexões com bancos de dados relacionais utilizando resolução segura de segredos
e sanitização automática de mensagens de erro.
"""

import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import psycopg2
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


class PostgresConnector:
    """Conector para banco de dados PostgreSQL com integração ao SecretResolver."""

    def __init__(self, secret_resolver: SecretResolver):
        self.secret_resolver = secret_resolver

    def build_dsn(self, connection: Connection) -> str:
        """Constrói a string de conexão (DSN) em tempo de execução sem persistir a senha.

        A senha é encodada com quote_plus para suportar caracteres especiais como @, /, #, :
        que são separadores em strings de conexão URI-style do psycopg2 / SQLAlchemy.
        Solução para o problema: senha com '@' gerava conflito no parsing da connection string.
        """
        if connection.connector_type != "postgres":
            raise DomainValidationError(
                f"Conector incompatível: esperado 'postgres', recebido '{connection.connector_type}'"
            )

        raw_password = self.secret_resolver.resolve(connection.secret_ref)

        # quote_plus: encapsula a senha para escapar caracteres especiais
        # '@', '/', ':', '#', '?' etc. que quebram o parsing da connection string.
        safe_password = quote_plus(raw_password)

        endpoint = connection.endpoint.strip()

        # Parse simplificado do endpoint: host:port/database ou host/database
        port = 5432
        if "/" in endpoint:
            host_port, dbname = endpoint.split("/", 1)
        else:
            host_port, dbname = endpoint, "postgres"

        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str)
        else:
            host = host_port

        user = connection.options.get("user", "postgres")
        sslmode = connection.options.get("ssl_mode", "prefer")

        # Usa formato libpq keyword=value — mais robusto que URI-style para senhas com chars especiais.
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

        port = 5432
        if "/" in endpoint:
            host_port, dbname = endpoint.split("/", 1)
        else:
            host_port, dbname = endpoint, "postgres"

        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str)
        else:
            host = host_port

        user = quote_plus(connection.options.get("user", "postgres"))
        sslmode = connection.options.get("ssl_mode", "prefer")

        return f"postgresql+psycopg2://{user}:{safe_password}@{host}:{port}/{dbname}?sslmode={sslmode}"

    def test_connection(self, connection: Connection) -> Tuple[bool, str, Optional[int]]:
        """Testa a conectividade executando 'SELECT 1'.

        Retorna (sucesso, mensagem_sanitizada, latência_ms).
        """
        start_time = time.time()
        try:
            dsn = self.build_dsn(connection)
            with psycopg2.connect(dsn, connect_timeout=5) as conn:
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
        dsn = self.build_dsn(connection)
        conn = psycopg2.connect(dsn)
        try:
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
            conn.close()
        except Exception:
            if not conn.closed:
                conn.close()
            raise

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
        batch_size: int = 10000
    ) -> int:
        """Executa gravação com suporte a ações DDL na tabela, DML nos dados e escrita em lotes (Batch Mode / Batch Size)."""
        import polars as pl
        dsn = self.build_dsn(connection)
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                # 1. Pre-Table Action
                if is_first_chunk:
                    if table_action in ("drop_create", "drop_if_exists_create"):
                        cur.execute(f"DROP TABLE IF EXISTS {table_name};")
                        cols_sql = ", ".join([f'"{c}" TEXT' for c in df.columns])
                        cur.execute(f"CREATE TABLE {table_name} ({cols_sql});")
                    elif table_action == "create_if_not_exists":
                        cols_sql = ", ".join([f'"{c}" TEXT' for c in df.columns])
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

