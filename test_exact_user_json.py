import json
import traceback
from fastapi.testclient import TestClient
from src.core.infrastructure.web.app import app

client = TestClient(app)

# 1. Setup workspace & project
ws_res = client.post("/api/v1/workspaces", json={"name": "Debug WS"})
ws_id = ws_res.json()["id"]

proj_res = client.post(f"/api/v1/workspaces/{ws_id}/projects", json={"name": "Debug Proj", "slug": "debug-proj"})
proj_id = proj_res.json()["id"]

pipe_res = client.post(f"/api/v1/projects/{proj_id}/pipelines", json={"name": "teste"})
pipe_id = pipe_res.json()["id"]
revision = pipe_res.json()["revision"]

# 2. Replicate what frontend serializeCanvas generates from the user's exact JSON
user_json = {
  "nodes": [
    {
      "id": "csv_murra1to",
      "component": {"type": "core.file.source.csv", "version": "1.0.0"},
      "config": {
        "path": "C:/Users/thial/Downloads/Top Movies dataset.csv"
      }
    },
    {
      "id": "target_murren00",
      "component": {"type": "core.file.target", "version": "1.0.0"},
      "config": {
        "path": "C:/Users/thial/Downloads/Top Movies dataset.parquet"
      }
    },
    {
      "id": "file_sink_1",
      "component": {"type": "core.file.target", "version": "1.0.0"},
      "config": {
        "path": "C:/Users/thial/Downloads/Top Movies dataset.parquet",
        "format": "csv"
      }
    },
    {
      "id": "data_mapper_1",
      "component": {"type": "core.tmap", "version": "1.0.0"},
      "config": {
        "query": " {csv_murra1to.Release_Date} {csv_murra1to.Overview} {csv_murra1to.Overview} {csv_murra1to.Overview} {csv_murra1to.Popularity} {csv_murra1to.Vote_Count}",
        "lookups": [],
        "variables": [
          {
            "id": "v1",
            "name": "var1",
            "type": "String",
            "expression": "row1.Title"
          }
        ],
        "outputs": [
          {
            "id": "out1",
            "name": "out1",
            "targetId": "target_murren00",
            "targetLabel": "Output_parquet",
            "filter_expression": "",
            "catch_output_reject": False,
            "catch_lookup_reject": False,
            "catch_inner_join_reject": False,
            "schema_type": "Built-in",
            "is_reject": False,
            "columns": []
          },
          {
            "id": "out2",
            "name": "out2",
            "targetId": "file_sink_1",
            "targetLabel": "Output_CSV",
            "filter_expression": "",
            "catch_output_reject": False,
            "catch_lookup_reject": False,
            "catch_inner_join_reject": False,
            "schema_type": "Built-in",
            "is_reject": False,
            "columns": []
          }
        ]
      }
    }
  ],
  "edges": [
    {
      "id": "e_main1_1791149698369",
      "from": "csv_murra1to.main1",
      "to": "data_mapper_1.main"
    },
    {
      "id": "e_out1_1791149709492",
      "from": "data_mapper_1.out1",
      "to": "target_murren00.input"
    },
    {
      "id": "e_out2_1791149713828",
      "from": "data_mapper_1.out2",
      "to": "file_sink_1.input"
    }
  ]
}

payload = {
    "expected_revision": revision,
    "definition": {
        "metadata": {"id": pipe_id, "name": "teste"},
        "spec": user_json
    },
    "layout": {
        "viewport": {"x": 0, "y": 0, "zoom": 1.0},
        "nodes": []
    }
}

print("Testing updateDraft...")
try:
    update_res = client.put(f"/api/v1/pipelines/{pipe_id}/draft", json=payload)
    print("Update status:", update_res.status_code)
    print("Update body:", update_res.text)
except Exception as e:
    traceback.print_exc()

print("\nTesting validateDraft...")
try:
    val_res = client.post(f"/api/v1/pipelines/{pipe_id}/validate")
    print("Validate status:", val_res.status_code)
    print("Validate body:", val_res.text)
except Exception as e:
    traceback.print_exc()
