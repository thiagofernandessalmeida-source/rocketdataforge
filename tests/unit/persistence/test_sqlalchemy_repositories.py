"""Testes integrados dos repositórios SQLAlchemy com banco em memória."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.metadata.connection import Connection
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.pipeline.version import PipelineVersion
from src.core.domain.shared.types import PortId, SecretReference, SemanticVersion
from src.core.infrastructure.persistence.connection_repository import (
    SqlAlchemyConnectionRepository,
)
from src.core.infrastructure.persistence.execution_repository import (
    SqlAlchemyExecutionRepository,
)
from src.core.infrastructure.persistence.models import (
    Base,
    ProjectModel,
    WorkspaceModel,
)
from src.core.infrastructure.persistence.pipeline_repository import (
    SqlAlchemyPipelineRepository,
)


@pytest.fixture
def db_session():
    """Cria uma sessão isolada com banco SQLite em memória."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    session = session_factory()

    # Cria Workspace e Project iniciais para integridade referencial
    ws = WorkspaceModel(id="ws-01", name="Default Workspace")
    proj = ProjectModel(id="proj-01", workspace_id="ws-01", name="Analytics", slug="analytics")
    session.add_all([ws, proj])
    session.commit()

    yield session
    session.close()


def test_connection_repository_crud(db_session):
    repo = SqlAlchemyConnectionRepository(db_session)
    conn = Connection(
        id="conn-01",
        project_id="proj-01",
        name="DW Postgres",
        connector_type="postgres",
        endpoint="localhost:5432/dw",
        secret_ref=SecretReference("secret://env/DW_PASS"),
        options={"ssl_mode": "require"}
    )

    repo.save(conn)
    db_session.commit()

    retrieved = repo.get("conn-01")
    assert retrieved is not None
    assert retrieved.name == "DW Postgres"
    assert retrieved.secret_ref.uri == "secret://env/DW_PASS"
    assert retrieved.options["ssl_mode"] == "require"

    listed = repo.list_by_project("proj-01")
    assert len(listed) == 1


def test_pipeline_repository_draft_and_version(db_session):
    repo = SqlAlchemyPipelineRepository(db_session)
    ver = SemanticVersion(1, 0, 0)

    # 1. Cria Draft com nós e layout visual
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="ETL Customers")
    draft.add_node("source", "core.file.source", ver, {"path": "in.csv"})
    draft.add_node("target", "core.file.target", ver, {"path": "out.parquet"})
    draft.connect_ports(PortId("source", "main"), PortId("target", "input"))

    layout = {
        "viewport": {"x": 100, "y": 200, "zoom": 1.0},
        "nodes": [
            {"id": "source", "position": {"x": 10, "y": 20}},
            {"id": "target", "position": {"x": 300, "y": 20}}
        ]
    }

    repo.save_draft(draft, layout)
    db_session.commit()

    # 2. Recupera Draft e Layout
    res = repo.get_draft("pipe-01")
    assert res is not None
    retrieved_draft, retrieved_layout = res

    assert retrieved_draft.name == "ETL Customers"
    assert len(retrieved_draft.nodes) == 2
    assert len(retrieved_draft.edges) == 1
    assert retrieved_layout["viewport"]["zoom"] == 1.0

    # 3. Publica Versão Imutável
    version = PipelineVersion.publish(
        pipeline_id=draft.id,
        version_tag="1.0.0",
        canonical_definition=draft.to_canonical_dict(),
        published_by="developer"
    )
    repo.save_version(version)
    db_session.commit()

    retrieved_version = repo.get_version(version.definition_hash)
    assert retrieved_version is not None
    assert retrieved_version.version_tag == "1.0.0"
    assert retrieved_version.definition_hash == version.definition_hash


def test_execution_repository_lifecycle_and_tasks(db_session):
    pipe_repo = SqlAlchemyPipelineRepository(db_session)
    ver = SemanticVersion(1, 0, 0)
    draft = PipelineDraft(id="pipe-02", project_id="proj-01", name="Pipeline Exec")
    draft.add_node("node1", "core.file.source", ver)
    pipe_repo.save_draft(draft)

    version = PipelineVersion.publish(draft.id, "1.0.0", draft.to_canonical_dict(), "user")
    pipe_repo.save_version(version)
    db_session.commit()

    exec_repo = SqlAlchemyExecutionRepository(db_session)
    execution = Execution(
        id="exec-01",
        pipeline_version_id=version.definition_hash,
        correlation_id="corr-123"
    )
    task = execution.add_task("node1")
    task.record_progress(rows_in_increment=50, rows_out_increment=50)

    exec_repo.save(execution, plan_artifact_uri="artifact://local/plans/p1.json")
    db_session.commit()

    retrieved = exec_repo.get("exec-01")
    assert retrieved is not None
    assert retrieved.status == ExecutionStatus.CREATED
    assert "node1" in retrieved.tasks
    assert retrieved.tasks["node1"].rows_out == 50

    # Atualiza status e sincroniza
    retrieved.start_planning()
    retrieved.mark_queued()
    retrieved.start_running()
    exec_repo.save(retrieved)
    db_session.commit()

    updated = exec_repo.get("exec-01")
    assert updated.status == ExecutionStatus.RUNNING
