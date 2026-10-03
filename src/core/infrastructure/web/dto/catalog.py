"""DTOs para Catálogo de Componentes."""

from typing import Any, Dict, List
from pydantic import BaseModel, Field


class PortDefinitionDTO(BaseModel):
    name: str
    direction: str
    type: str


class ComponentCapabilityDTO(BaseModel):
    supports_filter_pushdown: bool = False
    supports_projection_pushdown: bool = False
    supports_chunked_read: bool = False
    supports_bulk_write: bool = False


class ComponentDefinition(BaseModel):
    type_id: str
    version: str
    name: str
    category: str
    description: str = ""
    ports: List[PortDefinitionDTO]
    config_schema: Dict[str, Any]
    capabilities: ComponentCapabilityDTO
