"""Testes unitários do serviço SchemaInferer."""

import os
import polars as pl
import pytest
from src.core.application.metadata.schema_inferer import SchemaInferer
from src.core.domain.shared.types import LogicalDataType


def test_infer_schema_from_csv(tmp_path):
    csv_file = tmp_path / "customers.csv"
    csv_content = """id,name,balance,is_active,created_at
1,Alice,1250.50,true,2026-01-01
2,Bob,0.00,false,2026-01-02
3,Charlie,99.99,true,2026-01-03
"""
    csv_file.write_text(csv_content, encoding="utf-8")

    inferer = SchemaInferer()
    schema = inferer.infer_from_file(str(csv_file), format_hint="csv")

    assert schema.dataset_name == "customers"
    assert len(schema.fields) == 5

    fields_map = {f.name: f.logical_type for f in schema.fields}
    assert fields_map["id"] == LogicalDataType.INT64
    assert fields_map["name"] == LogicalDataType.STRING
    assert fields_map["balance"] == LogicalDataType.FLOAT64
    assert fields_map["is_active"] == LogicalDataType.BOOLEAN


def test_infer_schema_from_parquet(tmp_path):
    parquet_file = tmp_path / "orders.parquet"
    df = pl.DataFrame({
        "order_id": [101, 102],
        "customer": ["Alice", "Bob"],
        "total": [45.5, 90.0]
    })
    df.write_parquet(parquet_file)

    inferer = SchemaInferer()
    schema = inferer.infer_from_file(str(parquet_file), format_hint="parquet")

    assert schema.dataset_name == "orders"
    fields_map = {f.name: f.logical_type for f in schema.fields}
    assert fields_map["order_id"] == LogicalDataType.INT64
    assert fields_map["customer"] == LogicalDataType.STRING
    assert fields_map["total"] == LogicalDataType.FLOAT64
