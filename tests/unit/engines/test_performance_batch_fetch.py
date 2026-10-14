"""Testes para Fetch Size (leitura paginada) e Batch Size (escrita em lotes)."""

import polars as pl
import pytest
from unittest.mock import MagicMock

from src.core.domain.catalog.definitions import DATABASE_SOURCE, DATABASE_TARGET, DUCKDB_SOURCE, DUCKDB_TARGET
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
from src.core.infrastructure.connectors.postgres_connector import PostgresConnector


def test_catalog_schemas_contain_fetch_and_batch_size():
    # 1. Componentes de Source devem ter fetch_size
    assert "fetch_size" in DATABASE_SOURCE.config_schema["properties"]
    assert DATABASE_SOURCE.config_schema["properties"]["fetch_size"]["default"] == 10000

    assert "fetch_size" in DUCKDB_SOURCE.config_schema["properties"]
    assert DUCKDB_SOURCE.config_schema["properties"]["fetch_size"]["default"] == 10000

    # 2. Componentes de Target devem ter use_batch_mode e batch_size
    assert "use_batch_mode" in DATABASE_TARGET.config_schema["properties"]
    assert "batch_size" in DATABASE_TARGET.config_schema["properties"]
    assert DATABASE_TARGET.config_schema["properties"]["use_batch_mode"]["default"] is True
    assert DATABASE_TARGET.config_schema["properties"]["batch_size"]["default"] == 10000

    assert "use_batch_mode" in DUCKDB_TARGET.config_schema["properties"]
    assert "batch_size" in DUCKDB_TARGET.config_schema["properties"]


def test_duckdb_runner_fetch_size_chunking(tmp_path):
    runner = DuckDBRunner()
    db_file = tmp_path / "test_fetch.duckdb"

    # Cria tabela com 7 linhas
    init_df = pl.DataFrame({"id": list(range(1, 8)), "val": [f"item_{i}" for i in range(1, 8)]})
    runner.write_to_duckdb(init_df, "test_table", database_path=str(db_file), table_action="drop_create")

    # Lê com fetch_size = 3 (deve retornar 3 chunks: 3, 3, 1)
    chunks = runner.execute_query_chunks_on_database(
        database_path=str(db_file),
        query="SELECT * FROM test_table ORDER BY id",
        fetch_size=3
    )

    assert len(chunks) == 3
    assert [c.height for c in chunks] == [3, 3, 1]
    combined = pl.concat(chunks)
    assert combined["id"].to_list() == list(range(1, 8))


def test_duckdb_runner_batch_size_writing(tmp_path):
    runner = DuckDBRunner()
    db_file = tmp_path / "test_batch.duckdb"

    # Cria DataFrame com 6 linhas
    df = pl.DataFrame({"id": [1, 2, 3, 4, 5, 6], "status": ["A", "B", "C", "D", "E", "F"]})

    # Escreve com use_batch_mode=True e batch_size=2
    written = runner.write_to_duckdb(
        df=df,
        table_name="batch_table",
        database_path=str(db_file),
        table_action="drop_create",
        data_action="insert",
        use_batch_mode=True,
        batch_size=2
    )

    assert written == 6
    out_df = runner.execute_query_on_database(str(db_file), "SELECT * FROM batch_table ORDER BY id")
    assert out_df.height == 6
    assert out_df["id"].to_list() == [1, 2, 3, 4, 5, 6]


def test_postgres_connector_batch_write_commits():
    # Testa a lógica de particionamento e múltiplos commits do PostgresConnector
    mock_resolver = MagicMock()
    mock_resolver.resolve.return_value = "secret123"
    connector = PostgresConnector(secret_resolver=mock_resolver)

    connection = Connection(
        id="conn_pg",
        project_id="proj_1",
        name="Postgres DW",
        connector_type="postgres",
        endpoint="localhost:5432/mydb",
        secret_ref=SecretReference("secret://db/pass"),
        options={"user": "postgres"}
    )

    df = pl.DataFrame({"id": list(range(1, 11)), "name": [f"user_{i}" for i in range(1, 11)]})

    # Mock do psycopg2.connect
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    with pytest.MonkeyPatch.context() as mp:
        import psycopg2
        mp.setattr(psycopg2, "connect", MagicMock(return_value=mock_conn))

        written = connector.execute_write(
            connection=connection,
            table_name="users",
            df=df,
            table_action="none",
            data_action="insert",
            use_batch_mode=True,
            batch_size=3  # 10 linhas em lotes de 3 => 4 lotes (3, 3, 3, 1)
        )

        assert written == 10
        # cur.executemany deve ter sido chamado 4 vezes
        assert mock_cur.executemany.call_count == 4
        # conn.commit deve ter sido chamado a cada lote (4 commits)
        assert mock_conn.commit.call_count == 4
