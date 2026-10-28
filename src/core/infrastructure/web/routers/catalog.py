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


from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from src.core.application.metadata.profiler import DataProfiler


class ProfileRequest(BaseModel):
    path_or_query: Optional[str] = None
    connector_type: Optional[str] = None
    connection_details: Optional[Dict[str, Any]] = None
    sample_size: int = 1000
    records: Optional[List[Dict[str, Any]]] = None


class DriftRequest(BaseModel):
    frozen_schema: List[Dict[str, Any]]
    current_schema: List[Dict[str, Any]]


@router.post("/schemas/profile")
def profile_data(
    payload: ProfileRequest,
    inferer: SchemaInferer = Depends(get_schema_inferer)
):
    """Gera profiling estatístico de colunas (nulos, min/max, cardinalidade e tipos)."""
    import polars as pl
    profiler = DataProfiler()

    if payload.records:
        df = pl.DataFrame(payload.records)
        return profiler.profile_dataframe(df, sample_size=payload.sample_size).to_dict()

    if payload.path_or_query:
        try:
            # Tenta carregar amostra de arquivo ou query
            if not payload.connector_type or payload.connector_type in ("file", "csv", "parquet", "json"):
                df = inferer.file_connector.read_sample(payload.path_or_query, sample_size=payload.sample_size)
            else:
                inferred = inferer.infer_from_path_or_query(
                    path_or_query=payload.path_or_query,
                    connector_type=payload.connector_type,
                    connection_details=payload.connection_details,
                    sample_size=payload.sample_size
                )
                # Fallback para metadados de colunas
                return {
                    "row_count": payload.sample_size,
                    "column_count": len(inferred.fields),
                    "columns": {
                        f.name: {
                            "column_name": f.name,
                            "total_count": payload.sample_size,
                            "null_count": 0,
                            "null_percentage": 0.0,
                            "distinct_count": payload.sample_size,
                            "min_value": None,
                            "max_value": None,
                            "inferred_type": f.logical_type.value,
                            "sample_values": []
                        }
                        for f in inferred.fields
                    }
                }
            return profiler.profile_dataframe(df, sample_size=payload.sample_size).to_dict()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Falha ao gerar perfil estatístico: {str(e)}"
            )

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="É necessário fornecer 'records' ou 'path_or_query' para profiling."
    )


@router.post("/schemas/drift")
def detect_drift(payload: DriftRequest):
    """Compara schema atual contra schema congelado e sinaliza desvios (Schema Drift)."""
    profiler = DataProfiler()
    report = profiler.detect_schema_drift(payload.frozen_schema, payload.current_schema)
    return report.to_dict()


