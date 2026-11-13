"""Testes unitários para Interpolação de Variáveis de Contexto (Tarefa 1)."""

import pytest
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.execution.context_variable_interpolation import (
    interpolate_context_variables,
    mask_secrets,
)
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_basic_interpolation_and_syntax():
    cfg = {
        "host": "${HOST_NAME}",
        "port": "{{context.PORT}}",
        "description": "Servidor ${HOST_NAME}:{{context.PORT}}",
    }
    vars_map = {
        "HOST_NAME": "localhost",
        "PORT": 5432,
    }
    result = interpolate_context_variables(cfg, vars_map)
    assert result["host"] == "localhost"
    assert result["port"] == "5432"
    assert result["description"] == "Servidor localhost:5432"
    # Garante que o original não foi modificado
    assert cfg["host"] == "${HOST_NAME}"


def test_sql_formatting_in_query_fields():
    cfg = {
        "query": "SELECT * FROM users WHERE active = ${IS_ACTIVE} AND age > ${MIN_AGE} AND name = '${USER_NAME}' AND note = ${NOTE}",
        "duckdb_query": "SELECT * FROM tbl WHERE category = '${CAT}'",
        "other_field": "${USER_NAME}",
    }
    vars_map = {
        "IS_ACTIVE": True,
        "MIN_AGE": 18,
        "USER_NAME": "O'Connor",
        "NOTE": None,
        "CAT": "Tech",
    }
    result = interpolate_context_variables(cfg, vars_map)
    # No SQL: bool vira TRUE, int não ganha aspas, O'Connor escapa para O''Connor, None vira NULL
    assert "active = TRUE" in result["query"]
    assert "age > 18" in result["query"]
    assert "name = 'O''Connor'" in result["query"]
    assert "note = NULL" in result["query"]
    assert "category = 'Tech'" in result["duckdb_query"]
    # No other_field (texto simples): não escapa apóstrofe
    assert result["other_field"] == "O'Connor"


def test_missing_variable_raises_explicit_error():
    cfg = {"query": "SELECT * FROM ${MISSING_TABLE}"}
    vars_map = {"EXISTING": "ok"}
    with pytest.raises(DomainValidationError) as exc_info:
        interpolate_context_variables(cfg, vars_map)
    assert "MISSING_TABLE" in str(exc_info.value)
    assert "EXISTING" in str(exc_info.value)


def test_mask_secrets():
    text = "Conectando ao banco com senha SuperSecretPass123 e token TokenABC"
    secrets = ["SuperSecretPass123", "TokenABC"]
    masked = mask_secrets(text, secrets)
    assert "SuperSecretPass123" not in masked
    assert "TokenABC" not in masked
    assert masked == "Conectando ao banco com senha *** e token ***"


def test_context_variables_combined_with_worker_row_tokens():
    """Valida item 1.4: interpolação de contexto executada ANTES da interpolação por linha."""
    worker = ExecutionWorker()
    raw_query = "SELECT * FROM ${DB_SCHEMA}.clientes WHERE id = {{row.cliente_id}} AND status = '${STATUS}'"
    vars_map = {
        "DB_SCHEMA": "vendas",
        "STATUS": "ATIVO",
    }
    # 1. Interpola variáveis de contexto primeiro
    cfg = {"query": raw_query}
    interpolated_cfg = interpolate_context_variables(cfg, vars_map)
    query_after_context = interpolated_cfg["query"]

    assert query_after_context == "SELECT * FROM vendas.clientes WHERE id = {{row.cliente_id}} AND status = 'ATIVO'"

    # 2. Worker interpola por linha
    row_data = {"cliente_id": 999}
    final_query = worker._interpolate_tokens(query_after_context, row_data, upstream_id="input_1", is_sql=True)
    assert final_query == "SELECT * FROM vendas.clientes WHERE id = 999 AND status = 'ATIVO'"
