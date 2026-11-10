import os
import tempfile
import polars as pl
import pytest
import duckdb
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


def test_duckdb_runner_respects_env_max_memory(monkeypatch):
    """T-1.1: DuckDBRunner deve respeitar RDF_DUCKDB_MAX_MEMORY quando definido no ambiente."""
    monkeypatch.setenv("RDF_DUCKDB_MAX_MEMORY", "256MB")
    runner = DuckDBRunner()
    assert runner.memory_limit == "256MB"
    conn = runner.get_connection()
    res = conn.execute("SELECT current_setting('max_memory')").fetchone()[0]
    # DuckDB pode normalizar '256MB' para bytes ou formato legível (ex: '256.0MB' ou '244.1 MiB')
    assert "256" in str(res) or "244" in str(res) or "268435456" in str(res)


def test_duckdb_runner_respects_env_temp_directory(monkeypatch, tmp_path):
    """T-1.1: DuckDBRunner deve respeitar RDF_DUCKDB_TEMP_DIRECTORY e criar o diretório caso não exista."""
    scratch_dir = tmp_path / "duckdb_scratch_test"
    monkeypatch.setenv("RDF_DUCKDB_TEMP_DIRECTORY", str(scratch_dir))
    runner = DuckDBRunner()
    assert runner.temp_directory == str(scratch_dir)
    conn = runner.get_connection()
    assert os.path.exists(scratch_dir)
    res = conn.execute("SELECT current_setting('temp_directory')").fetchone()[0]
    clean_expected = str(scratch_dir).replace("\\", "/").rstrip("/")
    clean_actual = str(res).replace("\\", "/").rstrip("/")
    assert clean_expected.lower() in clean_actual.lower() or clean_actual.lower() in clean_expected.lower()


def test_duckdb_runner_enforces_external_access_disabled():
    """T-1.1 & RNF-02: Conexões intermediárias de processamento devem ter enable_external_access = false."""
    runner = DuckDBRunner()
    conn = runner.get_connection()
    res = conn.execute("SELECT current_setting('enable_external_access')").fetchone()[0]
    assert str(res).lower() == "false"


def test_duckdb_runner_default_memory_when_no_env(monkeypatch):
    """T-1.1 & RF-01.1: Sem RDF_DUCKDB_MAX_MEMORY, deve calcular limite padrão com base na memória disponível."""
    monkeypatch.delenv("RDF_DUCKDB_MAX_MEMORY", raising=False)
    runner = DuckDBRunner(memory_limit=None)
    assert runner.memory_limit is not None
    assert runner.memory_limit.endswith("MB") or runner.memory_limit.endswith("GB")
    conn = runner.get_connection()
    res = conn.execute("SELECT current_setting('max_memory')").fetchone()[0]
    assert res is not None


def test_duckdb_tmap_flow_applies_resource_limits(monkeypatch, tmp_path):
    """T-1.1: execute_tmap_transform deve herdar limites de memória e temp_directory."""
    scratch_dir = tmp_path / "tmap_scratch"
    monkeypatch.setenv("RDF_DUCKDB_MAX_MEMORY", "128MB")
    monkeypatch.setenv("RDF_DUCKDB_TEMP_DIRECTORY", str(scratch_dir))
    runner = DuckDBRunner()
    df = pl.DataFrame({"id": [1, 2], "val": ["a", "b"]})
    outputs = runner.execute_tmap_transform(
        main_df=df,
        lookups=[],
        lookup_dfs={},
        variables=[],
        outputs=[{"id": "out1", "columns": [{"target": "id", "expression": "main.id"}]}]
    )
    assert "out1" in outputs
    assert len(outputs["out1"]) == 2
    assert os.path.exists(scratch_dir)
