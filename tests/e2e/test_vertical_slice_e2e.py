"""Teste End-to-End (E2E) do Vertical Slice 001 (TASK-029).

Valida todo o ciclo de vida do RocketDataForge:
Workspace -> Projeto -> Conexão Segura -> Inferência de Schema -> Draft ->
Validação -> Exportação Desacoplada (YAML + JSON) -> Publicação Imutável ->
Compilação em 4 Estágios -> Execução Assíncrona com Polars/DuckDB ->
Observabilidade OTel -> Cancelamento Cooperativo.
"""

import json
import os
import time
import jsonschema
import polars as pl
import pytest
from starlette.testclient import TestClient
import yaml

from src.core.infrastructure.telemetry.otel_setup import (
    clear_in_memory_telemetry,
    get_in_memory_spans,
    setup_telemetry,
)
from src.core.infrastructure.web.app import app

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "../../specs/001-vertical-slice/contracts")
PIPELINE_SCHEMA_PATH = os.path.abspath(os.path.join(SCHEMA_DIR, "pipeline.schema.json"))
LAYOUT_SCHEMA_PATH = os.path.abspath(os.path.join(SCHEMA_DIR, "layout.schema.json"))


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture
def schemas():
    with open(PIPELINE_SCHEMA_PATH, "r", encoding="utf-8") as f:
        pipe_schema = json.load(f)
    with open(LAYOUT_SCHEMA_PATH, "r", encoding="utf-8") as f:
        lay_schema = json.load(f)
    return pipe_schema, lay_schema


@pytest.fixture
def source_data(tmp_path):
    csv_file = tmp_path / "customers_orders.csv"
    df = pl.DataFrame({
        "order_id": [101, 102, 103, 104, 105, 106],
        "customer_name": ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"],
        "status": ["COMPLETED", "CANCELLED", "COMPLETED", "PENDING", "COMPLETED", "COMPLETED"],
        "amount": [150.50, 45.00, 320.00, 89.90, 450.00, 12.50]
    })
    df.write_csv(csv_file)
    return str(csv_file)


def test_vertical_slice_complete_e2e_journey(client, schemas, source_data, tmp_path):
    pipe_schema, lay_schema = schemas
    clear_in_memory_telemetry()
    setup_telemetry(service_name="E2E-RocketDataForge", in_memory=True)

    timestamp = int(time.time() * 1000)

    # -------------------------------------------------------------------------
    # 1. Criação do Workspace
    # -------------------------------------------------------------------------
    res_ws = client.post("/api/v1/workspaces", json={
        "name": f"Workspace E2E {timestamp}",
        "description": "Workspace para teste de integração ponta a ponta"
    })
    assert res_ws.status_code == 201
    workspace = res_ws.json()
    ws_id = workspace["id"]
    assert workspace["name"] == f"Workspace E2E {timestamp}"

    # -------------------------------------------------------------------------
    # 2. Criação do Projeto
    # -------------------------------------------------------------------------
    res_proj = client.post(f"/api/v1/workspaces/{ws_id}/projects", json={
        "name": "E-Commerce Pipeline Project",
        "slug": f"ecom-proj-{timestamp}",
        "description": "Projeto de processamento analítico de pedidos"
    })
    assert res_proj.status_code == 201
    project = res_proj.json()
    project_id = project["id"]

    # -------------------------------------------------------------------------
    # 3. Cadastro e Teste de Conexão Segura (Zero Plaintext Secrets)
    # -------------------------------------------------------------------------
    # Tentativa inválida com senha em texto puro
    res_insecure = client.post("/api/v1/connections", json={
        "project_id": project_id,
        "name": "Insecure Database",
        "connector_type": "postgres",
        "endpoint": "db.corp.local:5432/finance",
        "secret_ref": "secret://env/DB_PASS",
        "options": {"password": "leaked_plain_secret"}
    })
    assert res_insecure.status_code == 400
    assert "Violação de segurança" in res_insecure.json()["detail"]

    # Cadastro seguro válido
    res_conn = client.post("/api/v1/connections", json={
        "project_id": project_id,
        "name": "Filesystem Source",
        "connector_type": "file",
        "endpoint": str(tmp_path),
        "secret_ref": "secret://env/FS_TOKEN",
        "options": {"timeout": 30}
    })
    assert res_conn.status_code == 201
    connection_id = res_conn.json()["id"]

    # Teste de conectividade
    res_test_conn = client.post(f"/api/v1/connections/{connection_id}/test")
    assert res_test_conn.status_code == 200
    assert res_test_conn.json()["success"] is True

    # -------------------------------------------------------------------------
    # 4. Amostragem e Inferência de Schema
    # -------------------------------------------------------------------------
    res_infer = client.post("/api/v1/schemas/infer", json={
        "connector_type": "file",
        "path_or_query": source_data,
        "sample_size": 1000
    })
    assert res_infer.status_code == 200
    inferred = res_infer.json()
    fields_map = {f["name"]: f["logical_type"] for f in inferred["fields"]}
    assert fields_map["order_id"] in {"int32", "int64"}
    assert fields_map["customer_name"] == "string"
    assert fields_map["status"] == "string"
    assert fields_map["amount"] in {"float32", "float64"}

    # -------------------------------------------------------------------------
    # 5. Criação e Edição do Pipeline Draft
    # -------------------------------------------------------------------------
    res_pipe = client.post(f"/api/v1/projects/{project_id}/pipelines", json={
        "name": "Orders Analytics ETL"
    })
    assert res_pipe.status_code == 201
    pipe_draft = res_pipe.json()
    pipe_id = pipe_draft["id"]
    assert pipe_draft["revision"] == 1

    target_output_parquet = str(tmp_path / "completed_orders.parquet")

    # Monta grafo: Source -> Filter (status == 'COMPLETED') -> Select -> Sink
    update_payload = {
        "expected_revision": 1,
        "definition": {
            "metadata": {"name": "Orders Analytics ETL"},
            "spec": {
                "nodes": [
                    {
                        "id": "src_orders",
                        "component": {"type": "core.file.source", "version": "1.0.0"},
                        "config": {"path": source_data, "format": "csv"}
                    },
                    {
                        "id": "filter_completed",
                        "component": {"type": "core.filter", "version": "1.0.0"},
                        "config": {"expression": "status == 'COMPLETED'"}
                    },
                    {
                        "id": "select_columns",
                        "component": {"type": "core.select", "version": "1.0.0"},
                        "config": {"columns": ["order_id", "customer_name", "status", "amount"]}
                    },
                    {
                        "id": "sink_orders",
                        "component": {"type": "core.file.target", "version": "1.0.0"},
                        "config": {
                            "path": target_output_parquet,
                            "format": "parquet",
                            "write_mode": "replace"
                        }
                    }
                ],
                "edges": [
                    {"from": "src_orders.main", "to": "filter_completed.input"},
                    {"from": "filter_completed.main", "to": "select_columns.input"},
                    {"from": "select_columns.main", "to": "sink_orders.input"}
                ]
            }
        },
        "layout": {
            "viewport": {"x": 0.0, "y": 0.0, "zoom": 1.2},
            "nodes": [
                {"id": "src_orders", "position": {"x": 50.0, "y": 100.0}, "customLabel": "Fonte CSV"},
                {"id": "filter_completed", "position": {"x": 300.0, "y": 100.0}, "customLabel": "Apenas Concluídos"},
                {"id": "select_columns", "position": {"x": 550.0, "y": 100.0}, "customLabel": "Projeção"},
                {"id": "sink_orders", "position": {"x": 800.0, "y": 100.0}, "customLabel": "Parquet DW"}
            ]
        }
    }

    res_upd = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=update_payload)
    assert res_upd.status_code == 200
    saved_draft = res_upd.json()
    assert saved_draft["revision"] == 2

    # -------------------------------------------------------------------------
    # 6. Validação Estrutural e Acíclica do Grafo (Kahn DAG)
    # -------------------------------------------------------------------------
    res_val = client.post(f"/api/v1/pipelines/{pipe_id}/validate")
    assert res_val.status_code == 200
    report = res_val.json()
    assert report["is_valid"] is True
    assert len(report["errors"]) == 0

    # -------------------------------------------------------------------------
    # 7. Exportação Desacoplada e Validação contra JSON Schemas
    # -------------------------------------------------------------------------
    res_exp = client.get(f"/api/v1/pipelines/{pipe_id}/export")
    assert res_exp.status_code == 200
    bundle = res_exp.json()

    # Validação rigorosa contra pipeline.schema.json
    parsed_pipeline_yaml = yaml.safe_load(bundle["pipeline_yaml"])
    jsonschema.validate(instance=parsed_pipeline_yaml, schema=pipe_schema)
    assert parsed_pipeline_yaml["schemaVersion"] == "rdf.pipeline/v1"
    assert len(parsed_pipeline_yaml["spec"]["nodes"]) == 4

    # Validação rigorosa contra layout.schema.json
    parsed_layout_json = json.loads(bundle["layout_json"])
    jsonschema.validate(instance=parsed_layout_json, schema=lay_schema)
    assert parsed_layout_json["schemaVersion"] == "rdf.layout/v1"
    assert len(parsed_layout_json["nodes"]) == 4

    # -------------------------------------------------------------------------
    # 8. Publicação de Versão Imutável
    # -------------------------------------------------------------------------
    res_pub = client.post(f"/api/v1/pipelines/{pipe_id}/publish", json={"version_tag": "1.0.0"})
    assert res_pub.status_code == 201
    version = res_pub.json()
    version_id = version["id"]
    assert len(version["definition_hash"]) == 64

    # -------------------------------------------------------------------------
    # 9. Compilação Determinística nos 4 Estágios
    # -------------------------------------------------------------------------
    res_compile = client.post(f"/api/v1/pipeline-versions/{version_id}/compile")
    assert res_compile.status_code == 200
    compiled = res_compile.json()
    assert "logical_plan" in compiled
    assert "optimized_plan" in compiled
    assert "physical_plan" in compiled

    phys_plan = compiled["physical_plan"]
    assert phys_plan["execution_order"] == [
        "src_orders",
        "filter_completed",
        "select_columns",
        "sink_orders"
    ]

    # -------------------------------------------------------------------------
    # 10. Disparo da Execução Assíncrona Local
    # -------------------------------------------------------------------------
    res_exec = client.post(f"/api/v1/pipeline-versions/{version_id}/execute")
    assert res_exec.status_code == 202
    exec_data = res_exec.json()
    execution_id = exec_data["execution_id"]
    assert exec_data["status"] in {"created", "planning", "queued", "running", "succeeded"}

    # -------------------------------------------------------------------------
    # 11. Polling de Observabilidade e Conclusão
    # -------------------------------------------------------------------------
    max_wait = 25
    for _ in range(max_wait):
        time.sleep(0.1)
        res_poll = client.get(f"/api/v1/executions/{execution_id}")
        assert res_poll.status_code == 200
        status = res_poll.json()["status"]
        if status in {"succeeded", "failed", "cancelled"}:
            break

    detail = client.get(f"/api/v1/executions/{execution_id}").json()
    assert detail["status"] == "succeeded"
    assert len(detail["tasks"]) == 4

    task_map = {t["node_id"]: t for t in detail["tasks"]}
    # Source leu 6 linhas e emitiu 6
    assert task_map["src_orders"]["rows_in"] == 6
    assert task_map["src_orders"]["rows_out"] == 6

    # Filtro filtrou 6 linhas e emitiu 4 (COMPLETED)
    assert task_map["filter_completed"]["rows_in"] == 6
    assert task_map["filter_completed"]["rows_out"] == 4

    # Select projetou 4 linhas
    assert task_map["select_columns"]["rows_in"] == 4
    assert task_map["select_columns"]["rows_out"] == 4

    # Sink gravou 4 linhas
    assert task_map["sink_orders"]["rows_in"] == 4
    assert task_map["sink_orders"]["rows_out"] == 4

    # -------------------------------------------------------------------------
    # 12. Validação da Saída em Disco (.parquet)
    # -------------------------------------------------------------------------
    assert os.path.exists(target_output_parquet)
    output_df = pl.read_parquet(target_output_parquet)
    assert output_df.height == 4
    assert set(output_df.columns) == {"order_id", "customer_name", "status", "amount"}
    # Nenhum registro CANCELLED ou PENDING passou
    assert "Bob" not in output_df["customer_name"].to_list()
    assert "David" not in output_df["customer_name"].to_list()
    assert "Alice" in output_df["customer_name"].to_list()

    # -------------------------------------------------------------------------
    # 13. Verificação de Telemetria OpenTelemetry e Logs Estruturados
    # -------------------------------------------------------------------------
    res_logs = client.get(f"/api/v1/executions/{execution_id}/logs")
    assert res_logs.status_code == 200
    logs = res_logs.json()
    assert len(logs) >= 5
    assert any("Iniciando execução assíncrona" in l["message"] for l in logs)
    assert any("finalizada com SUCESSO" in l["message"] for l in logs)

    spans = get_in_memory_spans()
    assert len(spans) >= 1
    exec_span = spans[-1]
    assert exec_span.attributes.get("rdf.execution_id") == execution_id

    # -------------------------------------------------------------------------
    # 14. Validação de Cancelamento Cooperativo
    # -------------------------------------------------------------------------
    res_exec_2 = client.post(f"/api/v1/pipeline-versions/{version_id}/execute")
    assert res_exec_2.status_code == 202
    exec_2_id = res_exec_2.json()["execution_id"]

    res_cancel = client.post(f"/api/v1/executions/{exec_2_id}/cancel")
    assert res_cancel.status_code == 200
    cancel_detail = res_cancel.json()
    assert cancel_detail["execution_id"] == exec_2_id
    assert "status" in cancel_detail
