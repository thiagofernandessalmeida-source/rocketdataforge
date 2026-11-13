import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
from unittest.mock import MagicMock
from src.core.infrastructure.execution.worker import ExecutionWorker
from src.core.application.compiler.physical_planner import PhysicalPlan, PhysicalOperator


def test_duckdb_runner_execute_query_on_csv_with_semicolon_delimiter(tmp_path):
    csv_file = tmp_path / "semicolon_data.csv"
    csv_file.write_text("id;nome;valor\n1;Produto A;100\n2;Produto B;200\n", encoding="utf-8")

    runner = DuckDBRunner()
    
    # Executa consulta especificando delimiter=';'
    df = runner.execute_query_on_file(
        str(csv_file),
        format_hint="csv",
        delimiter=";",
        encoding="utf-8",
        has_header=True,
        custom_query="SELECT nome, valor FROM source_data WHERE valor > 150"
    )

    assert isinstance(df, pl.DataFrame)
    assert df.columns == ["nome", "valor"]
    assert df.height == 1
    assert df["nome"][0] == "Produto B"
    assert int(df["valor"][0]) == 200


def test_duckdb_runner_execute_query_on_csv_without_header(tmp_path):
    csv_file = tmp_path / "no_header.csv"
    csv_file.write_text("10;Alpha\n20;Beta\n", encoding="utf-8")

    runner = DuckDBRunner()
    
    # Com has_header=False
    df = runner.execute_query_on_file(
        str(csv_file),
        format_hint="csv",
        delimiter=";",
        has_header=False,
        custom_query="SELECT column0 AS id, column1 AS tag FROM source_data"
    )

    assert isinstance(df, pl.DataFrame)
    assert df.columns == ["id", "tag"]
    assert df.height == 2
    assert int(df["id"][0]) == 10
    assert df["tag"][0] == "Alpha"


def test_worker_file_scan_with_duckdb_and_csv_delimiter(tmp_path):
    csv_file = tmp_path / "worker_semicolon.csv"
    csv_file.write_text("codigo;descricao\nXYZ;Item Especial\n", encoding="utf-8")

    op = PhysicalOperator(
        id="csv_scan_node",
        operator_type="scan",
        engine="duckdb",
        config={
            "source": str(csv_file),
            "format": "csv",
            "enable_duckdb_view": True,
            "delimiter": ";",
            "encoding": "utf-8",
            "has_header": True,
            "duckdb_query": 'SELECT "codigo", "descricao" FROM source_data'
        }
    )
    plan = PhysicalPlan(
        pipeline_id="plan-csv-duckdb",
        operators={"csv_scan_node": op},
        execution_order=["csv_scan_node"]
    )

    worker = ExecutionWorker()
    token = MagicMock()
    task = MagicMock()
    node_buffers = {}

    worker._execute_file_scan(
        phys_op=op,
        cfg=op.config,
        plan=plan,
        token=token,
        task=task,
        node_buffers=node_buffers
    )

    assert "csv_scan_node" in node_buffers
    res_df = node_buffers["csv_scan_node"][0]
    assert isinstance(res_df, pl.DataFrame)
    assert res_df.columns == ["codigo", "descricao"]
    assert res_df.height == 1
    assert res_df["codigo"][0] == "XYZ"
    assert res_df["descricao"][0] == "Item Especial"
