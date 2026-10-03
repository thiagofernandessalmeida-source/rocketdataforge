"""DTOs para Projetos."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None


class Project(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    name: str
    slug: str
    description: Optional[str] = None
    created_at: datetime
