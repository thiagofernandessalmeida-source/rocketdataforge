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


def test_postgres_execute_query_chunks_named_cursor_not_reused(monkeypatch):
    from unittest.mock import MagicMock
    import psycopg2

    mock_conn = MagicMock()
    mock_setup_cur = MagicMock()
    mock_named_cur = MagicMock()

    named_execute_count = 0
    def named_execute(q):
        nonlocal named_execute_count
        named_execute_count += 1
        if named_execute_count > 1:
            raise psycopg2.ProgrammingError("can't call .execute() on named cursors more than once")

    mock_named_cur.execute.side_effect = named_execute
    mock_named_cur.description = [("id", 23), ("name", 1043)]
    mock_named_cur.fetchmany.side_effect = [[(1, "Alice"), (2, "Bob")], []]

    def fake_cursor(name=None):
        if name:
            return mock_named_cur
        mock_ctx = MagicMock()
        mock_ctx.__enter__.return_value = mock_setup_cur
        return mock_ctx

    mock_conn.cursor.side_effect = fake_cursor
    mock_conn.closed = False

    monkeypatch.setattr(psycopg2, "connect", MagicMock(return_value=mock_conn))

    secret_resolver = SecretResolver(custom_env={"DW_PASS": "pass"})
    connector = PostgresConnector(secret_resolver=secret_resolver)
    conn = Connection(
        id="conn-1",
        project_id="p1",
        name="Postgres",
        connector_type="postgres",
        endpoint="localhost:5432/db",
        secret_ref=SecretReference("secret://env/DW_PASS"),
        options={"user": "u"}
    )

    chunks = list(connector.execute_query_chunks(conn, "SELECT id, name FROM users", fetch_size=10))
    assert len(chunks) == 1
    assert chunks[0].height == 2
    assert named_execute_count == 1
    mock_setup_cur.execute.assert_called_once_with("SET statement_timeout = 0;")
