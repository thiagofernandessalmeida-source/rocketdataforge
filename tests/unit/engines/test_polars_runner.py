"""Testes unitários do PolarsRunner."""

import polars as pl
import pytest
from src.core.infrastructure.engines.polars_runner import PolarsRunner


def test_polars_filter_with_reject_capture():
    runner = PolarsRunner()
    df = pl.DataFrame({
        "id": [1, 2, 3, 4],
        "status": ["ACTIVE", "PENDING", "ACTIVE", "INACTIVE"]
    })

    accepted, rejected = runner.execute_filter(df, "status == 'ACTIVE'", capture_rejects=True)
    assert accepted.height == 2
    assert accepted["id"].to_list() == [1, 3]
    assert rejected is not None
    assert rejected.height == 2
    assert rejected["id"].to_list() == [2, 4]


def test_polars_project():
    runner = PolarsRunner()
    df = pl.DataFrame({
        "col_a": [1, 2],
        "col_b": ["x", "y"],
        "col_c": [10.0, 20.0]
    })

    projected = runner.execute_project(df, ["col_b", "col_a"])
    assert projected.columns == ["col_b", "col_a"]
    assert projected.height == 2
