import sys
from fastapi.testclient import TestClient
from src.core.infrastructure.web.app import app

client = TestClient(app)

# 1. Create workspace & project & pipeline
ws_res = client.post("/api/v1/workspaces", json={"name": "Test WS"})
ws_id = ws_res.json()["id"]

proj_res = client.post(f"/api/v1/workspaces/{ws_id}/projects", json={"name": "Test Proj", "slug": "test-proj"})
proj_id = proj_res.json()["id"]

pipe_res = client.post(f"/api/v1/projects/{proj_id}/pipelines", json={"name": "teste"})
pipe_id = pipe_res.json()["id"]
revision = pipe_res.json()["revision"]
print(f"Created pipeline {pipe_id} with revision {revision}")

# 2. Simulate update draft with the user's graph
payload = {
    "expected_revision": revision,
    "definition": {
        "metadata": {"id": pipe_id, "name": "teste"},
        "spec": {
            "nodes": [
                {
                    "id": "csv_murralto",
                    "component": {"type": "file_source", "version": "1.0.0"},
                    "config": {"path": "Top Movies dataset.csv", "format": "csv"}
                },
                {
                    "id": "data_mapper_1",
                    "component": {"type": "tmap", "version": "1.0.0"},
                    "config": {}
                },
                {
                    "id": "target_murren00",
                    "component": {"type": "file_sink", "version": "1.0.0"},
                    "config": {"path": "Top Movies dataset.parquet", "format": "parquet"}
                },
                {
                    "id": "file_sink_1",
                    "component": {"type": "file_sink", "version": "1.0.0"},
                    "config": {"path": "Top Movies dataset.csv", "format": "csv"}
                }
            ],
            "edges": [
                {
                    "id": "reactflow__edge-csv_murralto-data_mapper_1",
                    "from": "csv_murralto.main1",
                    "to": "data_mapper_1.input"
                },
                {
                    "id": "reactflow__edge-data_mapper_1-target_murren00",
                    "from": "data_mapper_1.out1",
                    "to": "target_murren00.input"
                },
                {
                    "id": "reactflow__edge-data_mapper_1-file_sink_1",
                    "from": "data_mapper_1.out2",
                    "to": "file_sink_1.input"
                }
            ]
        }
    },
    "layout": {
        "viewport": {"x": 0, "y": 0, "zoom": 1.0},
        "nodes": []
    }
}

update_res = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=payload)
print("Update response status:", update_res.status_code)
print("Update response body:", update_res.text)

if update_res.status_code == 200:
    val_res = client.post(f"/api/v1/pipelines/{pipe_id}/validate")
    print("Validate response status:", val_res.status_code)
    print("Validate response body:", val_res.text)
