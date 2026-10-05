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


class InferredSchema(BaseModel):
    dataset_name: str
    fields: List[InferredFieldDTO]

