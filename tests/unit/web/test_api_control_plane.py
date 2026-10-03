"""Testes de integração da API REST do Control Plane (TASK-022, TASK-023)."""

import os
import tempfile
import time
import polars as pl
import pytest
from starlette.testclient import TestClient

from src.core.infrastructure.web.app import app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture
def sample_csv(tmp_path):
    csv_file = tmp_path / "test_data.csv"
    df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"],
        "status": ["ACTIVE", "INACTIVE", "ACTIVE"]
    })
    df.write_csv(csv_file)
    return str(csv_file)


def test_health_check(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"


def test_workspaces_crud_and_validation(client):
    ws_name = f"Workspace_{int(time.time() * 1000)}"
    res = client.post("/api/v1/workspaces", json={"name": ws_name, "description": "Test WS"})
    assert res.status_code == 201
    ws = res.json()
    assert ws["name"] == ws_name
    assert "id" in ws

    # Conflito de unicidade
    res_dup = client.post("/api/v1/workspaces", json={"name": ws_name})
    assert res_dup.status_code == 409

    # Listagem
    res_list = client.get("/api/v1/workspaces")
    assert res_list.status_code == 200
    assert any(w["name"] == ws_name for w in res_list.json())


def test_projects_crud(client):
    ws_name = f"WS_Proj_{int(time.time() * 1000)}"
    ws = client.post("/api/v1/workspaces", json={"name": ws_name}).json()

    res = client.post(f"/api/v1/workspaces/{ws['id']}/projects", json={
        "name": "Project Alpha",
        "slug": "project-alpha",
        "description": "Alpha Project"
    })
    assert res.status_code == 201
    proj = res.json()
    assert proj["slug"] == "project-alpha"

    # Listagem por workspace
    res_list = client.get(f"/api/v1/workspaces/{ws['id']}/projects")
    assert res_list.status_code == 200
    assert len(res_list.json()) >= 1


def test_catalog_components(client):
    res = client.get("/api/v1/components/catalog")
    assert res.status_code == 200
    components = res.json()
    assert len(components) >= 7

    type_ids = {c["type_id"] for c in components}
    expected_types = {
        "core.database.source",
        "core.file.source",
        "core.select",
        "core.filter",
        "core.join",
        "core.database.target",
        "core.file.target"
    }
    assert expected_types.issubset(type_ids)


def test_schema_inference(client, sample_csv):
    res = client.post("/api/v1/schemas/infer", json={
        "connector_type": "file",
        "path_or_query": sample_csv,
        "sample_size": 100
    })
    assert res.status_code == 200
    data = res.json()
    assert "fields" in data
    col_names = {f["name"] for f in data["fields"]}
    assert {"id", "name", "status"}.issubset(col_names)


def test_connection_security_validation(client):
    ws = client.post("/api/v1/workspaces", json={"name": f"WS_Conn_{int(time.time() * 1000)}"}).json()
    proj = client.post(f"/api/v1/workspaces/{ws['id']}/projects", json={"name": "P1", "slug": "p1"}).json()

    # Tentativa com senha em texto puro em options
    res_sec = client.post("/api/v1/connections", json={
        "project_id": proj["id"],
        "name": "Insecure Conn",
        "connector_type": "postgres",
        "endpoint": "localhost:5432/mydb",
        "secret_ref": "secret://env/DB_PASS",
        "options": {"password": "leak"}
    })
    assert res_sec.status_code == 400
    assert "Violação de segurança" in res_sec.json()["detail"]

    # Tentativa com credencial embutida na URL
    res_url = client.post("/api/v1/connections", json={
        "project_id": proj["id"],
        "name": "Insecure URL",
        "connector_type": "postgres",
        "endpoint": "postgresql://user:pass@localhost:5432/mydb",
        "secret_ref": "secret://env/DB_PASS"
    })
    assert res_url.status_code == 400

    # Criação segura válida
    res_valid = client.post("/api/v1/connections", json={
        "project_id": proj["id"],
        "name": "Secure Conn",
        "connector_type": "postgres",
        "endpoint": "localhost:5432/mydb",
        "secret_ref": "secret://env/DB_PASS",
        "options": {"port": 5432}
    })
    assert res_valid.status_code == 201
    conn_id = res_valid.json()["id"]

    # Teste de conectividade
    res_test = client.post(f"/api/v1/connections/{conn_id}/test")
    assert res_test.status_code == 200
    assert res_test.json()["success"] is True


def test_pipeline_lifecycle_end_to_end(client, sample_csv, tmp_path):
    ws = client.post("/api/v1/workspaces", json={"name": f"WS_Full_{int(time.time() * 1000)}"}).json()
    proj = client.post(f"/api/v1/workspaces/{ws['id']}/projects", json={"name": "Pipeline Project", "slug": "pipe-proj"}).json()

    # 1. Criar pipeline
    res_pipe = client.post(f"/api/v1/projects/{proj['id']}/pipelines", json={"name": "Sales Pipeline"})
    assert res_pipe.status_code == 201
    pipe = res_pipe.json()
    pipe_id = pipe["id"]

    # 2. Obter draft inicial
    draft = client.get(f"/api/v1/pipelines/{pipe_id}/draft").json()
    assert draft["revision"] == 1

    out_file = str(tmp_path / "sales_out.parquet")

    # 3. Atualizar draft com nós válidos
    update_payload = {
        "expected_revision": 1,
        "definition": {
            "metadata": {"name": "Sales Pipeline"},
            "spec": {
                "nodes": [
                    {
                        "id": "src_csv",
                        "component": {"type": "core.file.source", "version": "1.0.0"},
                        "config": {"path": sample_csv, "format": "csv"}
                    },
                    {
                        "id": "filter_active",
                        "component": {"type": "core.filter", "version": "1.0.0"},
                        "config": {"expression": "status == 'ACTIVE'"}
                    },
                    {
                        "id": "sink_pq",
                        "component": {"type": "core.file.target", "version": "1.0.0"},
                        "config": {"path": out_file, "format": "parquet", "write_mode": "replace"}
                    }
                ],
                "edges": [
                    {"from": "src_csv.main", "to": "filter_active.input"},
                    {"from": "filter_active.main", "to": "sink_pq.input"}
                ]
            }
        },
        "layout": {
            "viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0},
            "nodes": [
                {"id": "src_csv", "position": {"x": 50.0, "y": 100.0}},
                {"id": "filter_active", "position": {"x": 250.0, "y": 100.0}},
                {"id": "sink_pq", "position": {"x": 450.0, "y": 100.0}}
            ]
        }
    }

    res_upd = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=update_payload)
    assert res_upd.status_code == 200
    updated_draft = res_upd.json()
    assert updated_draft["revision"] == 2

    # 4. Teste de conflito de concorrência otimista
    res_conf = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=update_payload)
    assert res_conf.status_code == 409

    # 5. Validar grafo
    res_val = client.post(f"/api/v1/pipelines/{pipe_id}/validate")
    assert res_val.status_code == 200
    assert res_val.json()["is_valid"] is True

    # 6. Exportar bundle
    res_exp = client.get(f"/api/v1/pipelines/{pipe_id}/export")
    assert res_exp.status_code == 200
    bundle = res_exp.json()
    assert "schemaVersion: rdf.pipeline/v1" in bundle["pipeline_yaml"]
    assert "rdf.layout/v1" in bundle["layout_json"]

    # 7. Publicar versão imutável
    res_pub = client.post(f"/api/v1/pipelines/{pipe_id}/publish", json={"version_tag": "1.0.0"})
    assert res_pub.status_code == 201
    version = res_pub.json()
    version_id = version["id"]
    assert version["version_tag"] == "1.0.0"

    # 8. Compilar versão
    res_comp = client.post(f"/api/v1/pipeline-versions/{version_id}/compile")
    assert res_comp.status_code == 200
    compiled = res_comp.json()
    assert "physical_plan" in compiled
    assert "execution_order" in compiled["physical_plan"]

    # 9. Disparar execução assíncrona
    res_exec = client.post(f"/api/v1/pipeline-versions/{version_id}/execute")
    assert res_exec.status_code == 202
    exec_resp = res_exec.json()
    exec_id = exec_resp["execution_id"]
    assert exec_resp["status"] in {"created", "planning", "queued", "running", "succeeded"}

    # 10. Aguarda conclusão do processamento assíncrono
    for _ in range(20):
        time.sleep(0.1)
        res_status = client.get(f"/api/v1/executions/{exec_id}")
        assert res_status.status_code == 200
        curr_status = res_status.json()["status"]
        if curr_status in {"succeeded", "failed", "cancelled"}:
            break

    detail = client.get(f"/api/v1/executions/{exec_id}").json()
    assert detail["status"] == "succeeded"
    assert len(detail["tasks"]) >= 3

    # Confirma geração do arquivo final de saída Parquet
    assert os.path.exists(out_file)
    df_out = pl.read_parquet(out_file)
    assert df_out.height == 2  # Apenas os 2 com status ACTIVE

    # 11. Consultar logs estruturados da execução
    res_logs = client.get(f"/api/v1/executions/{exec_id}/logs")
    assert res_logs.status_code == 200
    logs = res_logs.json()
    assert len(logs) > 0
    assert any("Iniciando execução" in l["message"] or "finalizada com SUCESSO" in l["message"] for l in logs)


def test_execution_cancellation_endpoint(client, sample_csv, tmp_path):
    ws = client.post("/api/v1/workspaces", json={"name": f"WS_Cancel_{int(time.time() * 1000)}"}).json()
    proj = client.post(f"/api/v1/workspaces/{ws['id']}/projects", json={"name": "Cancel Proj", "slug": "cancel-proj"}).json()
    pipe = client.post(f"/api/v1/projects/{proj['id']}/pipelines", json={"name": "Cancel Pipe"}).json()

    out_file = str(tmp_path / "cancel_out.parquet")
    client.put(f"/api/v1/pipelines/{pipe['id']}/draft", json={
        "expected_revision": 1,
        "definition": {
            "metadata": {"name": "Cancel Pipe"},
            "spec": {
                "nodes": [
                    {"id": "src", "component": {"type": "core.file.source", "version": "1.0.0"}, "config": {"path": sample_csv, "format": "csv"}},
                    {"id": "sink", "component": {"type": "core.file.target", "version": "1.0.0"}, "config": {"path": out_file, "format": "parquet"}}
                ],
                "edges": [{"from": "src.main", "to": "sink.input"}]
            }
        },
        "layout": {"viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0}, "nodes": []}
    })

    version = client.post(f"/api/v1/pipelines/{pipe['id']}/publish", json={"version_tag": "1.0.0"}).json()
    exec_resp = client.post(f"/api/v1/pipeline-versions/{version['id']}/execute").json()
    exec_id = exec_resp["execution_id"]

    # Cancela imediatamente a execução
    res_cancel = client.post(f"/api/v1/executions/{exec_id}/cancel")
    assert res_cancel.status_code == 200
    detail = res_cancel.json()
    assert detail["execution_id"] == exec_id
    assert "status" in detail

