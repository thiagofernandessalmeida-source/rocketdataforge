"""DTOs para Pipelines, Drafts, Validação e Compilação."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class PipelineSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    revision: int
    updated_at: datetime


class CreatePipelineRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None


class PipelineDraft(BaseModel):
    id: str
    project_id: str
    name: str
    revision: int
    definition: Dict[str, Any]
    layout: Dict[str, Any]


class UpdatePipelineDraftRequest(BaseModel):
    expected_revision: int
    definition: Dict[str, Any]
    layout: Dict[str, Any]


class ValidationErrorItemDTO(BaseModel):
    code: str
    message: str
    node_id: Optional[str] = None


class ValidationWarningItemDTO(BaseModel):
    code: str
    message: str
    node_id: Optional[str] = None


class ValidationReport(BaseModel):
    is_valid: bool
    errors: List[ValidationErrorItemDTO] = Field(default_factory=list)
    warnings: List[ValidationWarningItemDTO] = Field(default_factory=list)


class PublishVersionRequest(BaseModel):
    version_tag: str = Field(..., json_schema_extra={"example": "1.0.0"})
    comment: Optional[str] = None


class PipelineVersion(BaseModel):
    id: str
    pipeline_id: str
    version_tag: str
    schema_version: str
    definition_hash: str
    published_at: datetime


class CompiledPlans(BaseModel):
    logical_plan: Dict[str, Any]
    optimized_plan: Dict[str, Any]
    physical_plan: Dict[str, Any]
    optimizations_applied: List[Dict[str, Any]] = Field(default_factory=list)


class ExportedPipelineBundle(BaseModel):
    pipeline_yaml: str
    layout_json: str
