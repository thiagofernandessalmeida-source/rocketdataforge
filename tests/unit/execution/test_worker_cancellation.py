"""Testes de cancelamento cooperativo com ExecutionWorker."""

import polars as pl
import pytest
from src.core.application.compiler.physical_planner import PhysicalOperator, PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.infrastructure.connectors.file_connector import LocalFileConnector
from src.core.infrastructure.execution.cancellation import CancellationToken
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_worker_cooperative_cancellation_stops_execution(tmp_path):
    input_csv = tmp_path / "big_data.csv"
    output_parquet = tmp_path / "output_cancelled.parquet"

    # Cria arquivo com 100 linhas
    df = pl.DataFrame({"id": list(range(100)), "val": list(range(100))})
    df.write_csv(input_csv)

    plan = PhysicalPlan(
        pipeline_id="pipe-cancel-test",
        default_chunk_size=10,
        execution_order=["scan_node", "sink_node"],
        operators={
            "scan_node": PhysicalOperator(
                id="scan_node",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(input_csv), "format": "csv"}
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

    execution = Execution(id="exec-cancel-1", pipeline_version_id="v1", correlation_id="c1")

    # Dispara com token já cancelado
    token = CancellationToken()
    token.cancel()

    file_connector = LocalFileConnector(base_directory=str(tmp_path))
    worker = ExecutionWorker(file_connector=file_connector)
    result = worker.run(execution, plan, cancellation_token=token)

    assert result.status == ExecutionStatus.CANCELLED
    assert result.finished_at is not None
    # Nó sink não deve ter sido executado
    assert "sink_node" not in result.tasks or result.tasks["sink_node"].status != ExecutionStatus.SUCCEEDED
