"""Testes unitários do conector PostgreSQL."""

import pytest
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.connectors.postgres_connector import PostgresConnector
from src.core.infrastructure.security.secret_resolver import SecretResolver


def test_postgres_dsn_builder_resolves_secret():
    secret_resolver = SecretResolver(custom_env={"DW_PASS": "my_db_secret_pass"})
    connector = PostgresConnector(secret_resolver=secret_resolver)

    conn = Connection(
        id="conn-dw",
        project_id="p1",
        name="Postgres DW",
        connector_type="postgres",
        endpoint="localhost:5432/analytics",
        secret_ref=SecretReference("secret://env/DW_PASS"),
        options={"user": "etl_user", "ssl_mode": "disable"}
    )

    dsn = connector.build_dsn(conn)
    assert "dbname='analytics'" in dsn
    assert "user='etl_user'" in dsn
    assert "host='localhost'" in dsn
    assert "port='5432'" in dsn
    assert "password='my_db_secret_pass'" in dsn
    assert "sslmode='disable'" in dsn


def test_postgres_test_connection_redacts_on_failure():
    # Testa comportamento diante de falha de conexão (porta inexistente)
    secret_resolver = SecretResolver(custom_env={"DW_PASS": "plain_secret_that_must_not_leak"})
    connector = PostgresConnector(secret_resolver=secret_resolver)

    conn = Connection(
        id="conn-dw",
        project_id="p1",
        name="Postgres DW",
        connector_type="postgres",
        endpoint="127.0.0.1:59999/dummy_db",
        secret_ref=SecretReference("secret://env/DW_PASS"),
        options={"user": "test_user"}
    )

    success, message, latency = connector.test_connection(conn)
    assert success is False
    assert latency is None
    # Garante que mesmo em caso de erro retornado pela biblioteca, a senha não é exibida
    assert "plain_secret_that_must_not_leak" not in message
