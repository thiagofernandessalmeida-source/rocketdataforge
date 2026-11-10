"""Testes unitários para a inferência de schema via consulta SQL (SchemaInferer)."""

from unittest.mock import MagicMock, patch
import pytest
import psycopg2

from src.core.application.metadata.schema_inferer import SchemaInferer
from src.core.domain.shared.exceptions import DomainValidationError


def test_t1_postgres_syntax_error_raises_domain_validation_error_and_no_regex_fallback():
    """T1: Query com erro de sintaxe no Postgres deve devolver erro sanitizado e NUNCA resultado de regex."""
    inferer = SchemaInferer()

    broken_query = "WITH base AS (SELECT br.* bp.person_uid FROM br) SELECT person_code FROM base"
    conn_details = {
        "host": "localhost",
        "port": 5432,
        "database": "test_db",
        "username": "postgres",
        "password": "secret_password"
    }

    # Simula erro de sintaxe lançado pelo psycopg2
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.execute.side_effect = psycopg2.ProgrammingError('syntax error at or near "bp"')
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        with pytest.raises(DomainValidationError) as exc_info:
            inferer.infer_from_sql_query(
                query=broken_query,
                connection_details=conn_details,
                dataset_name="broken_cte"
            )

        err_msg = str(exc_info.value)
        assert "syntax error" in err_msg.lower() or "erro" in err_msg.lower()
        # Garante que nenhum fallback de regex foi retornado
        assert "bp.person_uid" not in err_msg
        assert "secret_password" not in err_msg


def test_t2_token_replaced_by_null_in_query():
    """T2: Garante que {node.code} é substituído por NULL em vez de '1'."""
    inferer = SchemaInferer()
    query = "SELECT id FROM users WHERE code = {node.code}"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.description = [("id", 23, None, None, None, None, None)]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        inferer.infer_from_sql_query(query=query, connection_details=conn_details)

    all_sqls = [call[0][0] for call in mock_cur.execute.call_args_list]
    assert any("WHERE code = NULL" in sql for sql in all_sqls)
    assert not any("WHERE code = 1" in sql for sql in all_sqls)


def test_t2_regex_fallback_removed_raises_validation_error():
    """T2: Se a query falhar no banco e DuckDB vazio, deve falhar com erro e NUNCA usar regex para chutar colunas."""
    inferer = SchemaInferer()
    # Tabela inexistente no DuckDB
    query = "WITH base AS (SELECT br.*, bp.person_uid, row_number() over() as rn FROM br, bp) SELECT person_code, person_uid FROM base"

    with pytest.raises(DomainValidationError) as exc_info:
        inferer.infer_from_sql_query(query=query)

    err = str(exc_info.value).lower()
    assert "não foi possível inferir" in err or "não encontrada no catálogo" in err


def test_t3_postgres_type_mapping():
    """T3: Mapeamento de tipos Postgres: timestamptz -> TIMESTAMP_TZ, int2 -> INT16, uuid, json/jsonb, bytea, array."""
    inferer = SchemaInferer()
    query = "SELECT t_z, s_int, u_id, j_son, j_sonb, b_ytes, a_rr FROM test_types"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    # (name, type_code, display_size, internal_size, precision, scale, null_ok)
    mock_cur.description = [
        ("t_z", 1184, None, None, None, None, None),    # timestamptz
        ("s_int", 21, None, None, None, None, None),    # int2 / smallint
        ("u_id", 2950, None, None, None, None, None),   # uuid
        ("j_son", 114, None, None, None, None, None),   # json
        ("j_sonb", 3802, None, None, None, None, None), # jsonb
        ("b_ytes", 17, None, None, None, None, None),   # bytea
        ("a_rr", 1009, None, None, None, None, None),   # text[]
    ]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        schema = inferer.infer_from_sql_query(query=query, connection_details=conn_details)

    fields_by_name = {f.name: f for f in schema.fields}

    from src.core.domain.shared.types import LogicalDataType

    assert fields_by_name["t_z"].logical_type == LogicalDataType.TIMESTAMP_TZ
    assert fields_by_name["t_z"].physical_type == "timestamptz"

    assert fields_by_name["s_int"].logical_type == LogicalDataType.INT16
    assert fields_by_name["s_int"].physical_type == "smallint"

    assert fields_by_name["u_id"].logical_type == LogicalDataType.STRING
    assert fields_by_name["u_id"].physical_type == "uuid"

    assert fields_by_name["j_son"].logical_type == LogicalDataType.JSON
    assert fields_by_name["j_son"].physical_type == "json"

    assert fields_by_name["j_sonb"].logical_type == LogicalDataType.JSON
    assert fields_by_name["j_sonb"].physical_type == "jsonb"

    assert fields_by_name["b_ytes"].logical_type == LogicalDataType.BINARY
    assert fields_by_name["b_ytes"].physical_type == "bytea"

    assert fields_by_name["a_rr"].logical_type == LogicalDataType.ARRAY
    assert fields_by_name["a_rr"].physical_type == "text[]"


def test_t5_layer_a2_temp_view_success():
    """T5: Camada A2 cria view temporária com ROLLBACK e lê format_type com length/precision/scale."""
    from src.core.domain.shared.types import LogicalDataType

    inferer = SchemaInferer()
    query = "SELECT code, amount FROM transactions"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()

    # Na camada A2, fetchall() devolve colunas de _rdf_infer
    mock_cur.fetchall.return_value = [
        ("code", "character varying(50)"),
        ("amount", "numeric(12,2)"),
    ]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        schema = inferer.infer_from_sql_query(query=query, connection_details=conn_details)

    executed_sqls = [call_args[0][0] for call_args in mock_cur.execute.call_args_list]

    # Verifica se A2 executou BEGIN READ WRITE, CREATE TEMP VIEW e ROLLBACK
    assert any("BEGIN READ WRITE" in sql for sql in executed_sqls)
    assert any("CREATE TEMP VIEW _rdf_infer" in sql for sql in executed_sqls)
    assert any("format_type(a.atttypid, a.atttypmod)" in sql for sql in executed_sqls)
    assert any("ROLLBACK" in sql for sql in executed_sqls)

    fields_by_name = {f.name: f for f in schema.fields}
    assert fields_by_name["code"].logical_type == LogicalDataType.STRING
    assert fields_by_name["code"].physical_type == "character varying(50)"
    assert fields_by_name["code"].length == 50

    assert fields_by_name["amount"].logical_type == LogicalDataType.DECIMAL
    assert fields_by_name["amount"].physical_type == "numeric(12,2)"
    assert fields_by_name["amount"].precision == 12
    assert fields_by_name["amount"].scale == 2


def test_t5_layer_a2_fallback_to_a1_on_permission_error():
    """T5: Se CREATE TEMP VIEW falhar por permissão, dá ROLLBACK e cai para A1 (LIMIT 0)."""
    from src.core.domain.shared.types import LogicalDataType

    inferer = SchemaInferer()
    query = "SELECT id, name FROM users"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()

    # Simula erro de permissão no CREATE TEMP VIEW
    def mock_execute(sql, *args, **kwargs):
        if "CREATE TEMP VIEW" in sql:
            raise psycopg2.ProgrammingError("permission denied to create temporary tables")
        return None

    mock_cur.execute.side_effect = mock_execute
    mock_cur.description = [
        ("id", 23, None, None, None, None, None),       # int4
        ("name", 1043, None, None, None, None, None),   # varchar
    ]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        schema = inferer.infer_from_sql_query(query=query, connection_details=conn_details)

    executed_sqls = [call_args[0][0] for call_args in mock_cur.execute.call_args_list]

    # Garante que tentou A2, executou ROLLBACK, e executou A1 (LIMIT 0)
    assert any("CREATE TEMP VIEW _rdf_infer" in sql for sql in executed_sqls)
    assert any("LIMIT 0" in sql for sql in executed_sqls)

    fields_by_name = {f.name: f for f in schema.fields}
    assert fields_by_name["id"].logical_type == LogicalDataType.INT32
    assert fields_by_name["name"].logical_type == LogicalDataType.STRING


def test_t6_schema_inferer_enriches_with_layer_b_lineage():
    """T6: SchemaInferer enriquece schema da Camada A com linhagem e catálogo da Camada B."""
    from src.core.domain.shared.types import LogicalDataType

    inferer = SchemaInferer()
    query = "SELECT u.id, u.username FROM users u"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    # A2 retorna colunas
    mock_cur.fetchall.return_value = [
        ("id", "integer"),
        ("username", "character varying(80)"),
    ]
    mock_conn.cursor.return_value = mock_cur

    # Mockamos PostgresCatalogProvider para retornar metadados de catálogo da tabela users
    from src.core.application.metadata.catalog_provider import CatalogColumn
    fake_cols = [
        CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
        CatalogColumn("username", "character varying(80)", nullable=False, is_primary_key=False, length=80),
    ]

    with patch("psycopg2.connect", return_value=mock_conn):
        with patch("src.core.infrastructure.connectors.postgres_catalog_provider.PostgresCatalogProvider.get_table_columns", return_value=fake_cols):
            schema = inferer.infer_from_sql_query(query=query, connection_details=conn_details)

    assert schema.inference_source == "database+lineage"
    fields_by_name = {f.name: f for f in schema.fields}

    assert fields_by_name["id"].is_primary_key is True
    assert any("users.id" in orig for orig in fields_by_name["id"].origin)

    assert fields_by_name["username"].length == 80
    assert any("users.username" in orig for orig in fields_by_name["username"].origin)


