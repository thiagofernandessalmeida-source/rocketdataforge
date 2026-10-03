"""Endpoints de Execuções, Status, Cancelamento e Logs (TASK-023)."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.core.infrastructure.execution.manager import ExecutionManager
from src.core.infrastructure.persistence.execution_repository import SqlAlchemyExecutionRepository
from src.core.infrastructure.web.dependencies import (
    get_db_session,
    get_execution_manager,
)
from src.core.infrastructure.web.dto.execution import (
    ExecutionDetail,
    LogEntry,
    TaskRunDetail,
)

router = APIRouter(tags=["Executions & Observability"])


@router.get("/executions/{execution_id}", response_model=ExecutionDetail)
def get_execution_status(
    execution_id: str,
    session: Session = Depends(get_db_session)
):
    """Consulta o status atual, métricas atômicas e progresso de tarefas da execução."""
    repo = SqlAlchemyExecutionRepository(session)
    execution = repo.get(execution_id)
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execução '{execution_id}' não encontrada."
        )

    task_details = [
        TaskRunDetail(
            node_id=t.node_id,
            status=t.status.value,
            rows_in=t.rows_in,
            rows_out=t.rows_out,
            duration_ms=t.duration_ms,
            error_message=t.error_message
        )
        for t in execution.tasks.values()
    ]

    return ExecutionDetail(
        execution_id=execution.id,
        pipeline_version_id=execution.pipeline_version_id,
        status=execution.status.value,
        attempt=execution.attempt,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
        tasks=task_details
    )


@router.post("/executions/{execution_id}/cancel", response_model=ExecutionDetail)
def cancel_execution(
    execution_id: str,
    session: Session = Depends(get_db_session),
    manager: ExecutionManager = Depends(get_execution_manager)
):
    """Solicita o cancelamento cooperativo e idempotente de uma execução em andamento."""
    repo = SqlAlchemyExecutionRepository(session)
    execution = repo.get(execution_id)
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execução '{execution_id}' não encontrada."
        )

    # Aciona o cancelamento cooperativo no manager
    cancelled = manager.cancel_execution(execution_id)

    # Atualiza FSM da entidade caso esteja em estado cancelável
    if execution.status.is_active():
        execution.request_cancellation()
        repo.save(execution)

    task_details = [
        TaskRunDetail(
            node_id=t.node_id,
            status=t.status.value,
            rows_in=t.rows_in,
            rows_out=t.rows_out,
            duration_ms=t.duration_ms,
            error_message=t.error_message
        )
        for t in execution.tasks.values()
    ]

    return ExecutionDetail(
        execution_id=execution.id,
        pipeline_version_id=execution.pipeline_version_id,
        status=execution.status.value,
        attempt=execution.attempt,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
        tasks=task_details
    )


@router.get("/executions/{execution_id}/logs", response_model=List[LogEntry])
def get_execution_logs(
    execution_id: str,
    node_id: Optional[str] = Query(None, description="Filtrar logs por nó específico"),
    session: Session = Depends(get_db_session),
    manager: ExecutionManager = Depends(get_execution_manager)
):
    """Recupera logs estruturados da execução com filtro opcional por nó."""
    repo = SqlAlchemyExecutionRepository(session)
    execution = repo.get(execution_id)
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execução '{execution_id}' não encontrada."
        )

    raw_logs = manager.get_logs(execution_id, node_id=node_id)
    return [
        LogEntry(
            timestamp=r.timestamp,
            level=r.level,
            execution_id=r.execution_id,
            node_id=r.node_id,
            message=r.message
        )
        for r in raw_logs
    ]
