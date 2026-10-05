"""Endpoints de Workspaces e Projetos (TASK-022)."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.domain.shared.identifiers import generate_ulid
from src.core.infrastructure.persistence.models import ProjectModel, WorkspaceModel
from src.core.infrastructure.web.dependencies import get_db_session
from src.core.infrastructure.web.dto.project import CreateProjectRequest, Project
from src.core.infrastructure.web.dto.workspace import CreateWorkspaceRequest, Workspace

router = APIRouter(tags=["Workspaces & Projects"])


@router.get("/workspaces", response_model=List[Workspace])
def list_workspaces(session: Session = Depends(get_db_session)):
    """Lista todos os workspaces cadastrados."""
    models = session.query(WorkspaceModel).order_by(WorkspaceModel.created_at.desc()).all()
    return [
        Workspace(
            id=m.id,
            name=m.name,
            description=m.description,
            created_at=m.created_at
        )
        for m in models
    ]


@router.post("/workspaces", response_model=Workspace, status_code=status.HTTP_201_CREATED)
def create_workspace(
    payload: CreateWorkspaceRequest,
    session: Session = Depends(get_db_session)
):
    """Cria um novo workspace ou retorna o existente de mesmo nome."""
    existing = session.query(WorkspaceModel).filter(WorkspaceModel.name == payload.name).first()
    if existing:
        return Workspace(
            id=existing.id,
            name=existing.name,
            description=existing.description,
            created_at=existing.created_at
        )

    workspace_id = generate_ulid()
    model = WorkspaceModel(
        id=workspace_id,
        name=payload.name,
        description=payload.description
    )
    session.add(model)
    session.commit()
    session.refresh(model)

    return Workspace(
        id=model.id,
        name=model.name,
        description=model.description,
        created_at=model.created_at
    )


@router.get("/workspaces/{workspace_id}/projects", response_model=List[Project])
def list_projects(
    workspace_id: str,
    session: Session = Depends(get_db_session)
):
    """Lista os projetos associados a um workspace."""
    workspace = session.get(WorkspaceModel, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workspace '{workspace_id}' não encontrado."
        )

    projects = session.query(ProjectModel).filter(ProjectModel.workspace_id == workspace_id).all()
    return [
        Project(
            id=p.id,
            workspace_id=p.workspace_id,
            name=p.name,
            slug=p.slug,
            description=p.description,
            created_at=p.created_at
        )
        for p in projects
    ]


@router.post("/workspaces/{workspace_id}/projects", response_model=Project, status_code=status.HTTP_201_CREATED)
def create_project(
    workspace_id: str,
    payload: CreateProjectRequest,
    session: Session = Depends(get_db_session)
):
    """Cria um projeto dentro de um workspace ou retorna o existente com mesmo slug."""
    workspace = session.get(WorkspaceModel, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workspace '{workspace_id}' não encontrado."
        )

    existing_slug = (
        session.query(ProjectModel)
        .filter(ProjectModel.workspace_id == workspace_id, ProjectModel.slug == payload.slug)
        .first()
    )
    if existing_slug:
        return Project(
            id=existing_slug.id,
            workspace_id=existing_slug.workspace_id,
            name=existing_slug.name,
            slug=existing_slug.slug,
            description=existing_slug.description,
            created_at=existing_slug.created_at
        )

    project_id = generate_ulid()
    project = ProjectModel(
        id=project_id,
        workspace_id=workspace_id,
        name=payload.name,
        slug=payload.slug,
        description=payload.description
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    return Project(
        id=project.id,
        workspace_id=project.workspace_id,
        name=project.name,
        slug=project.slug,
        description=project.description,
        created_at=project.created_at
    )
