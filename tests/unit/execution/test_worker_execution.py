"""Testes de execução física do ExecutionWorker."""

import os
import polars as pl
import pytest
from src.core.application.compiler.physical_planner import PhysicalOperator, PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.infrastructure.connectors.file_connector import LocalFileConnector
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_worker_run_physical_plan_to_completion(tmp_path):
    # 1. Cria dataset de entrada com 60 transações
    input_csv = tmp_path / "transactions.csv"
    output_parquet = tmp_path / "high_value_transactions.parquet"

    amounts = [20.0, 150.0, 30.0, 80.0, 200.0, 10.0] * 10  # 60 linhas, 20 com amount >= 100
    df = pl.DataFrame({
        "id": list(range(1, 61)),
        "customer": [f"Cust_{i}" for i in range(1, 61)],
        "amount": amounts
    })
    df.write_csv(input_csv)

    # 2. Constrói o Plano Físico
    plan = PhysicalPlan(
        pipeline_id="pipe-worker-test",
        default_chunk_size=20,
        execution_order=["scan_node", "filter_node", "project_node", "sink_node"],
        operators={
            "scan_node": PhysicalOperator(
                id="scan_node",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(input_csv), "format": "csv"}
            ),
            "filter_node": PhysicalOperator(
                id="filter_node",
                operator_type="filter",
                engine="polars",
                input_ids=["scan_node"],
                config={"predicate": "amount >= 100"}
            ),
            "project_node": PhysicalOperator(
                id="project_node",
                operator_type="project",
                engine="polars",
                input_ids=["filter_node"],
                config={"columns": ["id", "amount"]}
            ),
            "sink_node": PhysicalOperator(
                id="sink_node",
                operator_type="sink",
                engine="polars",
                input_ids=["project_node"],
                config={"target": str(output_parquet), "format": "parquet", "write_mode": "replace"}
            )
        }
    )

    # 3. Dispara a Execução via ExecutionWorker
    execution = Execution(
        id="exec-test-01",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-worker-1"
    )

    file_connector = LocalFileConnector(base_directory=str(tmp_path))
    worker = ExecutionWorker(file_connector=file_connector)
    result_execution = worker.run(execution, plan)

    # 4. Asserções de Estado e Telemetria
    assert result_execution.status == ExecutionStatus.SUCCEEDED
    assert result_execution.started_at is not None
    assert result_execution.finished_at is not None

    # Verifica telemetria das tasks
    scan_task = result_execution.tasks["scan_node"]
    assert scan_task.rows_in == 60
    assert scan_task.rows_out == 60

    filter_task = result_execution.tasks["filter_node"]
    assert filter_task.rows_in == 60
    assert filter_task.rows_out == 20
    assert filter_task.rejected_count == 40

    project_task = result_execution.tasks["project_node"]
    assert project_task.rows_in == 20
    assert project_task.rows_out == 20

    sink_task = result_execution.tasks["sink_node"]
    assert sink_task.rows_out == 20

    # 5. Validação Física do Arquivo Parquet Produzido
    assert os.path.exists(output_parquet)
    out_df = pl.read_parquet(output_parquet)
    assert out_df.height == 20
    assert out_df.columns == ["id", "amount"]
    assert all(val >= 100 for val in out_df["amount"].to_list())


def test_worker_scan_with_schema_definitions(tmp_path):
    input_csv = tmp_path / "mixed.csv"
    output_parquet = tmp_path / "output.parquet"

    # CSV com número nas primeiras linhas e texto na última (provocaria erro de parse se inferido como i64)
    input_csv.write_text("id,vote_count\n1,100\n2,200\n3,en\n", encoding="utf-8")

    plan = PhysicalPlan(
        pipeline_id="pipe-schema-test",
        default_chunk_size=10,
        execution_order=["scan_node", "sink_node"],
        operators={
            "scan_node": PhysicalOperator(
                id="scan_node",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={
                    "source": str(input_csv),
                    "format": "csv",
                    "schema_definitions": [
                        {"name": "id", "type": "String"},
                        {"name": "vote_count", "type": "String"}
                    ]
                }
            ),
            "sink_node": PhysicalOperator(
                id="sink_node",
                operator_type="sink",
                engine="polars",
                input_ids=["scan_node"],
                config={"target": str(output_parquet), "format": "parquet", "write_mode": "replace"}
            )
        }
    )

    execution = Execution(
        id="exec-test-schema",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-schema-1"
    )

    file_connector = LocalFileConnector(base_directory=str(tmp_path))
    worker = ExecutionWorker(file_connector=file_connector)
    result_execution = worker.run(execution, plan)

    assert result_execution.status == ExecutionStatus.SUCCEEDED
    assert os.path.exists(output_parquet)
    out_df = pl.read_parquet(output_parquet)
    assert out_df.height == 3
    assert out_df["vote_count"][2] == "en"


def test_worker_db_scan_named_cursor_success(monkeypatch, tmp_path):
    from unittest.mock import MagicMock
    import psycopg2

    mock_conn = MagicMock()
    mock_setup_cur = MagicMock()
    mock_named_cur = MagicMock()

    named_execute_calls = []
    def named_execute(q):
        named_execute_calls.append(q)
        if len(named_execute_calls) > 1:
            raise psycopg2.ProgrammingError("can't call .execute() on named cursors more than once")

    mock_named_cur.execute.side_effect = named_execute
    mock_named_cur.description = [("id", 23), ("val", 1043)]
    mock_named_cur.fetchmany.side_effect = [[(1, "A"), (2, "B")], []]

    def fake_cursor(name=None):
        if name:
            return mock_named_cur
        mock_ctx = MagicMock()
        mock_ctx.__enter__.return_value = mock_setup_cur
        return mock_ctx

    mock_conn.cursor.side_effect = fake_cursor
    mock_conn.closed = False

    monkeypatch.setattr(psycopg2, "connect", MagicMock(return_value=mock_conn))

    plan = PhysicalPlan(
        pipeline_id="pipe-db-test",
        default_chunk_size=10,
        execution_order=["pg_node"],
        operators={
            "pg_node": PhysicalOperator(
                id="postgres_source_1",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={
                    "source": "SELECT id, val FROM my_table",
                    "format": "postgres",
                    "connection_details": {
                        "host": "localhost",
                        "database": "testdb",
                        "username": "usr",
                        "password": "pwd"
                    }
                }
            )
        }
    )

    execution = Execution(id="exec-db-1", pipeline_version_id="ver-1.0.0", correlation_id="corr-1")
    file_connector = LocalFileConnector(base_directory=str(tmp_path))
    worker = ExecutionWorker(file_connector=file_connector)

    res = worker.run(execution, plan)
    assert res.status == ExecutionStatus.SUCCEEDED
    assert len(named_execute_calls) == 1
    assert "SELECT id, val FROM my_table" in named_execute_calls[0]
    mock_setup_cur.execute.assert_called_once_with("SET statement_timeout = 0;")


def test_duckdb_sink_uses_custom_table_name(tmp_path):
    import duckdb

    db_path = tmp_path / "custom_test.duckdb"
    plan = PhysicalPlan(
        pipeline_id="pipe-duckdb-table-test",
        execution_order=["src_node", "sink_node"],
        operators={
            "src_node": PhysicalOperator(
                id="src_node",
                operator_type="scan",
                engine="duckdb",
                input_ids=[],
                config={
                    "format": "duckdb",
                    "source": "SELECT 101 AS consultant_code, 202601 AS operational_cycle, 95.5 AS index_value",
                },
            ),
            "sink_node": PhysicalOperator(
                id="sink_node",
                operator_type="sink",
                engine="duckdb",
                input_ids=["src_node"],
                config={
                    "format": "duckdb",
                    "database_path": str(db_path),
                    "table": "consultant_index",
                    "target": "consultant_index",
                    "table_action": "create_if_not_exists",
                    "data_action": "insert",
                    "raw_config": {
                        "table": "consultant_index",
                    },
                },
            ),
        },
    )

    execution = Execution(id="exec-table-1", pipeline_version_id="ver-1.0.0", correlation_id="corr-table")
    worker = ExecutionWorker()
    res = worker.run(execution, plan)

    assert res.status == ExecutionStatus.SUCCEEDED
    conn = duckdb.connect(str(db_path))
    tables = [r[0] for r in conn.execute("SHOW TABLES;").fetchall()]
    conn.close()

    assert "consultant_index" in tables
    assert "output_table" not in tables

