"""Testes unitários para CatalogProvider e PostgresCatalogProvider (T4)."""

import pytest
from unittest.mock import MagicMock

from src.core.domain.shared.types import LogicalDataType
from src.core.application.metadata.catalog_provider import (
    CatalogColumn,
    CatalogProvider,
    parse_format_type,
)
from src.core.infrastructure.connectors.postgres_catalog_provider import PostgresCatalogProvider


def test_parse_format_type_various_types():
    # Varchar / Char
    assert parse_format_type("character varying(50)") == (50, None, None)
    assert parse_format_type("varchar(255)") == (255, None, None)
    assert parse_format_type("character(10)") == (10, None, None)
    assert parse_format_type("char(5)") == (5, None, None)

    # Numeric / Decimal
    assert parse_format_type("numeric(12,2)") == (None, 12, 2)
    assert parse_format_type("numeric(10)") == (None, 10, None)
    assert parse_format_type("decimal(18,4)") == (None, 18, 4)

    # Types without modifiers
    assert parse_format_type("integer") == (None, None, None)
    assert parse_format_type("text") == (None, None, None)
    assert parse_format_type("boolean") == (None, None, None)
    assert parse_format_type("timestamp with time zone") == (None, None, None)


def test_postgres_catalog_provider_resolve_type():
    provider = PostgresCatalogProvider(conn=MagicMock())

    assert provider.resolve_type("smallint") == LogicalDataType.INT16
    assert provider.resolve_type("integer") == LogicalDataType.INT32
    assert provider.resolve_type("int4") == LogicalDataType.INT32
    assert provider.resolve_type("bigint") == LogicalDataType.INT64
    assert provider.resolve_type("real") == LogicalDataType.FLOAT32
    assert provider.resolve_type("double precision") == LogicalDataType.FLOAT64
    assert provider.resolve_type("numeric(12,2)") == LogicalDataType.DECIMAL
    assert provider.resolve_type("boolean") == LogicalDataType.BOOLEAN
    assert provider.resolve_type("text") == LogicalDataType.STRING
    assert provider.resolve_type("character varying(50)") == LogicalDataType.STRING
    assert provider.resolve_type("uuid") == LogicalDataType.STRING
    assert provider.resolve_type("citext") == LogicalDataType.STRING
    assert provider.resolve_type("bytea") == LogicalDataType.BINARY
    assert provider.resolve_type("date") == LogicalDataType.DATE
    assert provider.resolve_type("time without time zone") == LogicalDataType.TIME
    assert provider.resolve_type("timestamp without time zone") == LogicalDataType.TIMESTAMP
    assert provider.resolve_type("timestamp with time zone") == LogicalDataType.TIMESTAMP_TZ
    assert provider.resolve_type("timestamptz") == LogicalDataType.TIMESTAMP_TZ
    assert provider.resolve_type("json") == LogicalDataType.JSON
    assert provider.resolve_type("jsonb") == LogicalDataType.JSON
    assert provider.resolve_type("text[]") == LogicalDataType.ARRAY
    assert provider.resolve_type("integer[]") == LogicalDataType.ARRAY
    assert provider.resolve_type("composite_type") == LogicalDataType.UNKNOWN


def test_postgres_catalog_provider_get_table_columns_bound_parameters():
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    # Simula retorno do catálogo do PostgreSQL
    mock_cursor.fetchall.return_value = [
        ("id", "integer", False, True, "Primary key"),
        ("name", "character varying(100)", True, False, None),
        ("salary", "numeric(10,2)", True, False, "Salário"),
    ]

    provider = PostgresCatalogProvider(conn=mock_conn)
    cols = provider.get_table_columns(catalog="brm", schema="public", table="employees")

    # Verifica se query utilizou parâmetros ligados %(schema)s e %(table)s
    mock_cursor.execute.assert_called_once()
    sql_arg, params_arg = mock_cursor.execute.call_args[0]
    assert "%(schema)s" in sql_arg
    assert "%(table)s" in sql_arg
    assert params_arg == {"schema": "public", "table": "employees"}

    # Verifica mapeamento das colunas
    assert len(cols) == 3

    assert cols[0] == CatalogColumn(
        name="id",
        data_type="integer",
        nullable=False,
        is_primary_key=True,
        length=None,
        precision=None,
        scale=None,
        comment="Primary key",
    )

    assert cols[1] == CatalogColumn(
        name="name",
        data_type="character varying(100)",
        nullable=True,
        is_primary_key=False,
        length=100,
        precision=None,
        scale=None,
        comment=None,
    )

    assert cols[2] == CatalogColumn(
        name="salary",
        data_type="numeric(10,2)",
        nullable=True,
        is_primary_key=False,
        length=None,
        precision=10,
        scale=2,
        comment="Salário",
    )
