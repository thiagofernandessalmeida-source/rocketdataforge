"""Injeção de dependências para o framework FastAPI."""

import os
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.core.application.metadata.schema_inferer import SchemaInferer
from src.core.application.pipeline.exporter import PipelineExporter
from src.core.infrastructure.execution.manager import ExecutionManager
from src.core.infrastructure.persistence.connection_repository import SqlAlchemyConnectionRepository
from src.core.infrastructure.persistence.execution_repository import SqlAlchemyExecutionRepository
from src.core.infrastructure.persistence.models import Base
from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
from src.core.infrastructure.telemetry.otel_setup import setup_telemetry

# URL do banco de dados (padrão em memória para testes e dev)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///:memory:")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
poolclass = StaticPool if DATABASE_URL == "sqlite:///:memory:" else None

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    poolclass=poolclass if poolclass else None
)
Base.metadata.create_all(bind=engine)

SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Inicializa telemetria e o gerenciador de execuções
setup_telemetry()
execution_manager = ExecutionManager(session_factory=SessionFactory)
schema_inferer = SchemaInferer()
pipeline_exporter = PipelineExporter()


def get_db_session() -> Generator[Session, None, None]:
    """Fornece uma sessão transacional do banco de dados para a requisição."""
    session = SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_pipeline_repository(session: Session) -> SqlAlchemyPipelineRepository:
    return SqlAlchemyPipelineRepository(session)


def get_execution_repository(session: Session) -> SqlAlchemyExecutionRepository:
    return SqlAlchemyExecutionRepository(session)


def get_connection_repository(session: Session) -> SqlAlchemyConnectionRepository:
    return SqlAlchemyConnectionRepository(session)


def get_execution_manager() -> ExecutionManager:
    return execution_manager


def get_schema_inferer() -> SchemaInferer:
    return schema_inferer


def get_pipeline_exporter() -> PipelineExporter:
    return pipeline_exporter
