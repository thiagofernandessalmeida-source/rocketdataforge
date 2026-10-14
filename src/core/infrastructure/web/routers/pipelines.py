"""Endpoints para Gestão de Pipelines, Drafts, Validação e Publicação (TASK-022, TASK-024)."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.application.compiler.validator import GraphValidator
from src.core.application.pipeline.exporter import PipelineExporter
from src.core.domain.pipeline.draft import PipelineDraft as DomainDraft
from src.core.domain.pipeline.edge import Edge
from src.core.domain.pipeline.hasher import compute_canonical_hash
from src.core.domain.pipeline.node import Node
from src.core.domain.pipeline.version import PipelineVersion as DomainVersion
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.identifiers import generate_ulid
from src.core.domain.shared.types import PortId, SemanticVersion
from src.core.infrastructure.persistence.models import PipelineDraftModel, ProjectModel
from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
from src.core.infrastructure.web.dependencies import (
    get_db_session,
    get_pipeline_exporter,
)
from src.core.infrastructure.web.dto.pipeline import (
    CreatePipelineRequest,
    ExportedPipelineBundle,
    PipelineDraft as PipelineDraftDTO,
    PipelineSummary,
    PipelineVersion as PipelineVersionDTO,
    PublishVersionRequest,
    UpdatePipelineDraftRequest,
    ValidationErrorItemDTO,
    ValidationReport,
    ValidationWarningItemDTO,
)

router = APIRouter(tags=["Pipelines & Drafts"])


@router.get("/projects/{project_id}/pipelines", response_model=List[PipelineSummary])
def list_pipelines(
    project_id: str,
    session: Session = Depends(get_db_session)
):
    """Lista todos os pipelines pertencentes a um projeto."""
    project = session.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto '{project_id}' não encontrado."
        )

    drafts = session.query(PipelineDraftModel).filter(PipelineDraftModel.project_id == project_id).all()
    return [
        PipelineSummary(
            id=d.id,
            project_id=d.project_id,
            name=d.name,
            revision=d.revision,
            updated_at=d.updated_at
        )
        for d in drafts
    ]


@router.post("/projects/{project_id}/pipelines", response_model=PipelineDraftDTO, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    project_id: str,
    payload: CreatePipelineRequest,
    session: Session = Depends(get_db_session)
):
    """Cria um novo pipeline com draft inicial vazio."""
    project = session.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto '{project_id}' não encontrado."
        )

    pipeline_id = generate_ulid()
    draft = DomainDraft(
        id=pipeline_id,
        project_id=project_id,
        name=payload.name,
        description=payload.description,
        revision=1
    )

    repo = SqlAlchemyPipelineRepository(session)
    repo.save_draft(draft, layout={"viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0}, "nodes": []})

    return PipelineDraftDTO(
        id=draft.id,
        project_id=draft.project_id,
        name=draft.name,
        revision=draft.revision,
        definition=draft.to_canonical_dict(),
        layout={"viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0}, "nodes": []}
    )


@router.get("/pipelines/{pipeline_id}/draft", response_model=PipelineDraftDTO)
def get_pipeline_draft(
    pipeline_id: str,
    session: Session = Depends(get_db_session)
):
    """Obtém o draft funcional e visual de um pipeline."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Draft do pipeline '{pipeline_id}' não encontrado."
        )

    draft, layout = res
    return PipelineDraftDTO(
        id=draft.id,
        project_id=draft.project_id,
        name=draft.name,
        revision=draft.revision,
        definition=draft.to_canonical_dict(),
        layout=layout
    )


@router.put("/pipelines/{pipeline_id}/draft", response_model=PipelineDraftDTO)
def update_pipeline_draft(
    pipeline_id: str,
    payload: UpdatePipelineDraftRequest,
    session: Session = Depends(get_db_session)
):
    """Salva alterações no draft com controle de concorrência otimista via expected_revision."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    current_draft, _ = res
    if current_draft.revision != payload.expected_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conflito de concorrência otimista: revisão esperada {payload.expected_revision}, "
                   f"mas a revisão atual do servidor é {current_draft.revision}."
        )

    # Reconstrói a entidade de domínio a partir da definição enviada
    try:
        def_data = payload.definition
        spec = def_data.get("spec", {})
        meta = def_data.get("metadata", {})

        updated_draft = DomainDraft(
            id=pipeline_id,
            project_id=current_draft.project_id,
            name=meta.get("name", current_draft.name),
            description=meta.get("description", current_draft.description),
            revision=current_draft.revision + 1
        )
        updated_draft.parameters = spec.get("parameters", {})
        updated_draft.cells = spec.get("cells", [])

        for n in spec.get("nodes", []):
            comp = n.get("component", {})
            node = Node(
                id=n["id"],
                component_type=comp.get("type", "generic"),
                component_version=SemanticVersion.parse(comp.get("version", "1.0.0")),
                config=n.get("config", {})
            )
            updated_draft.nodes[n["id"]] = node

        for e in spec.get("edges", []):
            edge_id = e.get("id", f"{e['from']}->{e['to']}")
            edge = Edge(
                id=edge_id,
                from_port=PortId.parse(e["from"]),
                to_port=PortId.parse(e["to"])
            )
            updated_draft.edges[edge_id] = edge

        updated_draft.revision = current_draft.revision + 1

        repo.save_draft(updated_draft, layout=payload.layout)

        return PipelineDraftDTO(
            id=updated_draft.id,
            project_id=updated_draft.project_id,
            name=updated_draft.name,
            revision=updated_draft.revision,
            definition=updated_draft.to_canonical_dict(),
            layout=payload.layout
        )
    except DomainValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Erro de validação do domínio: {e.message}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao salvar draft do pipeline: {str(e)}"
        )


@router.post("/pipelines/{pipeline_id}/validate", response_model=ValidationReport)
def validate_pipeline_draft(
    pipeline_id: str,
    session: Session = Depends(get_db_session)
):
    """Executa a validação estrutural e acíclica (DAG) do pipeline."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    draft, _ = res
    validator = GraphValidator()
    report = validator.validate(draft)

    errors = [
        ValidationErrorItemDTO(code=e.code, message=e.message, node_id=e.node_id)
        for e in report.errors
    ]
    warnings = [
        ValidationWarningItemDTO(code=w.code, message=w.message, node_id=w.node_id)
        for w in report.warnings
    ]

    return ValidationReport(
        is_valid=report.is_valid,
        errors=errors,
        warnings=warnings
    )


@router.post("/pipelines/{pipeline_id}/publish", response_model=PipelineVersionDTO, status_code=status.HTTP_201_CREATED)
def publish_pipeline_version(
    pipeline_id: str,
    payload: PublishVersionRequest,
    session: Session = Depends(get_db_session)
):
    """Publica uma versão imutável do pipeline a partir do draft validado."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    draft, _ = res
    validator = GraphValidator()
    report = validator.validate(draft)
    if not report.is_valid:
        error_details = "; ".join(e.message for e in report.errors)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não é possível publicar um pipeline com erros estruturais: {error_details}"
        )

    canonical_dict = draft.to_canonical_dict()

    version = DomainVersion.publish(
        pipeline_id=draft.id,
        version_tag=payload.version_tag,
        canonical_definition=canonical_dict,
        published_by="current-user"
    )

    try:
        repo.save_version(version)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Versão com tag '{payload.version_tag}' ou hash idêntico já cadastrada: {str(e)}"
        )

    return PipelineVersionDTO(
        id=version.definition_hash,
        pipeline_id=version.pipeline_id,
        version_tag=version.version_tag,
        schema_version=version.schema_version,
        definition_hash=version.definition_hash,
        published_at=version.published_at
    )


@router.get("/pipelines/{pipeline_id}/export", response_model=ExportedPipelineBundle)
def export_pipeline(
    pipeline_id: str,
    session: Session = Depends(get_db_session),
    exporter: PipelineExporter = Depends(get_pipeline_exporter)
):
    """Exporta o bundle de arquivos separados: pipeline.yaml e layout.json."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    draft, layout = res
    bundle = exporter.export(draft, layout)

    return ExportedPipelineBundle(
        pipeline_yaml=bundle.pipeline_yaml,
        layout_json=bundle.layout_json
    )
