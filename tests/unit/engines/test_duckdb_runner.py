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
