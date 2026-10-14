"""Golden Tests de compilação determinística de pipelines."""

import json
from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlanner
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion

# Definição canônica esperada para o plano físico compilado de referência
EXPECTED_PHYSICAL_PLAN_GOLDEN = {
    "pipeline_id": "golden-pipeline-v1",
    "default_chunk_size": 10000,
    "execution_order": ["src_csv", "filter_active", "select_user", "sink_parquet"],
    "operators": {
        "src_csv": {
            "id": "src_csv",
            "type": "scan",
            "engine": "polars",
            "inputs": [],
            "config": {
                "id": "src_csv",
                "type": "scan",
                "inputs": [],
                "connection_ref": "local_files",
                "source": "data/users.csv",
                "format": "csv",
                "projected_columns": ["id", "username", "email"],
                "pushed_filter": None,
                "connection_details": None,
                "raw_config": {
                    "connection_ref": "local_files",
                    "path": "data/users.csv",
                    "format": "csv"
                },
                "is_iterative": False,
                "parameter_tokens": [],
                "schema_definitions": [],
                "enable_duckdb_view": False,
                "duckdb_query": None
            }
        },
        "filter_active": {
            "id": "filter_active",
            "type": "filter",
            "engine": "polars",
            "inputs": ["src_csv"],
            "config": {
                "id": "filter_active",
                "type": "filter",
                "inputs": ["src_csv"],
                "predicate": "status == 'ACTIVE'"
            }
        },
        "select_user": {
            "id": "select_user",
            "type": "project",
            "engine": "polars",
            "inputs": ["filter_active"],
            "config": {
                "id": "select_user",
                "type": "project",
                "inputs": ["filter_active"],
                "columns": ["id", "username", "email"]
            }
        },
        "sink_parquet": {
            "id": "sink_parquet",
            "type": "sink",
            "engine": "polars",
            "inputs": ["select_user"],
            "config": {
                "id": "sink_parquet",
                "type": "sink",
                "inputs": ["select_user"],
                "target": "output/users.parquet",
                "format": "parquet",
                "write_mode": "replace",
                "table_action": "none",
                "data_action": "insert",
                "keys": [],
                "connection_details": None,
                "raw_config": {
                    "path": "output/users.parquet",
                    "format": "parquet",
                    "write_mode": "replace"
                },
                "database_path": None
            }
        }
    }
}


def test_compiler_golden_deterministic_output():
    """Garante que a compilação do pipeline de referência produz exatamente o plano esperado."""
    draft = PipelineDraft(id="golden-pipeline-v1", project_id="proj-golden", name="Golden Pipeline")
    ver = SemanticVersion(1, 0, 0)

    draft.add_node("src_csv", "core.file.source", ver, {
        "connection_ref": "local_files",
        "path": "data/users.csv",
        "format": "csv"
    })
    draft.add_node("filter_active", "core.filter", ver, {
        "expression": "status == 'ACTIVE'"
    })
    draft.add_node("select_user", "core.select", ver, {
        "columns": ["id", "username", "email"]
    })
    draft.add_node("sink_parquet", "core.file.target", ver, {
        "path": "output/users.parquet",
        "format": "parquet",
        "write_mode": "replace"
    })

    draft.connect_ports(PortId("src_csv", "main"), PortId("filter_active", "input"))
    draft.connect_ports(PortId("filter_active", "main"), PortId("select_user", "input"))
    draft.connect_ports(PortId("select_user", "main"), PortId("sink_parquet", "input"))

    # Executa a esteira de compilação
    validator = GraphValidator()
    report = validator.validate(draft)
    assert report.is_valid

    logical_plan = LogicalPlanner().compile(draft, report)
    # Fonte com projeção habilitada
    capabilities = {"src_csv": {"supports_projection_pushdown": True, "supports_filter_pushdown": False}}
    optimized_plan = PlanOptimizer().optimize(logical_plan, capabilities)
    physical_plan = PhysicalPlanner().compile(optimized_plan, default_chunk_size=10000)

    compiled_dict = physical_plan.to_dict()

    # Compara a estrutura compilada com o Golden esperado
    assert compiled_dict == EXPECTED_PHYSICAL_PLAN_GOLDEN

    # Confirmação de invariância de serialização JSON
    json_compiled = json.dumps(compiled_dict, sort_keys=True)
    json_golden = json.dumps(EXPECTED_PHYSICAL_PLAN_GOLDEN, sort_keys=True)
    assert json_compiled == json_golden
