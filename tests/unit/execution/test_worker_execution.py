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
