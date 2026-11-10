import os
import tempfile
import pytest
from src.core.application.workspace.workspace_manager import WorkspaceManager


def test_workspace_manager_initialization():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Custom workspaces config location
        mgr = WorkspaceManager(config_dir=tmpdir)
        info = mgr.get_workspace_info()

        assert info["name"] in ("harmonizacao_brasil", "CellFlow_Workspace")
        assert os.path.exists(info["path"])
        assert os.path.exists(info["jobsDir"])
        assert os.path.exists(info["dataDir"])
        assert os.path.exists(info["connectionsDir"])
        assert os.path.exists(info["queriesDir"])


def test_workspace_manager_duckdb_path_resolution():
    with tempfile.TemporaryDirectory() as tmpdir:
        mgr = WorkspaceManager(config_dir=tmpdir)
        ws_info = mgr.get_workspace_info()
        data_dir = ws_info["dataDir"]
        ws_dir = ws_info["path"]

        # Filename only -> gravado dentro de data/
        resolved = mgr.resolve_duckdb_path("vendas_2026.duckdb")
        expected = os.path.normpath(os.path.join(data_dir, "vendas_2026.duckdb"))
        assert os.path.normpath(resolved) == expected

        # Relative path data/
        resolved_rel = mgr.resolve_duckdb_path("data/clientes.duckdb")
        expected_rel = os.path.normpath(os.path.join(ws_dir, "data", "clientes.duckdb"))
        assert os.path.normpath(resolved_rel) == expected_rel

        # Caminho customizado com subpasta
        resolved_custom = mgr.resolve_duckdb_path("custom_out/saida.duckdb")
        expected_custom = os.path.normpath(os.path.join(ws_dir, "custom_out", "saida.duckdb"))
        assert os.path.normpath(resolved_custom) == expected_custom

        # Caminho absoluto
        abs_target = os.path.join(tmpdir, "outside", "banco.duckdb")
        resolved_abs = mgr.resolve_duckdb_path(abs_target)
        assert os.path.normpath(resolved_abs) == os.path.normpath(abs_target)

        # In-memory remains unchanged
        assert mgr.resolve_duckdb_path(":memory:") == ":memory:"


def test_workspace_manager_switch_and_sync():
    with tempfile.TemporaryDirectory() as tmpdir:
        mgr = WorkspaceManager(config_dir=tmpdir)

        ws2_path = os.path.join(tmpdir, "CustomProject")
        new_ws = mgr.set_active_workspace(ws2_path, name="CustomProject")
        assert new_ws["name"] == "CustomProject"
        assert os.path.exists(ws2_path)

        # Save and load sync state
        jobs = [{"id": "job_1", "name": "ETL Vendas"}]
        conns = [{"id": "conn_1", "name": "Oracle Prod"}]
        queries = [{"id": "q_1", "title": "Top Customers"}]

        success = mgr.save_workspace_state({
            "activeJobId": "job_1",
            "jobs": jobs,
            "connections": conns,
            "queryBank": queries,
        })
        assert success is True

        loaded = mgr.load_workspace_state()
        assert loaded["activeJobId"] == "job_1"
        assert len(loaded["jobs"]) == 1
        assert loaded["jobs"][0]["name"] == "ETL Vendas"
        assert len(loaded["connections"]) == 1


def test_workspace_manager_set_active_workspace_keyword_arguments():
    """Valida que set_active_workspace aceita path, workspace_path e kwargs sem erro de unexpected keyword argument."""
    with tempfile.TemporaryDirectory() as tmpdir:
        mgr = WorkspaceManager(config_dir=tmpdir)

        # 1. Chamada com path explicitamente nomeado (conforme rota FastAPI)
        path_test1 = os.path.join(tmpdir, "WsPathNamed")
        ws1 = mgr.set_active_workspace(path=path_test1, name="WsPathNamed")
        assert ws1["name"] == "WsPathNamed"
        assert os.path.isdir(path_test1)

        # 2. Chamada com workspace_path explicitamente nomeado
        path_test2 = os.path.join(tmpdir, "WsWorkspacePathNamed")
        ws2 = mgr.set_active_workspace(workspace_path=path_test2, name="WsWorkspacePathNamed")
        assert ws2["name"] == "WsWorkspacePathNamed"
        assert os.path.isdir(path_test2)

        # 3. Chamada via **kwargs
        path_test3 = os.path.join(tmpdir, "WsKwargs")
        kwargs_dict = {"path": path_test3, "name": "WsKwargs"}
        ws3 = mgr.set_active_workspace(**kwargs_dict)
        assert ws3["name"] == "WsKwargs"
        assert os.path.isdir(path_test3)


def test_workspace_manager_api_select_workspace():
    """Valida via API FastAPI que a rota /workspaces/local/select carrega os metadados sem exceções."""
    from fastapi.testclient import TestClient
    from src.core.infrastructure.web.main import app

    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        target_ws = os.path.join(tmpdir, "harmonizacao_brasil_test")

        # Payload com 'path'
        resp = client.post("/api/v1/workspaces/local/select", json={"path": target_ws, "name": "Harmonizacao Test"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["name"] == "Harmonizacao Test"
        assert os.path.isdir(data["path"])
        assert "jobsDir" in data
        assert "dataDir" in data

        # Payload com 'workspace_path'
        target_ws2 = os.path.join(tmpdir, "harmonizacao_brasil_test2")
        resp2 = client.post("/api/v1/workspaces/local/select", json={"workspace_path": target_ws2, "name": "Harmonizacao Test 2"})
        assert resp2.status_code == 200, resp2.text
        data2 = resp2.json()
        assert data2["name"] == "Harmonizacao Test 2"
        assert os.path.isdir(data2["path"])
