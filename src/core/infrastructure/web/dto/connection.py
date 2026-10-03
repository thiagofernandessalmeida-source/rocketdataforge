"""DTOs para Conexões."""

from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict, Field


class CreateConnectionRequest(BaseModel):
    project_id: str
    name: str = Field(..., min_length=1, max_length=100)
    connector_type: str = Field(..., min_length=1, max_length=50)
    endpoint: str = Field(..., min_length=1, max_length=255)
    secret_ref: str = Field(..., min_length=1, max_length=255)
    options: Optional[Dict[str, Any]] = Field(default_factory=dict)


class Connection(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    connector_type: str
    endpoint: str
    secret_ref: str
    options: Dict[str, Any] = Field(default_factory=dict)


class TestConnectionResult(BaseModel):
    success: bool
    message: str
    latency_ms: Optional[int] = None
