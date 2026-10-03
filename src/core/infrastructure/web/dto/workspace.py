"""DTOs para Workspaces."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None


class Workspace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
