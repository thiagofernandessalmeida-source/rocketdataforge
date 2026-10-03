"""Testes de integração do subsistema do compilador em 4 estágios."""

import pytest
from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.operators import LogicalFilter, LogicalScan
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlanner
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion


def test_four_stage_compilation_with_pushdown():
    # 1. Monta o Draft Visual
    draft = PipelineDraft(id="pipeline-analytics", project_id="proj-1", name="Postgres to Parquet")
    ver = SemanticVersion(1, 0, 0)

    draft.add_node(
        node_id="db_source",
        component_type="core.database.source",
        component_version=ver,
        config={"connection_ref": "postgres_dw", "query": "SELECT * FROM sales"}
    )
    draft.add_node(
        node_id="filter_active",
        component_type="core.filter",
        component_version=ver,
        config={"expression": "status == 'ACTIVE'"}
    )
    draft.add_node(
        node_id="select_cols",
        component_type="core.select",
        component_version=ver,
        config={"columns": ["id", "amount", "status"]}
    )
    draft.add_node(
        node_id="file_sink",
        component_type="core.file.target",
        component_version=ver,
        config={"path": "output/active_sales.parquet", "format": "parquet"}
    )

    draft.connect_ports(PortId("db_source", "main"), PortId("filter_active", "input"))
    draft.connect_ports(PortId("filter_active", "main"), PortId("select_cols", "input"))
    draft.connect_ports(PortId("select_cols", "main"), PortId("file_sink", "input"))

    # Estágio 1: Validação
    validator = GraphValidator()
    validation_report = validator.validate(draft)
    assert validation_report.is_valid

    # Estágio 2: Plano Lógico
    logical_planner = LogicalPlanner()
    logical_plan = logical_planner.compile(draft, validation_report)
    assert len(logical_plan.operators) == 4
    scan_op = logical_plan.operators["db_source"]
    assert isinstance(scan_op, LogicalScan)
    assert scan_op.pushed_filter is None

    # Estágio 3: Plano Otimizado com Pushdown
    optimizer = PlanOptimizer()
    capabilities = {
        "db_source": {
            "supports_filter_pushdown": True,
            "supports_projection_pushdown": True
        }
    }
    optimized_plan = optimizer.optimize(logical_plan, capabilities)
    assert len(optimized_plan.optimizations) >= 1
    # Verifica se o predicado foi empurrado para a fonte
    optimized_scan = optimized_plan.plan.operators["db_source"]
    assert isinstance(optimized_scan, LogicalScan)
    assert optimized_scan.pushed_filter == "status == 'ACTIVE'"

    # Estágio 4: Plano Físico
    physical_planner = PhysicalPlanner()
    physical_plan = physical_planner.compile(optimized_plan, default_chunk_size=5000)
    assert physical_plan.default_chunk_size == 5000
    assert len(physical_plan.operators) == 4

    # Postgres Source usa DuckDB
    assert physical_plan.operators["db_source"].engine == "duckdb"
    # File Sink Parquet usa Polars
    assert physical_plan.operators["file_sink"].engine == "polars"


def test_join_pipeline_forces_duckdb():
    draft = PipelineDraft(id="join-pipeline", project_id="proj-1", name="Join ETL")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src_a", "core.file.source", ver, {"path": "a.csv", "format": "csv"})
    draft.add_node("src_b", "core.file.source", ver, {"path": "b.csv", "format": "csv"})
    draft.add_node("join_node", "core.join", ver, {"type": "inner", "left_on": ["id"], "right_on": ["a_id"]})
    draft.add_node("sink_out", "core.file.target", ver, {"path": "out.parquet", "format": "parquet"})

    draft.connect_ports(PortId("src_a", "main"), PortId("join_node", "left"))
    draft.connect_ports(PortId("src_b", "main"), PortId("join_node", "right"))
    draft.connect_ports(PortId("join_node", "main"), PortId("sink_out", "input"))

    validator = GraphValidator()
    report = validator.validate(draft)
    assert report.is_valid

    logical_plan = LogicalPlanner().compile(draft, report)
    optimized_plan = PlanOptimizer().optimize(logical_plan)
    physical_plan = PhysicalPlanner().compile(optimized_plan)

    # Nós de Join e fluxos com junção relacional usam DuckDB
    assert physical_plan.operators["join_node"].engine == "duckdb"
    assert physical_plan.operators["src_a"].engine == "duckdb"
