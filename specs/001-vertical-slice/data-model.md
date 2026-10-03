# Modelo de Dados: Vertical Slice 001 (PostgreSQL Metadata Store)

**Documento:** `specs/001-vertical-slice/data-model.md`  
**Versão:** 1.0.0  
**Status:** Normativo / Infraestrutura de Persistência  
**Banco:** PostgreSQL 15+ (Conforme [ADR-007](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L113))  

---

## 1. Visão Geral e Princípios de Modelagem

O PostgreSQL atua como o **Metadata Store Transacional** do RocketDataForge. Ele armazena metadados estruturais, estados de controle, histórico de auditoria e status de execuções.

### Diretrizes de Armazenamento:
1. **Zero Segredos:** A tabela `connections` armazena exclusivamente referências lógicas no campo `secret_ref` (ex: `secret://env/DB_PASSWORD`), sendo vedada a persistência de senhas ou chaves em claro.
2. **Separação Lógica e Layout:** A tabela `pipeline_drafts` armazena `definition_json` (semântica) e `layout_json` (coordenadas de tela) em colunas distintas.
3. **Imutabilidade de Versões:** Registros em `pipeline_versions` são estritamente *insert-only*.
4. **Artefatos Extensos Fora do Banco:** Planos físicos compilados em binário, logs massivos e arquivos temporários não residem no PostgreSQL; seus metadados apontam para URIs do `ArtifactStore` local (conforme [ADR-008](file:///c:/Natura/PYTHON/RocketDataForge/03_Architecture_Decision_Records_ADR-001-020.md#L130)).

---

## 2. Diagrama de Relacionamentos (ERD)

```text
workspaces (1) ──< projects (N)
                      │
                      ├──< connections (N)
                      ├──< schemas (N)
                      └──< pipeline_drafts (N)
                                │
                                └──< pipeline_versions (N)
                                          │
                                          └──< executions (N)
                                                    │
                                                    └──< task_runs (N)
```

---

## 3. DDL Oficial (PostgreSQL)

```sql
-- Habilitar extensão para suporte a UUID se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. WORKSPACES
-- ============================================================================
CREATE TABLE workspaces (
    id VARCHAR(26) PRIMARY KEY, -- Formato ULID
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. PROJECTS
-- ============================================================================
CREATE TABLE projects (
    id VARCHAR(26) PRIMARY KEY,
    workspace_id VARCHAR(26) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_workspace_slug UNIQUE (workspace_id, slug)
);

CREATE INDEX idx_projects_workspace ON projects(workspace_id);

-- ============================================================================
-- 3. CONNECTIONS
-- ============================================================================
CREATE TABLE connections (
    id VARCHAR(26) PRIMARY KEY,
    project_id VARCHAR(26) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    connector_type VARCHAR(50) NOT NULL, -- "postgres", "file_local", etc.
    endpoint VARCHAR(255) NOT NULL,
    secret_ref VARCHAR(255) NOT NULL,     -- Ex: "secret://env/POSTGRES_PASS"
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_connections_project_name UNIQUE (project_id, name)
);

CREATE INDEX idx_connections_project ON connections(project_id);

-- ============================================================================
-- 4. SCHEMAS
-- ============================================================================
CREATE TABLE schemas (
    id VARCHAR(26) PRIMARY KEY,
    project_id VARCHAR(26) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_name VARCHAR(120) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    fields_json JSONB NOT NULL, -- Lista de campos com tipo lógico, físico e nulabilidade
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_schemas_project_dataset_version UNIQUE (project_id, dataset_name, version)
);

CREATE INDEX idx_schemas_lookup ON schemas(project_id, dataset_name);

-- ============================================================================
-- 5. PIPELINE DRAFTS
-- ============================================================================
CREATE TABLE pipeline_drafts (
    id VARCHAR(26) PRIMARY KEY,
    project_id VARCHAR(26) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    definition_json JSONB NOT NULL, -- Nós funcionais, edges, parâmetros (pipeline.yaml)
    layout_json JSONB NOT NULL,     -- Coordenadas x, y, visual nodes (layout.json)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_drafts_project_name UNIQUE (project_id, name)
);

CREATE INDEX idx_drafts_project ON pipeline_drafts(project_id);

-- ============================================================================
-- 6. PIPELINE VERSIONS (Imutável)
-- ============================================================================
CREATE TABLE pipeline_versions (
    id VARCHAR(26) PRIMARY KEY,
    pipeline_id VARCHAR(26) NOT NULL REFERENCES pipeline_drafts(id) ON DELETE CASCADE,
    version_tag VARCHAR(50) NOT NULL,      -- "1.0.0", "1.0.1", etc.
    schema_version VARCHAR(50) NOT NULL,   -- "rdf.pipeline/v1"
    definition_hash VARCHAR(64) NOT NULL,  -- SHA-256 da lógica funcional canônica
    immutable_definition JSONB NOT NULL,   -- Snapshot imutável da lógica
    published_by VARCHAR(100) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pipeline_versions_tag UNIQUE (pipeline_id, version_tag)
);

CREATE INDEX idx_pipeline_versions_lookup ON pipeline_versions(pipeline_id, version_tag);
CREATE INDEX idx_pipeline_versions_hash ON pipeline_versions(definition_hash);

-- ============================================================================
-- 7. EXECUTIONS
-- ============================================================================
CREATE TABLE executions (
    id VARCHAR(26) PRIMARY KEY,
    pipeline_version_id VARCHAR(26) NOT NULL REFERENCES pipeline_versions(id) ON DELETE RESTRICT,
    correlation_id VARCHAR(64) NOT NULL,
    status VARCHAR(30) NOT NULL, -- created, planning, queued, running, succeeded, failed, cancelled
    attempt INTEGER NOT NULL DEFAULT 1,
    plan_artifact_uri VARCHAR(500), -- Aponta para o ArtifactStore (não gravado no banco)
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_executions_version ON executions(pipeline_version_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_correlation ON executions(correlation_id);

-- ============================================================================
-- 8. TASK RUNS (Métricas e Telemetria por Componente)
-- ============================================================================
CREATE TABLE task_runs (
    id VARCHAR(26) PRIMARY KEY,
    execution_id VARCHAR(26) NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL,
    rows_in BIGINT NOT NULL DEFAULT 0,
    rows_out BIGINT NOT NULL DEFAULT 0,
    rejected_count BIGINT NOT NULL DEFAULT 0,
    duration_ms BIGINT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_message TEXT,
    CONSTRAINT uq_task_runs_execution_node UNIQUE (execution_id, node_id)
);

CREATE INDEX idx_task_runs_execution ON task_runs(execution_id);
```

---

## 4. Modelos SQLAlchemy 2.0 (Interface de Aplicação)

```python
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, BigInteger, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB

class Base(DeclarativeBase):
    pass

class WorkspaceModel(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    projects: Mapped[list["ProjectModel"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")

class PipelineDraftModel(Base):
    __tablename__ = "pipeline_drafts"
    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(26), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    definition_json: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    layout_json: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

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
    error_details: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    task_runs: Mapped[list["TaskRunModel"]] = relationship(back_populates="execution", cascade="all, delete-orphan")
```
