"""Serviço de Profiling Estatístico de Dados e Detecção de Schema Drift (Fase 4 - Spec 004).

Calcula estatísticas de colunas (contagem total, nulos % e abs, cardinalidade, min/max e tipos inferidos)
e compara schemas congelados versus schemas atuais para sinalizar drift estrutural.
"""

from dataclasses import dataclass, field
import datetime
import logging
from typing import Any, Dict, List, Optional, Union

import polars as pl
from src.core.application.metadata.schema_inferer import map_polars_type_to_logical
from src.core.domain.shared.types import LogicalDataType

logger = logging.getLogger(__name__)


@dataclass
class ColumnProfile:
    """Perfil estatístico detalhado de uma coluna individual (RF-05.1)."""
    column_name: str
    total_count: int
    null_count: int
    null_percentage: float
    distinct_count: int
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    inferred_type: str = "STRING"
    sample_values: List[Any] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializa o perfil da coluna com valores compatíveis com JSON."""
        min_v = self._serialize_val(self.min_value)
        max_v = self._serialize_val(self.max_value)
        return {
            "column_name": self.column_name,
            "total_count": self.total_count,
            "null_count": self.null_count,
            "null_percentage": self.null_percentage,
            "distinct_count": self.distinct_count,
            "min_value": min_v,
            "max_value": max_v,
            "inferred_type": self.inferred_type,
            "sample_values": [self._serialize_val(v) for v in self.sample_values]
        }

    @staticmethod
    def _serialize_val(val: Any) -> Any:
        if val is None:
            return None
        if isinstance(val, (datetime.date, datetime.datetime)):
            return val.isoformat()
        return val


@dataclass
class DatasetProfile:
    """Perfil estatístico consolidado de um dataset."""
    row_count: int
    column_count: int
    columns: Dict[str, ColumnProfile] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "row_count": self.row_count,
            "column_count": self.column_count,
            "columns": {col_name: prof.to_dict() for col_name, prof in self.columns.items()}
        }


@dataclass
class SchemaDriftReport:
    """Relatório estruturado de desvio de schema (Schema Drift) (RF-05.2)."""
    has_drift: bool
    added_columns: List[str] = field(default_factory=list)
    removed_columns: List[str] = field(default_factory=list)
    type_mismatches: List[Dict[str, Any]] = field(default_factory=list)
    drift_summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "has_drift": self.has_drift,
            "added_columns": self.added_columns,
            "removed_columns": self.removed_columns,
            "type_mismatches": self.type_mismatches,
            "drift_summary": self.drift_summary
        }


class DataProfiler:
    """Serviço responsável por gerar perfis estatísticos e detectar Schema Drift."""

    def profile_dataframe(
        self,
        df: pl.DataFrame,
        sample_size: Optional[int] = None
    ) -> DatasetProfile:
        """Gera métricas por coluna: contagem total, nulos (% e abs), cardinalidade e min/max."""
        working_df = df
        if sample_size and sample_size > 0 and df.height > sample_size:
            working_df = df.head(sample_size)

        row_count = working_df.height
        column_count = len(working_df.columns)
        profiles: Dict[str, ColumnProfile] = {}

        for col in working_df.columns:
            series = working_df[col]
            null_count = int(series.null_count())
            null_pct = round((null_count / row_count * 100), 2) if row_count > 0 else 0.0

            non_null = series.drop_nulls()
            distinct_count = int(series.n_unique())

            min_val = None
            max_val = None
            if non_null.len() > 0:
                try:
                    min_val = non_null.min()
                    max_val = non_null.max()
                except Exception:
                    pass

            try:
                logical_type = map_polars_type_to_logical(series.dtype).value
            except Exception:
                logical_type = str(series.dtype).upper()

            sample_vals = non_null.head(5).to_list() if non_null.len() > 0 else []

            profiles[col] = ColumnProfile(
                column_name=col,
                total_count=row_count,
                null_count=null_count,
                null_percentage=null_pct,
                distinct_count=distinct_count,
                min_value=min_val,
                max_value=max_val,
                inferred_type=logical_type,
                sample_values=sample_vals
            )

        return DatasetProfile(
            row_count=row_count,
            column_count=column_count,
            columns=profiles
        )

    def detect_schema_drift(
        self,
        frozen_schema: List[Union[Dict[str, Any], Any]],
        current_schema: List[Union[Dict[str, Any], Any]]
    ) -> SchemaDriftReport:
        """Compara o schema atual contra o schema congelado e sinaliza drift com diff estruturado."""
        def extract_col_meta(item: Any) -> Dict[str, str]:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                t = str(item.get("type") or item.get("logical_type") or item.get("physical_type") or "STRING").strip().upper()
                return {"name": name, "type": t}
            name = str(getattr(item, "name", "")).strip()
            raw_t = getattr(item, "type", None) or getattr(item, "logical_type", None) or getattr(item, "physical_type", "STRING")
            t_str = raw_t.value if hasattr(raw_t, "value") else str(raw_t)
            return {"name": name, "type": t_str.strip().upper()}

        frozen_map = {extract_col_meta(f)["name"]: extract_col_meta(f)["type"] for f in (frozen_schema or []) if extract_col_meta(f)["name"]}
        current_map = {extract_col_meta(c)["name"]: extract_col_meta(c)["type"] for c in (current_schema or []) if extract_col_meta(c)["name"]}

        added_columns: List[str] = [c for c in current_map if c not in frozen_map]
        removed_columns: List[str] = [c for c in frozen_map if c not in current_map]
        type_mismatches: List[Dict[str, Any]] = []

        for common_col in frozen_map:
            if common_col in current_map:
                old_t = frozen_map[common_col]
                new_t = current_map[common_col]
                if old_t != new_t:
                    type_mismatches.append({
                        "column_name": common_col,
                        "old_type": old_t,
                        "new_type": new_t,
                        "description": f"Tipo alterado de '{old_t}' para '{new_t}'"
                    })

        has_drift = bool(added_columns or removed_columns or type_mismatches)

        summary_parts = []
        if added_columns:
            summary_parts.append(f"Colunas adicionadas: [{', '.join(added_columns)}]")
        if removed_columns:
            summary_parts.append(f"Colunas removidas: [{', '.join(removed_columns)}]")
        if type_mismatches:
            mismatches_str = ", ".join(f"{m['column_name']} ({m['old_type']} -> {m['new_type']})" for m in type_mismatches)
            summary_parts.append(f"Tipos alterados: [{mismatches_str}]")

        drift_summary = "; ".join(summary_parts) if summary_parts else "Nenhum desvio estrutural detectado (Schema Íntegro)."

        return SchemaDriftReport(
            has_drift=has_drift,
            added_columns=added_columns,
            removed_columns=removed_columns,
            type_mismatches=type_mismatches,
            drift_summary=drift_summary
        )
