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


def test_postgres_dsn_preserves_special_characters_in_password():
    """Garante que senhas com @, #, !, %, /, etc. NÃO são corrompidas por quote_plus no DSN libpq."""
    raw_pass = "qweQWE123!@#asd"
    secret_resolver = SecretResolver(custom_env={"DW_PASS": raw_pass})
    connector = PostgresConnector(secret_resolver=secret_resolver)

    conn = Connection(
        id="conn-special",
        project_id="p1",
        name="Postgres Special",
        connector_type="postgres",
        endpoint="commercial-reports-db.prd.naturacloud.com:5432/odsdw",
        secret_ref=SecretReference("secret://env/DW_PASS"),
        options={"user": "odsdw_user", "ssl_mode": "prefer"}
    )

    dsn = connector.build_dsn(conn)
    # Senha deve ser mantida literal no formato libpq keyword='value'
    assert f"password='{raw_pass}'" in dsn
    assert "%40" not in dsn
    assert "%23" not in dsn


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


def test_postgres_execute_write_creates_table_with_schema_data_types(monkeypatch):
    """Garante que execute_write utiliza os tipos definidos no schema_definitions em vez de TEXT genérico."""
    from unittest.mock import MagicMock
    import polars as pl

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_pool = MagicMock()
    mock_pool.get_postgres_connection.return_value.__enter__.return_value = mock_conn

    secret_resolver = SecretResolver(custom_env={"DW_PASS": "pass"})
    connector = PostgresConnector(secret_resolver=secret_resolver, pool_manager=mock_pool)

    conn = Connection(
        id="conn-dw",
        project_id="p1",
        name="Postgres DW",
        connector_type="postgres",
        endpoint="localhost:5432/odsdw",
        secret_ref=SecretReference("secret://env/DW_PASS")
    )

    df = pl.DataFrame({
        "cd_pessoa": [188559825],
        "cpf": ["12345678910"],
        "validacao_01": [0],
        "salario": [1500.50],
        "ativo": [True],
        "data_cadastro": ["2026-01-01"]
    })

    schema_definitions = [
        {"name": "cd_pessoa", "type": "Integer"},
        {"name": "cpf", "type": "String", "length": 11},
        {"name": "validacao_01", "type": "Integer"},
        {"name": "salario", "type": "Decimal", "precision": 10, "scale": 2},
        {"name": "ativo", "type": "Boolean"},
        {"name": "data_cadastro", "type": "Date"}
    ]

    connector.execute_write(
        connection=conn,
        table_name="public.migra_1_atendentes",
        df=df,
        table_action="create_if_not_exists",
        schema_definitions=schema_definitions
    )

    # Verifica chamadas cur.execute
    create_table_calls = [
        call_args[0][0] for call_args in mock_cur.execute.call_args_list
        if "CREATE TABLE" in call_args[0][0]
    ]
    assert len(create_table_calls) == 1
    create_sql = create_table_calls[0]

    assert 'CREATE TABLE IF NOT EXISTS public.migra_1_atendentes' in create_sql
    assert '"cd_pessoa" INTEGER' in create_sql
    assert '"cpf" VARCHAR(11)' in create_sql
    assert '"validacao_01" INTEGER' in create_sql
    assert '"salario" NUMERIC(10, 2)' in create_sql
    assert '"ativo" BOOLEAN' in create_sql
    assert '"data_cadastro" DATE' in create_sql
    assert '"cd_pessoa" TEXT' not in create_sql


def test_postgres_execute_write_create_if_not_exists_with_primary_key():
    """Garante inclusão de PRIMARY KEY quando keys é informado."""
    from unittest.mock import MagicMock
    import polars as pl

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_pool = MagicMock()
    mock_pool.get_postgres_connection.return_value.__enter__.return_value = mock_conn

    secret_resolver = SecretResolver(custom_env={"DW_PASS": "pass"})
    connector = PostgresConnector(secret_resolver=secret_resolver, pool_manager=mock_pool)

    conn = Connection(
        id="conn-dw",
        project_id="p1",
        name="Postgres DW",
        connector_type="postgres",
        endpoint="localhost:5432/odsdw",
        secret_ref=SecretReference("secret://env/DW_PASS")
    )

    df = pl.DataFrame({"id": [1], "name": ["Teste"]})
    schema_definitions = [
        {"name": "id", "type": "Integer", "isPrimaryKey": True},
        {"name": "name", "type": "String"}
    ]

    connector.execute_write(
        connection=conn,
        table_name="public.users",
        df=df,
        table_action="drop_create",
        keys=["id"],
        schema_definitions=schema_definitions
    )

    create_table_calls = [
        call_args[0][0] for call_args in mock_cur.execute.call_args_list
        if "CREATE TABLE" in call_args[0][0]
    ]
    assert len(create_table_calls) == 1
    create_sql = create_table_calls[0]
    assert '"id" INTEGER' in create_sql
    assert 'PRIMARY KEY ("id")' in create_sql
