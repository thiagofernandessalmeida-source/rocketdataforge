"""Endpoints de Versões de Pipeline: Compilação e Execução (TASK-022, TASK-023)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlanner
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.identifiers import generate_ulid
from src.core.domain.shared.types import PortId, SemanticVersion
from src.core.infrastructure.execution.manager import ExecutionManager
from src.core.infrastructure.persistence.execution_repository import SqlAlchemyExecutionRepository
from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
from src.core.infrastructure.web.dependencies import (
    get_db_session,
    get_execution_manager,
)
from src.core.infrastructure.web.dto.execution import ExecutionResponse
from src.core.infrastructure.web.dto.pipeline import CompiledPlans

router = APIRouter(tags=["Pipeline Versions"])


def _build_draft_from_version(version) -> PipelineDraft:
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


@router.post("/pipeline-versions/{version_id}/compile", response_model=CompiledPlans)
def compile_pipeline_version(
    version_id: str,
    session: Session = Depends(get_db_session)
):
    """Compila a versão nos planos Logical, Optimized e Physical com relatório de regras aplicadas."""
    repo = SqlAlchemyPipelineRepository(session)
    version = repo.get_version(version_id)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Versão de pipeline '{version_id}' não encontrada."
        )

    draft = _build_draft_from_version(version)
    validator = GraphValidator()
    report = validator.validate(draft)
    if not report.is_valid:
        error_details = "; ".join(e.message for e in report.errors)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Grafo da versão é inválido: {error_details}"
        )

    logical = LogicalPlanner().compile(draft, report)
    optimized = PlanOptimizer().optimize(logical)
    physical = PhysicalPlanner().compile(optimized)

    return CompiledPlans(
        logical_plan=logical.to_dict(),
        optimized_plan=optimized.to_dict(),
        physical_plan=physical.to_dict(),
        optimizations_applied=[
            {
                "rule": opt.rule_name,
                "description": opt.description,
                "affected_nodes": opt.affected_nodes
            }
            for opt in optimized.optimizations
        ]
    )


@router.post("/pipeline-versions/{version_id}/execute", response_model=ExecutionResponse, status_code=status.HTTP_202_ACCEPTED)
def execute_pipeline_version(
    version_id: str,
    session: Session = Depends(get_db_session),
    manager: ExecutionManager = Depends(get_execution_manager)
):
    """Dispara a execução assíncrona local do pipeline a partir de uma versão publicada."""
    pipe_repo = SqlAlchemyPipelineRepository(session)
    version = pipe_repo.get_version(version_id)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Versão de pipeline '{version_id}' não encontrada."
        )

    # Compila o plano físico
    draft = _build_draft_from_version(version)
    validator = GraphValidator()
    report = validator.validate(draft)
    if not report.is_valid:
        error_details = "; ".join(e.message for e in report.errors)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não é possível executar pipeline inválido: {error_details}"
        )

    logical = LogicalPlanner().compile(draft, report)
    optimized = PlanOptimizer().optimize(logical)
    physical = PhysicalPlanner().compile(optimized)

    execution_id = generate_ulid()
    correlation_id = generate_ulid()

    execution = Execution(
        id=execution_id,
        pipeline_version_id=version.definition_hash,
        correlation_id=correlation_id,
        status=ExecutionStatus.CREATED
    )

    # Persiste a execução inicial
    exec_repo = SqlAlchemyExecutionRepository(session)
    exec_repo.save(execution)

    # Registra o token de cancelamento e submete a tarefa ao pool assíncrono
    token = manager.register_execution(execution_id)
    manager.submit_execution(execution, physical, token)

    return ExecutionResponse(
        execution_id=execution.id,
        status=execution.status.value,
        correlation_id=execution.correlation_id
    )
