"""Testes unitários do DuckDBRunner."""

import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


def test_duckdb_execute_query():
    runner = DuckDBRunner(memory_limit="128MB")
    df = pl.DataFrame({"a": [1, 2, 3], "b": [10.5, 20.5, 30.5]})
    runner.register_dataframe("my_table", df)

    res_df = runner.execute_query_to_polars("SELECT a * 2 as double_a FROM my_table WHERE a > 1")
    assert res_df.height == 2
    assert res_df["double_a"].to_list() == [4, 6]
    runner.close()


def test_duckdb_execute_join():
    runner = DuckDBRunner()
    left_df = pl.DataFrame({
        "user_id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"]
    })
    right_df = pl.DataFrame({
        "customer_id": [1, 2, 4],
        "city": ["São Paulo", "Rio de Janeiro", "Curitiba"]
    })

    joined = runner.execute_join(
        left_df=left_df,
        right_df=right_df,
        left_keys=["user_id"],
        right_keys=["customer_id"],
        join_type="inner"
    )

    assert joined.height == 2
    assert "name" in joined.columns
    assert "city" in joined.columns
    assert sorted(joined["name"].to_list()) == ["Alice", "Bob"]
    runner.close()


def test_duckdb_execute_query_on_file(tmp_path):
    """Valida consulta SQL direta em arquivo CSV/Parquet tratando como tabela em memória."""
    csv_file = tmp_path / "sample_users.csv"
    csv_file.write_text("id,name,role,salary\n1,Alice,DEV,8000\n2,Bob,MGR,12000\n3,Charlie,DEV,7500\n", encoding="utf-8")
    
    runner = DuckDBRunner()
    # Executa consulta SQL na view em memória `source_data`
    result_df = runner.execute_query_on_file(
        file_path=str(csv_file),
        format="csv",
        query="SELECT name, salary * 1.1 AS new_salary FROM source_data WHERE role = 'DEV' ORDER BY salary DESC"
    )
    
    assert result_df.height == 2
    assert result_df["name"].to_list() == ["Alice", "Charlie"]
    assert result_df["new_salary"].to_list() == [8800.0, 8250.0]
    runner.close()


def test_duckdb_write_with_table_and_data_actions(tmp_path):
    """Valida operações de escrita no DuckDB com ações de tabela (drop_create, truncate) e de dados (upsert)."""
    db_file = tmp_path / "test_dw.duckdb"
    runner = DuckDBRunner(database_path=str(db_file))
    
    initial_df = pl.DataFrame({
        "id": [1, 2],
        "name": ["Alice", "Bob"],
        "score": [100, 200]
    })
    
    # 1. Cria tabela com drop_create + insert
    rows_written = runner.write_to_duckdb(
        df=initial_df,
        table_name="scores",
        table_action="drop_create",
        data_action="insert"
    )
    assert rows_written == 2
    
    # 2. Upsert
    update_df = pl.DataFrame({
        "id": [2, 3],
        "name": ["Bob Updated", "Charlie"],
        "score": [250, 300]
    })
    runner.write_to_duckdb(
        df=update_df,
        table_name="scores",
        table_action="none",
        data_action="upsert",
        keys=["id"]
    )
    
    res = runner.execute_query_to_polars("SELECT * FROM scores ORDER BY id")
    assert res.height == 3
    assert res["id"].to_list() == [1, 2, 3]
    assert res["name"].to_list() == ["Alice", "Bob Updated", "Charlie"]
    assert res["score"].to_list() == [100, 250, 300]
    
    # 3. Truncate
    runner.write_to_duckdb(
        df=pl.DataFrame({"id": [99], "name": ["Only One"], "score": [999]}),
        table_name="scores",
        table_action="truncate",
        data_action="insert"
    )
    res_truncated = runner.execute_query_to_polars("SELECT * FROM scores")
    assert res_truncated.height == 1
    assert res_truncated["id"].to_list() == [99]
    
    runner.close()

