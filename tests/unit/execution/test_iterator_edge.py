"""Testes para validação e execução de Arestas de Iteração (tFlowToIterate)."""

import polars as pl
import pytest

from src.core.application.compiler.validator import GraphValidator, DAGValidator
from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.physical_planner import PhysicalOperator, PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_validator_and_planner_recognize_iterator_edge():
    draft = PipelineDraft(id="test-iterator-pipeline", project_id="proj-1", name="Test Iterator")
    ver = SemanticVersion(1, 0, 0)

    draft.add_node(
        node_id="source_a",
        component_type="connector.db.duckdb",
        component_version=ver,
        config={"query": "SELECT 1 AS cid UNION ALL SELECT 2 AS cid"},
    )
    draft.add_node(
        node_id="source_b",
        component_type="connector.db.duckdb",
        component_version=ver,
        config={"query": "SELECT {{row.cid}} * 10 AS multiplied"},
    )
    draft.connect_ports(PortId("source_a", "out"), PortId("source_b", "input"))

    # 1. Validação DAG com GraphValidator e alias DAGValidator
    validator = DAGValidator()
    report = validator.validate(draft)
    assert report.is_valid is True, f"Validation errors: {report.errors}"
    assert len(report.iterator_edges) == 1

    # 2. Logical Planner
    planner = LogicalPlanner()
    plan = planner.compile(draft, report)
    assert len(plan.iterator_edges) == 1

    scan_b = plan.operators["source_b"]
    assert scan_b.is_iterative is True
    assert "source_a" in scan_b.input_ids
    assert any(t["column_name"] == "cid" for t in scan_b.parameter_tokens)


def test_worker_executes_iterative_scan_loop(tmp_path):
    # 1. Prepara CSV upstream para a Origem A
    csv_a = tmp_path / "customers.csv"
    pl.DataFrame({
        "cliente_id": [101, 102, 103],
        "nome": ["Alice", "Bob", "Charlie"],
    }).write_csv(csv_a)

    sink_parquet = tmp_path / "loop_result.parquet"

    # 2. Configura o Plano Físico com Loop Iterativo + Sink para validação
    plan = PhysicalPlan(
        pipeline_id="pipe-loop-test",
        default_chunk_size=50,
        execution_order=["source_a", "source_b", "sink_op"],
        operators={
            "source_a": PhysicalOperator(
                id="source_a",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(csv_a), "format": "csv"},
            ),
            "source_b": PhysicalOperator(
                id="source_b",
                operator_type="scan",
                engine="duckdb",
                input_ids=["source_a"],
                config={
                    "query": "SELECT {{row.cliente_id}} AS id, '{{source_a.nome}}' AS cliente_nome, {{cliente_id}} * 2 AS pontos",
                    "format": "duckdb",
                },
            ),
            "sink_op": PhysicalOperator(
                id="sink_op",
                operator_type="sink",
                engine="polars",
                input_ids=["source_b"],
                config={"target": str(sink_parquet), "format": "parquet", "write_mode": "replace"},
            ),
        },
    )

    worker = ExecutionWorker()
    execution = Execution(
        id="exec-test-01",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-worker-1",
    )
    final_execution = worker.run(execution, plan)

    assert final_execution.status == ExecutionStatus.SUCCEEDED
    assert final_execution.tasks["source_b"].rows_out == 3
    assert final_execution.tasks["sink_op"].rows_out == 3

    result_df = pl.read_parquet(sink_parquet)
    assert len(result_df) == 3
    assert result_df["id"].to_list() == [101, 102, 103]
    assert result_df["cliente_nome"].to_list() == ["Alice", "Bob", "Charlie"]
    assert result_df["pontos"].to_list() == [202, 204, 206]


def test_interpolate_tokens_case_insensitive_and_types():
    worker = ExecutionWorker()
    row = {
        "BUSINESS_STATUS_CODE": "ACTIVE",
        "GP_LEVEL_UID": "guid-999",
        "STRUCTURE_LEVEL": 5,
        "PERSON_CODE": 1234
    }
    raw_query = """SELECT
{{postgres_source_1.business_status_code}} as status,
{{postgres_source_1.gp_level_uid}} as uid,
{{postgres_source_1.structure_level}} as lvl
WHERE code = {{postgres_source_1.person_code}}"""

    out = worker._interpolate_tokens(raw_query, row, "postgres_source_1")
    assert "'ACTIVE' as status" in out
    assert "'guid-999' as uid" in out
    assert "5 as lvl" in out
    assert "WHERE code = 1234" in out
    assert "{" not in out and "}" not in out

