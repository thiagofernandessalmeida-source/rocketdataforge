"""Testes unitários do LocalFileConnector."""

import os
import polars as pl
import pytest
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.infrastructure.connectors.file_connector import LocalFileConnector


def test_path_traversal_prevention(tmp_path):
    base_dir = tmp_path / "workspace"
    base_dir.mkdir()

    connector = LocalFileConnector(base_directory=str(base_dir))

    # Tentativa de escapar do diretório usando ../../
    with pytest.raises(SecurityViolationError):
        connector.validate_safe_path("../../windows/system32/cmd.exe")


def test_read_and_write_csv_chunks(tmp_path):
    connector = LocalFileConnector(base_directory=str(tmp_path))
    file_path = "test_data.csv"

    # Cria dados com 25 registros
    df = pl.DataFrame({
        "id": list(range(25)),
        "value": [f"val_{i}" for i in range(25)]
    })

    written_count = connector.write_dataframe(df, file_path, file_format="csv", write_mode="replace")
    assert written_count == 25

    # Lê em chunks de 10 registros
    chunks = list(connector.read_chunks(file_path, file_format="csv", chunk_size=10))
    assert len(chunks) == 3
    assert chunks[0].height == 10
    assert chunks[1].height == 10
    assert chunks[2].height == 5


def test_read_and_write_parquet_chunks(tmp_path):
    connector = LocalFileConnector(base_directory=str(tmp_path))
    file_path = "test_data.parquet"

    df = pl.DataFrame({
        "metric_id": list(range(100)),
        "score": [i * 1.5 for i in range(100)]
    })

    connector.write_dataframe(df, file_path, file_format="parquet", write_mode="replace")

    chunks = list(connector.read_chunks(file_path, file_format="parquet", chunk_size=30))
    assert len(chunks) == 4
    total_rows = sum(c.height for c in chunks)
    assert total_rows == 100
