"""Serviço de Inferência de Schema (SchemaInferer).

Inspeciona fontes de dados e arquivos tabulares por amostragem,
convertendo os tipos físicos nativos para os tipos canônicos de LogicalDataType.
"""

from dataclasses import dataclass, field
import os
from typing import Any, Dict, List, Optional

import polars as pl
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType


@dataclass(frozen=True)
class InferredField:
    """Campo individual inferido de um dataset."""
    name: str
    logical_type: LogicalDataType
    physical_type: str
    nullable: bool = True
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "logical_type": self.logical_type.value,
            "physical_type": self.physical_type,
            "nullable": self.nullable,
            "description": self.description
        }


@dataclass
class InferredSchema:
    """Esquema estrutural inferido de uma fonte ou arquivo."""
    dataset_name: str
    fields: List[InferredField] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "fields": [f.to_dict() for f in self.fields]
        }


def map_polars_type_to_logical(pl_type: pl.DataType) -> LogicalDataType:
    """Converte tipos nativos do Polars para LogicalDataType canônico."""
    if pl_type in {pl.Int8, pl.Int16}:
        return LogicalDataType.INT16
    if pl_type == pl.Int32:
        return LogicalDataType.INT32
    if pl_type in {pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64}:
        return LogicalDataType.INT64
    if pl_type == pl.Float32:
        return LogicalDataType.FLOAT32
    if pl_type == pl.Float64:
        return LogicalDataType.FLOAT64
    if pl_type == pl.Boolean:
        return LogicalDataType.BOOLEAN
    if pl_type == pl.String:
        return LogicalDataType.STRING
    if pl_type == pl.Binary:
        return LogicalDataType.BINARY
    if pl_type == pl.Date:
        return LogicalDataType.DATE
    if pl_type in {pl.Time}:
        return LogicalDataType.TIME
    if isinstance(pl_type, pl.Datetime):
        return LogicalDataType.TIMESTAMP_TZ if pl_type.time_zone else LogicalDataType.TIMESTAMP
    if isinstance(pl_type, pl.List):
        return LogicalDataType.ARRAY
    if isinstance(pl_type, pl.Struct):
        return LogicalDataType.STRUCT
    if pl_type == pl.Decimal:
        return LogicalDataType.DECIMAL

    return LogicalDataType.UNKNOWN


class SchemaInferer:
    """Serviço para inspeção e inferência de esquemas estruturais."""

    def infer_from_file(self, file_path: str, format_hint: Optional[str] = None, sample_size: int = 1000) -> InferredSchema:
        """Infere schema a partir de arquivo local (CSV, Parquet, JSON)."""
        if not os.path.exists(file_path):
            raise DomainValidationError(f"Arquivo não encontrado para inferência de schema: '{file_path}'")

        fmt = (format_hint or os.path.splitext(file_path)[1].lstrip(".")).lower()
        dataset_name = os.path.splitext(os.path.basename(file_path))[0]

        try:
            if fmt == "csv":
                df = pl.read_csv(file_path, n_rows=sample_size)
            elif fmt == "parquet":
                df = pl.read_parquet(file_path, n_rows=sample_size)
            elif fmt == "json":
                df = pl.read_json(file_path)
                if df.height > sample_size:
                    df = df.head(sample_size)
            else:
                raise DomainValidationError(f"Formato não suportado para inferência de schema: '{fmt}'")
        except Exception as e:
            raise DomainValidationError(f"Falha ao ler amostra do arquivo '{file_path}': {str(e)}")

        fields: List[InferredField] = []
        for col_name, col_type in df.schema.items():
            logical = map_polars_type_to_logical(col_type)
            # Verifica nulabilidade na amostra
            has_nulls = df[col_name].null_count() > 0 or True
            fields.append(InferredField(
                name=col_name,
                logical_type=logical,
                physical_type=str(col_type),
                nullable=has_nulls
            ))

        return InferredSchema(dataset_name=dataset_name, fields=fields)

    def infer_from_columns(self, dataset_name: str, column_types: Dict[str, str]) -> InferredSchema:
        """Cria um schema a partir de mapeamento explícito de colunas."""
        fields: List[InferredField] = []
        for col_name, raw_type in column_types.items():
            logical = LogicalDataType(raw_type) if raw_type in LogicalDataType._value2member_map_ else LogicalDataType.STRING
            fields.append(InferredField(
                name=col_name,
                logical_type=logical,
                physical_type=raw_type,
                nullable=True
            ))
        return InferredSchema(dataset_name=dataset_name, fields=fields)
