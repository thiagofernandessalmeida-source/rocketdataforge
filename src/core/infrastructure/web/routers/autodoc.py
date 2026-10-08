"""Router FastAPI para Geração de Documentação Interativa (Auto-Doc) e Exportação HTML/PDF."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.core.application.autodoc.generator import AutoDocGenerator
from src.core.application.autodoc.html_exporter import HtmlDocExporter
from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
from src.core.infrastructure.web.dependencies import get_db_session

router = APIRouter(tags=["Auto-Doc & Governance"])


class GenerateAutoDocRequest(BaseModel):
    author: Optional[str] = "RocketDataForge Engine"
    business_tags: Optional[List[str]] = None
    telemetry_metrics: Optional[Dict[str, Any]] = None


class AutoDocResponse(BaseModel):
    pipeline_id: str
    pipeline_name: str
    markdown: str
    mermaid_code: str


class ExportHtmlRequest(BaseModel):
    markdown_content: Optional[str] = None
    title: Optional[str] = None


@router.post("/pipelines/{pipeline_id}/autodoc/generate", response_model=AutoDocResponse)
def generate_pipeline_autodoc(
    pipeline_id: str,
    req: GenerateAutoDocRequest = GenerateAutoDocRequest(),
    session: Session = Depends(get_db_session)
):
    """Gera a documentação técnica completa em Markdown e diagrama de Linhagem Mermaid.js a partir do pipeline."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    draft, _ = res
    generator = AutoDocGenerator()
    mermaid_code = generator.generate_mermaid_lineage(draft)
    markdown = generator.generate_markdown(
        draft=draft,
        telemetry_metrics=req.telemetry_metrics,
        author=req.author or "RocketDataForge Engine",
        business_tags=req.business_tags or []
    )

    return AutoDocResponse(
        pipeline_id=draft.id,
        pipeline_name=draft.name,
        markdown=markdown,
        mermaid_code=mermaid_code
    )


@router.post("/pipelines/{pipeline_id}/autodoc/export-html")
def export_pipeline_autodoc_html(
    pipeline_id: str,
    req: ExportHtmlRequest = ExportHtmlRequest(),
    session: Session = Depends(get_db_session)
):
    """Gera um arquivo HTML autocontido com renderizador Mermaid.js embutido para download e auditoria."""
    repo = SqlAlchemyPipelineRepository(session)
    res = repo.get_draft(pipeline_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline '{pipeline_id}' não encontrado."
        )

    draft, _ = res
    generator = AutoDocGenerator()

    # Se o usuário enviou markdown editado no Live Preview, usamos ele; caso contrário, geramos novo
    if req.markdown_content and req.markdown_content.strip():
        markdown = req.markdown_content
    else:
        markdown = generator.generate_markdown(draft=draft)

    title = req.title or draft.name
    html_content = HtmlDocExporter.export_standalone_html(
        title=title,
        markdown_content=markdown
    )

    filename = f"autodoc_{draft.id}.html"
    return Response(
        content=html_content,
        media_type="text/html",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
