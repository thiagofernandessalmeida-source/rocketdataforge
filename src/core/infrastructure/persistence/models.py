"""Modelos ORM SQLAlchemy 2.0 para o Metadata Store do RocketDataForge.

Compatível com PostgreSQL e SQLite para testes integrados em memória.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Classe base declarativa do SQLAlchemy."""
    pass


class WorkspaceModel(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    projects: Mapped[List["ProjectModel"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class ProjectModel(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_projects_workspace_slug"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(26), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    workspace: Mapped["WorkspaceModel"] = relationship(back_populates="projects")
    connections: Mapped[List["ConnectionModel"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    drafts: Mapped[List["PipelineDraftModel"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ConnectionModel(Base):
    __tablename__ = "connections"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_connections_project_name"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(26), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    connector_type: Mapped[str] = mapped_column(String(50), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    secret_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    options_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped["ProjectModel"] = relationship(back_populates="connections")


class SchemaModel(Base):
    __tablename__ = "schemas"
    __table_args__ = (
        UniqueConstraint("project_id", "dataset_name", "version", name="uq_schemas_project_dataset_version"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(26), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    dataset_name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    fields_json: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PipelineDraftModel(Base):
    __tablename__ = "pipeline_drafts"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_drafts_project_name"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(26), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    definition_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    layout_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped["ProjectModel"] = relationship(back_populates="drafts")
    versions: Mapped[List["PipelineVersionModel"]] = relationship(back_populates="pipeline", cascade="all, delete-orphan")


class PipelineVersionModel(Base):
    __tablename__ = "pipeline_versions"
    __table_args__ = (
        UniqueConstraint("pipeline_id", "version_tag", name="uq_pipeline_versions_tag"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    pipeline_id: Mapped[str] = mapped_column(String(26), ForeignKey("pipeline_drafts.id", ondelete="CASCADE"), nullable=False)
    version_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(50), nullable=False)
    definition_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    immutable_definition_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    published_by: Mapped[str] = mapped_column(String(100), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    pipeline: Mapped["PipelineDraftModel"] = relationship(back_populates="versions")
    executions: Mapped[List["ExecutionModel"]] = relationship(back_populates="pipeline_version")


class ExecutionModel(Base):
    __tablename__ = "executions"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    pipeline_version_id: Mapped[str] = mapped_column(String(26), ForeignKey("pipeline_versions.id"), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    plan_artifact_uri: Mapped[Optional[str]] = mapped_column(String(500))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_details_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    pipeline_version: Mapped["PipelineVersionModel"] = relationship(back_populates="executions")
    task_runs: Mapped[List["TaskRunModel"]] = relationship(back_populates="execution", cascade="all, delete-orphan")


class TaskRunModel(Base):
    __tablename__ = "task_runs"
    __table_args__ = (
        UniqueConstraint("execution_id", "node_id", name="uq_task_runs_execution_node"),
    )

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    execution_id: Mapped[str] = mapped_column(String(26), ForeignKey("executions.id", ondelete="CASCADE"), nullable=False)
    node_id: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    rows_in: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    rows_out: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    rejected_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    duration_ms: Mapped[Optional[int]] = mapped_column(BigInteger)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[Optional[str]] = mapped_column(String(100))
    error_message: Mapped[Optional[str]] = mapped_column(Text)

    execution: Mapped["ExecutionModel"] = relationship(back_populates="task_runs")
