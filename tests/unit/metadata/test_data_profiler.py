"""Testes unitários do Profiler Estatístico de Dados e Detecção de Schema Drift (Fase 4 - Spec 004)."""

import pytest
import polars as pl
from datetime import date, datetime

from src.core.application.metadata.profiler import (
    ColumnProfile,
    DatasetProfile,
    SchemaDriftReport,
    DataProfiler,
)


def test_data_profiler_statistics():
    """T-4.1: Profiler deve calcular contagem total, nulos (% e abs), cardinalidade, min/max e tipos."""
    df = pl.DataFrame({
        "id": [1, 2, 3, 4, 5],
        "name": ["Alice", "Bob", None, "David", "Alice"],
        "salary": [1000.50, 2500.00, None, 4000.00, 5000.00],
        "is_active": [True, False, True, None, True],
        "created_date": [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 5), None, date(2026, 1, 10)]
    })

    profiler = DataProfiler()
    profile = profiler.profile_dataframe(df)

    assert profile.row_count == 5
    assert profile.column_count == 5

    # 1. Coluna 'id' (sem nulos, cardinalidade 5)
    id_prof = profile.columns["id"]
    assert id_prof.column_name == "id"
    assert id_prof.total_count == 5
    assert id_prof.null_count == 0
    assert id_prof.null_percentage == 0.0
    assert id_prof.distinct_count == 5
    assert id_prof.min_value == 1
    assert id_prof.max_value == 5
    assert "INT" in id_prof.inferred_type.upper()

    # 2. Coluna 'name' (1 nulo = 20%, cardinalidade 3 distintas: Alice, Bob, David)
    name_prof = profile.columns["name"]
    assert name_prof.column_name == "name"
    assert name_prof.total_count == 5
    assert name_prof.null_count == 1
    assert name_prof.null_percentage == 20.0
    # Polars n_unique conta valores únicos excluindo ou incluindo nulo
    assert name_prof.distinct_count in (3, 4)
    assert name_prof.min_value == "Alice"
    assert name_prof.max_value == "David"
    assert "STRING" in name_prof.inferred_type.upper() or "STR" in name_prof.inferred_type.upper()

    # 3. Coluna 'salary' (1 nulo, min 1000.5, max 5000.0)
    sal_prof = profile.columns["salary"]
    assert sal_prof.null_count == 1
    assert sal_prof.null_percentage == 20.0
    assert sal_prof.min_value == 1000.50
    assert sal_prof.max_value == 5000.00


def test_data_profiler_empty_dataframe():
    """T-4.1: Profiler deve lidar com DataFrames vazios sem divisão por zero."""
    df = pl.DataFrame({
        "col_a": pl.Series([], dtype=pl.Int64),
        "col_b": pl.Series([], dtype=pl.Utf8)
    })

    profiler = DataProfiler()
    profile = profiler.profile_dataframe(df)

    assert profile.row_count == 0
    assert profile.column_count == 2
    assert profile.columns["col_a"].null_count == 0
    assert profile.columns["col_a"].null_percentage == 0.0
    assert profile.columns["col_a"].min_value is None
    assert profile.columns["col_a"].max_value is None


def test_schema_drift_detection_no_drift():
    """T-4.1 / RF-05.2: Quando o schema atual é idêntico ao congelado, has_drift deve ser False."""
    frozen_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "name", "type": "STRING"},
        {"name": "email", "type": "STRING"}
    ]
    current_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "name", "type": "STRING"},
        {"name": "email", "type": "STRING"}
    ]

    profiler = DataProfiler()
    report = profiler.detect_schema_drift(frozen_schema, current_schema)

    assert report.has_drift is False
    assert len(report.added_columns) == 0
    assert len(report.removed_columns) == 0
    assert len(report.type_mismatches) == 0


def test_schema_drift_detection_added_and_removed_columns():
    """T-4.1 / RF-05.2: Detectar colunas adicionadas e removidas com structured diff."""
    frozen_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "name", "type": "STRING"},
        {"name": "old_field", "type": "FLOAT64"}
    ]
    current_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "name", "type": "STRING"},
        {"name": "new_field", "type": "BOOLEAN"}
    ]

    profiler = DataProfiler()
    report = profiler.detect_schema_drift(frozen_schema, current_schema)

    assert report.has_drift is True
    assert "old_field" in report.removed_columns
    assert "new_field" in report.added_columns
    assert len(report.type_mismatches) == 0
    assert "old_field" in report.drift_summary
    assert "new_field" in report.drift_summary


def test_schema_drift_detection_type_mismatch():
    """T-4.1 / RF-05.2: Detectar alteração de tipo incompatível na mesma coluna."""
    frozen_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "score", "type": "INT32"}
    ]
    current_schema = [
        {"name": "id", "type": "INT64"},
        {"name": "score", "type": "STRING"}
    ]

    profiler = DataProfiler()
    report = profiler.detect_schema_drift(frozen_schema, current_schema)

    assert report.has_drift is True
    assert len(report.type_mismatches) == 1
    mismatch = report.type_mismatches[0]
    assert mismatch["column_name"] == "score"
    assert "INT32" in mismatch["old_type"]
    assert "STRING" in mismatch["new_type"]
