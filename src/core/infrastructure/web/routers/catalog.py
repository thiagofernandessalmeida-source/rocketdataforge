"""Endpoints de Catálogo de Componentes e Inferência de Esquemas (TASK-022)."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status

from src.core.application.metadata.schema_inferer import SchemaInferer
from src.core.domain.catalog.definitions import CATALOG_COMPONENTS
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.web.dependencies import get_schema_inferer
from src.core.infrastructure.web.dto.catalog import (
    ComponentCapabilityDTO,
    ComponentDefinition,
    PortDefinitionDTO,
)
from src.core.infrastructure.web.dto.schema import (
    InferSchemaRequest,
    InferredFieldDTO,
    InferredSchema,
)

router = APIRouter(tags=["Catalog & Schemas"])


@router.get("/components/catalog", response_model=List[ComponentDefinition])
def get_component_catalog():
    """Retorna a lista canônica dos 7 componentes do catálogo do Vertical Slice 001."""
    result = []
    for comp in CATALOG_COMPONENTS:
        ports = [
            PortDefinitionDTO(
                name=p.name,
                direction=p.direction.value,
                type=p.type.value
            )
            for p in comp.ports
        ]
        caps = ComponentCapabilityDTO(
            supports_filter_pushdown=comp.capabilities.supports_filter_pushdown,
            supports_projection_pushdown=comp.capabilities.supports_projection_pushdown,
            supports_chunked_read=comp.capabilities.supports_chunked_read,
            supports_bulk_write=comp.capabilities.supports_bulk_write
        )
        result.append(
            ComponentDefinition(
                type_id=comp.type_id,
                version=str(comp.version),
                name=comp.name,
                category=comp.category,
                description=comp.description,
                ports=ports,
                config_schema=comp.config_schema,
                capabilities=caps
            )
        )
    return result


@router.post("/schemas/infer", response_model=InferredSchema)
def infer_schema(
    payload: InferSchemaRequest,
    inferer: SchemaInferer = Depends(get_schema_inferer)
):
    """Infere o esquema estrutural com tipos canônicos a partir de um arquivo ou consulta SQL."""
    if not payload.path_or_query:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="O campo 'path_or_query' é obrigatório para inferência de schema."
        )

    try:
        inferred = inferer.infer_from_path_or_query(
            path_or_query=payload.path_or_query,
            connector_type=payload.connector_type,
            connection_details=payload.connection_details,
            sample_size=payload.sample_size
        )
        fields = [
            InferredFieldDTO(
                name=f.name,
                logical_type=f.logical_type.value,
                physical_type=f.physical_type,
                nullable=f.nullable,
                description=f.description
            )
            for f in inferred.fields
        ]
        return InferredSchema(dataset_name=inferred.dataset_name, fields=fields)
    except DomainValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha durante a inferência do esquema: {str(e)}"
        )

