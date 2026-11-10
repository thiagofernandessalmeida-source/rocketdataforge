"""Endpoints de Execuções, Status, Cancelamento e Logs (TASK-023)."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlanner
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.identifiers import generate_ulid
from src.core.domain.shared.types import PortId, SemanticVersion
from src.core.infrastructure.execution.manager import ExecutionManager
from src.core.infrastructure.persistence.execution_repository import SqlAlchemyExecutionRepository
from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
from src.core.infrastructure.web.dependencies import (
    get_db_session,
    get_execution_manager,
)
from src.core.infrastructure.web.dto.execution import (
    ExecutionDetail,
    ExecutionResponse,
    LogEntry,
    NodePreviewResponse,
    PartialExecutionRequest,
    TaskRunDetail,
)

router = APIRouter(tags=["Executions & Observability"])


def _build_draft_from_payload(payload: PartialExecutionRequest, session: Session) -> PipelineDraft:
    """Reconstrói a entidade PipelineDraft a partir do draft_definition, pipeline_id ou version_id."""
    if payload.draft_definition:
        imm = payload.draft_definition
        spec = imm.get("spec", {})
        meta = imm.get("metadata", {})

        draft = PipelineDraft(
            id=payload.pipeline_id or meta.get("id", "pipeline_draft"),
            project_id=meta.get("project_id", "default"),
            name=meta.get("name", "partial_pipeline")
        )
        for n in spec.get("nodes", []):
            comp = n.get("component", {})
            draft.add_node(
                node_id=n["id"],
                component_type=comp.get("type", "generic"),
                component_version=SemanticVersion.parse(comp.get("version", "1.0.0")),
                config=n.get("config", {})
            )
        for e in spec.get("edges", []):
            draft.connect_ports(PortId.parse(e["from"]), PortId.parse(e["to"]))
        return draft

    pipe_repo = SqlAlchemyPipelineRepository(session)
    if payload.pipeline_id:
        res = pipe_repo.get_draft(payload.pipeline_id)
        if not res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Pipeline draft '{payload.pipeline_id}' não encontrado."
            )
        draft, _ = res
        return draft

    if payload.version_id:
        version = pipe_repo.get_version(payload.version_id)
        if not version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Versão de pipeline '{payload.version_id}' não encontrada."
            )
        imm = version.immutable_definition
        spec = imm.get("spec", {})
        meta = imm.get("metadata", {})

        draft = PipelineDraft(
            id=version.pipeline_id,
            project_id="compilation",
            name=meta.get("name", "pipeline")
        )
        for n in spec.get("nodes", []):
            comp = n.get("component", {})
            draft.add_node(
                node_id=n["id"],
                component_type=comp.get("type", "generic"),
                component_version=SemanticVersion.parse(comp.get("version", "1.0.0")),
                config=n.get("config", {})
            )
        for e in spec.get("edges", []):
            draft.connect_ports(PortId.parse(e["from"]), PortId.parse(e["to"]))
        return draft

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="É necessário fornecer 'draft_definition', 'pipeline_id' ou 'version_id' para execução parcial."
    )


@router.post("/executions/partial", response_model=ExecutionResponse, status_code=status.HTTP_202_ACCEPTED)
def execute_partial_pipeline(
    payload: PartialExecutionRequest,
    session: Session = Depends(get_db_session),
    manager: ExecutionManager = Depends(get_execution_manager)
):
    """Dispara a execução parcial até o nó alvo com poda de sub-DAG (Run to this node - RF-02.2)."""
    if not payload.target_node_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O parâmetro 'target_node_id' é obrigatório."
        )

    draft = _build_draft_from_payload(payload, session)

    if payload.target_node_id not in draft.nodes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nó alvo '{payload.target_node_id}' não encontrado no pipeline."
        )

    try:
        logical = LogicalPlanner().build_subdag(draft, payload.target_node_id)
    except DomainValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao compilar sub-DAG para o nó '{payload.target_node_id}': {e}"
        )

    optimized = PlanOptimizer().optimize(logical)
    physical = PhysicalPlanner().compile(optimized)

    execution_id = generate_ulid()
    correlation_id = generate_ulid()

    execution = Execution(
        id=execution_id,
        pipeline_version_id=payload.version_id or payload.pipeline_id or draft.id,
        correlation_id=correlation_id,
        status=ExecutionStatus.CREATED
    )

    exec_repo = SqlAlchemyExecutionRepository(session)
    exec_repo.save(execution)

    token = manager.register_execution(execution_id)
    manager.submit_execution(execution, physical, token)

    return ExecutionResponse(
        execution_id=execution.id,
        status=execution.status.value,
        correlation_id=execution.correlation_id
    )


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
        try:
            execution.request_cancellation()
            repo.save(execution)
        except Exception:
            session.rollback()
            refreshed = repo.get(execution_id)
            if refreshed:
                execution = refreshed


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


@router.get(
    "/executions/{execution_id}/nodes/{node_id}/preview",
    response_model=NodePreviewResponse,
    summary="Obter prévia interativa dos dados de um nó"
)
def get_node_preview_endpoint(
    execution_id: str,
    node_id: str,
    port: Optional[str] = Query(None, description="Nome da porta de saída (ex: main, reject, out1)"),
    page: int = Query(1, ge=1, description="Número da página"),
    page_size: int = Query(50, ge=1, le=500, description="Linhas por página (50, 100, 500)"),
    search: Optional[str] = Query(None, description="Filtro rápido de pesquisa textual"),
    sort_by: Optional[str] = Query(None, description="Nome da coluna para ordenação"),
    sort_desc: bool = Query(False, description="Ordenação descendente"),
    session: Session = Depends(get_db_session),
    manager: ExecutionManager = Depends(get_execution_manager)
):
    """Retorna a prévia paginada dos dados produzidos por um nó durante a execução (RF-02.3, RF-03)."""
    repo = SqlAlchemyExecutionRepository(session)
    execution = repo.get(execution_id)
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execução '{execution_id}' não encontrada."
        )

    runner = manager.worker.duckdb_runner
    preview_data = runner.get_node_preview(
        execution_id=execution_id,
        node_id=node_id,
        port_name=port,
        page=page,
        page_size=page_size,
        search=search,
        sort_by=sort_by,
        sort_desc=sort_desc
    )

    if preview_data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preview de dados não encontrado ou expirado para o nó '{node_id}' na execução '{execution_id}'."
        )

    return NodePreviewResponse(**preview_data)
