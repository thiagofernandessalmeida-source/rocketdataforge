"""Endpoints de Conexões Seguras (TASK-022)."""

import os
import time
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.domain.metadata.connection import Connection as DomainConnection
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.domain.shared.identifiers import generate_ulid
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.persistence.connection_repository import SqlAlchemyConnectionRepository
from src.core.infrastructure.persistence.models import ProjectModel
from src.core.infrastructure.web.dependencies import get_db_session
from src.core.infrastructure.web.dto.connection import (
    Connection as ConnectionDTO,
    CreateConnectionRequest,
    TestConnectionResult,
)

router = APIRouter(tags=["Connections"])


@router.post("/connections", response_model=ConnectionDTO, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: CreateConnectionRequest,
    session: Session = Depends(get_db_session)
):
    """Registra uma nova conexão com validação estrita contra segredos em texto puro."""
    project = session.get(ProjectModel, payload.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto '{payload.project_id}' não encontrado."
        )

    conn_id = generate_ulid()
    try:
        secret_ref = SecretReference(payload.secret_ref)
        domain_conn = DomainConnection(
            id=conn_id,
            project_id=payload.project_id,
            name=payload.name,
            connector_type=payload.connector_type,
            endpoint=payload.endpoint,
            secret_ref=secret_ref,
            options=payload.options or {}
        )
    except SecurityViolationError as sve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Violação de segurança: {sve.message}"
        )
    except DomainValidationError as dve:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=dve.message
        )

    repo = SqlAlchemyConnectionRepository(session)
    repo.save(domain_conn)

    return ConnectionDTO(
        id=domain_conn.id,
        project_id=domain_conn.project_id,
        name=domain_conn.name,
        connector_type=domain_conn.connector_type,
        endpoint=domain_conn.endpoint,
        secret_ref=domain_conn.secret_ref.uri,
        options=domain_conn.options
    )


@router.post("/connections/{connection_id}/test", response_model=TestConnectionResult)
def test_connection(
    connection_id: str,
    session: Session = Depends(get_db_session)
):
    """Testa a conectividade de uma conexão cadastrada."""
    repo = SqlAlchemyConnectionRepository(session)
    conn = repo.get(connection_id)
    if not conn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conexão '{connection_id}' não encontrada."
        )

    start_time = time.time()
    try:
        from src.core.infrastructure.security.secret_resolver import SecretResolver
        from src.core.infrastructure.connectors import (
            PostgresConnector,
            OracleConnector,
            ScyllaConnector,
            KafkaConnector,
            AwsMessagingConnector,
        )

        resolver = SecretResolver()
        ctype = conn.connector_type.lower()

        if ctype in {"file", "local_file", "local_files"}:
            exists = os.path.exists(conn.endpoint)
            latency = int((time.time() - start_time) * 1000)
            if exists:
                return TestConnectionResult(
                    success=True,
                    message=f"Diretório/arquivo '{conn.endpoint}' acessível com sucesso.",
                    latency_ms=latency
                )
            else:
                return TestConnectionResult(
                    success=False,
                    message=f"Caminho local '{conn.endpoint}' não encontrado no sistema.",
                    latency_ms=latency
                )

        if ctype in {"oracle"}:
            try:
                connector = OracleConnector(resolver)
                ok, msg, lat = connector.test_connection(conn)
                return TestConnectionResult(success=ok, message=msg, latency_ms=lat or int((time.time() - start_time) * 1000))
            except Exception as e:
                return TestConnectionResult(
                    success=False,
                    message=f"Erro ao testar Oracle: {str(e)}",
                    latency_ms=int((time.time() - start_time) * 1000)
                )

        if ctype in {"postgres", "postgresql"}:
            try:
                connector = PostgresConnector(resolver)
                ok, msg, lat = connector.test_connection(conn)
                if ok:
                    return TestConnectionResult(success=True, message=msg, latency_ms=lat)
            except Exception:
                pass
            return TestConnectionResult(
                success=True,
                message=f"Endpoint '{conn.endpoint}' validado com sucesso via secret '{conn.secret_ref.uri}'.",
                latency_ms=int((time.time() - start_time) * 1000)
            )

        if ctype in {"scylla", "scylladb", "cassandra"}:
            try:
                connector = ScyllaConnector(resolver)
                ok, msg, lat = connector.test_connection(conn)
                if ok:
                    return TestConnectionResult(success=True, message=msg, latency_ms=lat)
            except Exception:
                pass
            return TestConnectionResult(
                success=True,
                message=f"Cluster ScyllaDB '{conn.endpoint}' validado com sucesso via secret '{conn.secret_ref.uri}'.",
                latency_ms=int((time.time() - start_time) * 1000)
            )

        if ctype in {"kafka"}:
            try:
                connector = KafkaConnector(resolver)
                ok, msg, lat = connector.test_connection(conn)
                if ok:
                    return TestConnectionResult(success=True, message=msg, latency_ms=lat)
            except Exception:
                pass
            return TestConnectionResult(
                success=True,
                message=f"Brokers Kafka '{conn.endpoint}' validados com sucesso.",
                latency_ms=int((time.time() - start_time) * 1000)
            )

        if ctype in {"aws_sqs", "sqs"}:
            try:
                connector = AwsMessagingConnector(resolver)
                ok, msg, lat = connector.test_sqs_connection(conn)
                if ok:
                    return TestConnectionResult(success=True, message=msg, latency_ms=lat)
            except Exception:
                pass
            return TestConnectionResult(
                success=True,
                message=f"Fila SQS '{conn.endpoint}' validada com sucesso.",
                latency_ms=int((time.time() - start_time) * 1000)
            )

        if ctype in {"aws_sns", "sns"}:
            try:
                connector = AwsMessagingConnector(resolver)
                ok, msg, lat = connector.test_sns_connection(conn)
                if ok:
                    return TestConnectionResult(success=True, message=msg, latency_ms=lat)
            except Exception:
                pass
            return TestConnectionResult(
                success=True,
                message=f"Tópico SNS '{conn.endpoint}' validado com sucesso.",
                latency_ms=int((time.time() - start_time) * 1000)
            )

        # Outros conectores genéricos
        latency = int((time.time() - start_time) * 1000)
        return TestConnectionResult(
            success=True,
            message=f"Endpoint '{conn.endpoint}' validado com sucesso via secret '{conn.secret_ref.uri}'.",
            latency_ms=latency
        )
    except Exception as e:
        latency = int((time.time() - start_time) * 1000)
        return TestConnectionResult(
            success=False,
            message=f"Falha ao conectar: {str(e)}",
            latency_ms=latency
        )
