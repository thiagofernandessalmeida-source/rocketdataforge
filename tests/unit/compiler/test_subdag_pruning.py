"""Testes unitários para Poda de Sub-DAG (Sub-DAG Pruning / Run to Node) (Fase 2 - Spec 005).

Valida a travessia reversa do grafo e a compilação do plano lógico executando
apenas os nós ancestrais estritamente necessários para produzir o nó alvo.
"""

import pytest
from src.core.application.compiler.logical_planner import LogicalPlanner, LogicalPlan
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import PortId, SemanticVersion


@pytest.fixture
def make_pipeline():
    """Helper para construir drafts de pipeline para testes de topologia."""
    def _builder(nodes_def, edges_def):
        draft = PipelineDraft(
            id="pipe_test_pruning",
            project_id="proj_test",
            name="Sub-DAG Pruning Test",
            revision=1
        )
        for n_id, c_type in nodes_def:
            draft.add_node(
                node_id=n_id,
                component_type=c_type,
                component_version=SemanticVersion(1, 0, 0),
                config={"table": f"tbl_{n_id}", "path": f"data/{n_id}.csv"}
            )
        for src_node, src_port, tgt_node, tgt_port in edges_def:
            draft.connect_ports(
                from_port=PortId(node_id=src_node, port_name=src_port),
                to_port=PortId(node_id=tgt_node, port_name=tgt_port),
            )
        return draft
    return _builder


def test_subdag_pruning_linear_graph(make_pipeline):
    """Grafo Linear: A -> B -> C -> D. Alvo em B deve podar C e D."""
    nodes = [
        ("A", "core.file.source"),
        ("B", "core.filter"),
        ("C", "core.aggregate"),
        ("D", "core.file.target"),
    ]
    edges = [
        ("A", "output", "B", "input"),
        ("B", "output", "C", "input"),
        ("C", "output", "D", "input"),
    ]
    draft = make_pipeline(nodes, edges)
    planner = LogicalPlanner()

    # 1. Poda no nó intermediário B
    sub_plan_b: LogicalPlan = planner.build_subdag(draft, target_node_id="B")
    assert sub_plan_b.execution_order == ["A", "B"]
    assert set(sub_plan_b.operators.keys()) == {"A", "B"}
    assert "C" not in sub_plan_b.operators
    assert "D" not in sub_plan_b.operators

    # 2. Poda no nó C
    sub_plan_c: LogicalPlan = planner.build_subdag(draft, target_node_id="C")
    assert sub_plan_c.execution_order == ["A", "B", "C"]
    assert "D" not in sub_plan_c.operators


def test_subdag_pruning_branching_and_unrelated_nodes(make_pipeline):
    """Grafo Ramificado com nós não relacionados:
    Ramo 1: Src1 -> Filter1 -> Join1 (main)
    Ramo 2: Src2 -> Filter2 -> Join1 (lookup)
    Ramo pós-join: Join1 -> Target1
    Ramo isolado: Src3 -> Target2
    """
    nodes = [
        ("Src1", "core.file.source"),
        ("Filter1", "core.filter"),
        ("Src2", "connector.db.postgres"),
        ("Filter2", "core.filter"),
        ("Join1", "core.tmap"),
        ("Target1", "core.file.target"),
        ("Src3", "core.file.source"),
        ("Target2", "core.file.target"),
    ]
    edges = [
        ("Src1", "output", "Filter1", "input"),
        ("Filter1", "output", "Join1", "main"),
        ("Src2", "output", "Filter2", "input"),
        ("Filter2", "output", "Join1", "lookup_1"),
        ("Join1", "out", "Target1", "input"),
        ("Src3", "output", "Target2", "input"),
    ]
    draft = make_pipeline(nodes, edges)
    planner = LogicalPlanner()

    # Alvo em Join1: deve incluir {Src1, Filter1, Src2, Filter2, Join1}
    # Deve excluir Target1, Src3 e Target2
    sub_plan = planner.build_subdag(draft, target_node_id="Join1")
    executed = set(sub_plan.execution_order)
    assert executed == {"Src1", "Filter1", "Src2", "Filter2", "Join1"}
    assert "Target1" not in executed
    assert "Src3" not in executed
    assert "Target2" not in executed

    # Ordem topológica respeitada (Join1 é o último)
    assert sub_plan.execution_order[-1] == "Join1"
    assert sub_plan.execution_order.index("Src1") < sub_plan.execution_order.index("Filter1")
    assert sub_plan.execution_order.index("Src2") < sub_plan.execution_order.index("Filter2")

    # Alvo em Filter1: deve incluir apenas {Src1, Filter1}
    sub_filter1 = planner.build_subdag(draft, target_node_id="Filter1")
    assert set(sub_filter1.execution_order) == {"Src1", "Filter1"}
    assert sub_filter1.execution_order == ["Src1", "Filter1"]


def test_subdag_pruning_diamond_topology(make_pipeline):
    """Grafo em Diamante:
    Src -> BranchA -> Merge
    Src -> BranchB -> Merge
    Merge -> Sink
    """
    nodes = [
        ("Src", "core.file.source"),
        ("BranchA", "core.filter"),
        ("BranchB", "core.aggregate"),
        ("Merge", "core.tmap"),
        ("Sink", "core.file.target"),
    ]
    edges = [
        ("Src", "output", "BranchA", "input"),
        ("Src", "output", "BranchB", "input"),
        ("BranchA", "output", "Merge", "main"),
        ("BranchB", "output", "Merge", "lookup_1"),
        ("Merge", "out", "Sink", "input"),
    ]
    draft = make_pipeline(nodes, edges)
    planner = LogicalPlanner()

    sub_plan = planner.build_subdag(draft, target_node_id="Merge")
    assert set(sub_plan.execution_order) == {"Src", "BranchA", "BranchB", "Merge"}
    assert "Sink" not in sub_plan.execution_order
    assert sub_plan.execution_order[0] == "Src"
    assert sub_plan.execution_order[-1] == "Merge"


def test_subdag_pruning_root_node(make_pipeline):
    """Alvo no nó raiz (sem nós a montante): plano deve conter apenas o próprio nó."""
    nodes = [
        ("Root", "core.file.source"),
        ("Child", "core.filter"),
    ]
    edges = [
        ("Root", "output", "Child", "input"),
    ]
    draft = make_pipeline(nodes, edges)
    planner = LogicalPlanner()

    sub_plan = planner.build_subdag(draft, target_node_id="Root")
    assert sub_plan.execution_order == ["Root"]
    assert set(sub_plan.operators.keys()) == {"Root"}


def test_subdag_target_node_not_found(make_pipeline):
    """Nó alvo inexistente deve disparar DomainValidationError."""
    nodes = [("A", "core.file.source")]
    draft = make_pipeline(nodes, [])
    planner = LogicalPlanner()

    with pytest.raises(DomainValidationError) as exc_info:
        planner.build_subdag(draft, target_node_id="NON_EXISTENT")
    assert "não existe" in str(exc_info.value).lower()


def test_api_partial_execution_endpoint(tmp_path):
    """Valida o endpoint POST /api/v1/executions/partial executando apenas o sub-DAG até o nó alvo."""
    import time
    import polars as pl
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # Cria CSV de teste
    csv_file = tmp_path / "data_input.csv"
    df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"],
        "status": ["ACTIVE", "INACTIVE", "ACTIVE"]
    })
    df.write_csv(csv_file)

    out_file = tmp_path / "should_not_exist.parquet"

    # Draft com: src_csv -> filter_active -> sink_pq
    draft_def = {
        "metadata": {"name": "partial_exec_pipe"},
        "spec": {
            "nodes": [
                {
                    "id": "src_csv",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {"path": str(csv_file), "format": "csv", "table": "src_csv"}
                },
                {
                    "id": "filter_active",
                    "component": {"type": "core.filter", "version": "1.0.0"},
                    "config": {"filter_expression": "status = 'ACTIVE'"}
                },
                {
                    "id": "sink_pq",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {"path": str(out_file), "format": "parquet"}
                }
            ],
            "edges": [
                {"from": "src_csv.output", "to": "filter_active.input"},
                {"from": "filter_active.main", "to": "sink_pq.input"}
            ]
        }
    }

    # Executa parcialmente APENAS até filter_active
    payload = {
        "target_node_id": "filter_active",
        "draft_definition": draft_def
    }
    res = client.post("/api/v1/executions/partial", json=payload)
    assert res.status_code == 202
    data = res.json()
    assert "execution_id" in data
    exec_id = data["execution_id"]

    # Aguarda conclusão
    for _ in range(20):
        time.sleep(0.1)
        res_status = client.get(f"/api/v1/executions/{exec_id}")
        if res_status.status_code == 200:
            if res_status.json()["status"] in {"succeeded", "failed", "cancelled"}:
                break

    detail = client.get(f"/api/v1/executions/{exec_id}").json()
    assert detail["status"] == "succeeded"

    executed_nodes = {t["node_id"] for t in detail["tasks"]}
    assert "src_csv" in executed_nodes
    assert "filter_active" in executed_nodes
    assert "sink_pq" not in executed_nodes

    # Garante que sink_pq realmente foi podado e não gerou arquivo
    assert not out_file.exists()


def test_api_partial_execution_validation_errors(tmp_path):
    """Valida erros de validação e nó inexistente na rota de execução parcial."""
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # 1. Sem pipeline_id, version_id ou draft_definition
    res = client.post("/api/v1/executions/partial", json={"target_node_id": "some_node"})
    assert res.status_code == 400

    # 2. Nó alvo inexistente no draft
    draft_def = {
        "metadata": {"name": "pipe"},
        "spec": {
            "nodes": [
                {"id": "A", "component": {"type": "core.file.source", "version": "1.0.0"}, "config": {"table": "t"}}
            ],
            "edges": []
        }
    }
    res2 = client.post("/api/v1/executions/partial", json={"target_node_id": "NON_EXISTENT", "draft_definition": draft_def})
    assert res2.status_code in {400, 404}


def test_api_partial_execution_with_persisted_pipeline(tmp_path):
    """Valida execução parcial referenciando um pipeline_id já persistido."""
    import time
    import polars as pl
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # 1. Cria workspace e projeto
    ws = client.post("/api/v1/workspaces", json={"name": f"WS_Partial_{int(time.time() * 1000)}"}).json()
    proj = client.post(f"/api/v1/workspaces/{ws['id']}/projects", json={"name": "Partial Proj", "slug": "partial-proj"}).json()
    pipe = client.post(f"/api/v1/projects/{proj['id']}/pipelines", json={"name": "Partial Pipe"}).json()
    pipe_id = pipe["id"]

    csv_file = tmp_path / "persisted_input.csv"
    pl.DataFrame({"id": [10, 20], "val": ["x", "y"]}).write_csv(csv_file)
    out_file = tmp_path / "persisted_out.parquet"

    # Salva draft no banco
    client.put(f"/api/v1/pipelines/{pipe_id}/draft", json={
        "expected_revision": 1,
        "definition": {
            "metadata": {"name": "persisted_pipe"},
            "spec": {
                "nodes": [
                    {
                        "id": "node_a",
                        "component": {"type": "core.file.source", "version": "1.0.0"},
                        "config": {"path": str(csv_file), "format": "csv", "table": "tbl_a"}
                    },
                    {
                        "id": "node_b",
                        "component": {"type": "core.filter", "version": "1.0.0"},
                        "config": {"filter_expression": "id > 0"}
                    },
                    {
                        "id": "node_c",
                        "component": {"type": "core.file.target", "version": "1.0.0"},
                        "config": {"path": str(out_file), "format": "parquet"}
                    }
                ],
                "edges": [
                    {"from": "node_a.output", "to": "node_b.input"},
                    {"from": "node_b.main", "to": "node_c.input"}
                ]
            }
        },
        "layout": {"viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0}, "nodes": []}
    })

    # Executa parcialmente via pipeline_id com alvo em node_b
    res = client.post("/api/v1/executions/partial", json={
        "pipeline_id": pipe_id,
        "target_node_id": "node_b"
    })
    assert res.status_code == 202
    exec_id = res.json()["execution_id"]

    for _ in range(20):
        time.sleep(0.1)
        res_status = client.get(f"/api/v1/executions/{exec_id}")
        if res_status.status_code == 200 and res_status.json()["status"] in {"succeeded", "failed", "cancelled"}:
            break

    detail = client.get(f"/api/v1/executions/{exec_id}").json()
    assert detail["status"] == "succeeded"
    tasks = {t["node_id"] for t in detail["tasks"]}
    assert "node_a" in tasks
    assert "node_b" in tasks
    assert "node_c" not in tasks
    assert not out_file.exists()
