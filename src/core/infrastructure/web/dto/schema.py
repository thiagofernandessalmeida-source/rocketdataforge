from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class InferSchemaRequest(BaseModel):
    connector_type: str = "file"
    connection_id: Optional[str] = None
    connection_details: Optional[Dict[str, Any]] = None
    path_or_query: Optional[str] = None
    sample_size: int = 1000


class InferredFieldDTO(BaseModel):
    name: str
    logical_type: str
    physical_type: str
    nullable: bool = True
    description: Optional[str] = None
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    is_primary_key: bool = False
    origin: List[str] = Field(default_factory=list)
    computed: bool = False


class InferredSchema(BaseModel):
    dataset_name: str
    fields: List[InferredFieldDTO]
    inference_source: str = "database"
    warnings: List[str] = Field(default_factory=list)

