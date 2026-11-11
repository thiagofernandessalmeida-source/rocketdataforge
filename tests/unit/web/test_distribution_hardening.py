"""Testes Unitários para a Fase 3 - Endurecimento de Segurança e Distribuição (TASK-031).

Cobre:
3.1 - Autenticação por token X-CellFlow-Token (401 se ausente/inválido, 200 com token, /api/v1/health isento).
3.2 - CELLFLOW_HOME e subpastas (artifacts, policies, db, workspaces gravados dentro de CELLFLOW_HOME e não no cwd).
3.3 - Workspace padrão neutro ("Meu Workspace") sem referências à Natura e criação do job de boas-vindas.
"""

import os
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from src.core.infrastructure.config.cellflow_paths import (
    get_cellflow_home,
    get_cellflow_subpath,
    get_default_workspace_dir,
)
from src.core.infrastructure.persistence.artifact_store import LocalFileSystemArtifactStore
from src.core.infrastructure.security.policy_store import LocalFilePolicyStore
from src.core.infrastructure.scheduler.scheduler_service import SchedulerService
from src.core.application.workspace.workspace_manager import WorkspaceManager
from src.core.infrastructure.web.app import app


@pytest.fixture
def test_client():
    return TestClient(app)


def test_health_check_exempt_from_token(test_client):
    """3.1 e 3.5: /api/v1/health responde 200 sem token, mesmo quando CELLFLOW_TOKEN está ativo."""
    os.environ["CELLFLOW_TOKEN"] = "secret-token-12345"
    try:
        response = test_client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"

        # Rota /health também isenta
        res_root_health = test_client.get("/health")
        assert res_root_health.status_code == 200
    finally:
        os.environ.pop("CELLFLOW_TOKEN", None)


def test_token_auth_middleware_enforcement(test_client):
    """3.1 e 3.5: Chamada sem header X-CellFlow-Token devolve 401; chamada com token correto funciona."""
    os.environ["CELLFLOW_TOKEN"] = "my-secure-cluster-token"
    try:
        # 1. Sem token -> 401 Unauthorized
        res_no_token = test_client.get("/api/v1/workspaces/local/current")
        assert res_no_token.status_code == 401
        assert "ERR_UNAUTHORIZED" in res_no_token.json()["error"]

        # 2. Com token incorreto -> 401 Unauthorized
        res_bad_token = test_client.get(
            "/api/v1/workspaces/local/current",
            headers={"X-CellFlow-Token": "wrong-token"}
        )
        assert res_bad_token.status_code == 401

        # 3. Com token correto -> Sucesso (200)
        res_valid = test_client.get(
            "/api/v1/workspaces/local/current",
            headers={"X-CellFlow-Token": "my-secure-cluster-token"}
        )
        assert res_valid.status_code == 200
    finally:
        os.environ.pop("CELLFLOW_TOKEN", None)


def test_cellflow_home_directory_isolation(monkeypatch):
    """3.2 e 3.5: Arquivos são gravados dentro de CELLFLOW_HOME e não no cwd do projeto."""
    with tempfile.TemporaryDirectory() as tmp_home:
        monkeypatch.setenv("CELLFLOW_HOME", tmp_home)
        home = get_cellflow_home()
        assert str(home) == os.path.abspath(tmp_home)

        # ArtifactStore grava dentro de CELLFLOW_HOME/artifacts
        store = LocalFileSystemArtifactStore()
        assert str(home / "artifacts") == store.base_directory
        uri, chk = store.store_artifact("test_artifact.json", b'{"status": "ok"}')
        safe_file_path = store._resolve_safe_path("test_artifact.json")
        assert os.path.isfile(safe_file_path)
        assert str(home) in safe_file_path

        # PolicyStore grava dentro de CELLFLOW_HOME/policies
        policy_store = LocalFilePolicyStore()
        assert str(home / "policies") == str(policy_store.base_dir)
        policy_store.save_policy("admin", "test-jws-content")
        loaded = policy_store.load_policy_jws("admin")
        assert loaded == "test-jws-content"

        # SchedulerService grava dentro de CELLFLOW_HOME/db
        scheduler_svc = SchedulerService()
        try:
            expected_db_path = str(home / "db" / "scheduler.db")
            assert expected_db_path in scheduler_svc.db_url
        finally:
            scheduler_svc.shutdown()
            scheduler_svc.engine.dispose()


def test_default_workspace_is_neutral_with_welcome_job(monkeypatch):
    """3.3 e 3.5: Workspace padrão neutro 'Meu Workspace' sem referências à Natura e com boas_vindas.rdf."""
    with tempfile.TemporaryDirectory() as tmp_ws_parent:
        custom_default = Path(tmp_ws_parent) / "Meu Workspace"
        monkeypatch.setenv("CELLFLOW_WORKSPACE", str(custom_default))

        mgr = WorkspaceManager(config_dir=tmp_ws_parent)
        default_path = mgr.get_default_workspace_path()
        assert "harmonizacao_brasil" not in default_path
        assert "Natura" not in default_path
        assert "Meu Workspace" in default_path

        info = mgr.get_workspace_info()
        assert info["name"] == "Meu Workspace"

        # Verifica se o job de boas-vindas foi criado
        welcome_file = os.path.join(info["jobsDir"], "boas_vindas.rdf")
        assert os.path.isfile(welcome_file)

        import json
        with open(welcome_file, "r", encoding="utf-8") as f:
            welcome_data = json.load(f)
            assert welcome_data["id"] == "job_boas_vindas"
            assert welcome_data["name"] == "boas_vindas"
            assert len(welcome_data["cells"]) >= 1
