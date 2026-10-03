"""Conector PostgreSQL (Source & Target).

Gerencia conexões com bancos de dados relacionais utilizando resolução segura de segredos
e sanitização automática de mensagens de erro.
"""

import time
from typing import Any, Dict, Optional, Tuple
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
