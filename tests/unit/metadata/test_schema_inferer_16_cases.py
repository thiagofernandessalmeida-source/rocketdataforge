"""Suíte completa com os 16 casos de teste da Seção 5 de PROPOSTA_INFERENCIA_SCHEMA_SQL.md (T9)."""

from unittest.mock import MagicMock, patch
import pytest

from src.core.application.metadata.catalog_provider import (
    CatalogColumn,
    CatalogProvider,
    parse_format_type,
)
from src.core.application.metadata.schema_inferer import (
    SchemaInferer,
    map_postgres_type_to_logical,
)
from src.core.application.metadata.sql_lineage import SqlLineageAnalyzer
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType
from src.core.infrastructure.connectors.postgres_catalog_provider import (
    POSTGRES_CATALOG_QUERY,
    PostgresCatalogProvider,
)
from tests.unit.metadata.test_sql_lineage import FakeCatalogProvider


# -------------------------------------------------------------------------
# Caso 1: A query do usuário com CTE base
# -------------------------------------------------------------------------
def test_case_01_cte_base_query_excludes_rn_and_maps_origins():
    """Caso 1: Query com CTE 'base' (br.* + bp.person_uid + row_number() as rn) e SELECT final.

    Resultado: 5 colunas (person_code, person_uid, business_status_code, structure_code, structure_level),
    com origem na tabela correta, e rn NÃO aparece.
    """
    fake_catalog = FakeCatalogProvider({
        "brm.brm_business_relation": [
            CatalogColumn("person_code", "character varying(50)", False, True, length=50),
            CatalogColumn("person_id", "integer", False, False),
            CatalogColumn("business_status_code", "character varying(20)", True, False, length=20),
            CatalogColumn("structure_code", "character varying(30)", True, False, length=30),
            CatalogColumn("structure_level", "integer", True, False),
        ],
        "brm.brm_person": [
            CatalogColumn("id", "integer", False, True),
            CatalogColumn("person_uid", "character varying(64)", False, False, length=64),
        ],
    })

    sql = """
    WITH base AS (
        SELECT br.*, bp.person_uid, row_number() OVER() AS rn
        FROM brm.brm_business_relation br
        JOIN brm.brm_person bp ON bp.id = br.person_id
    )
    SELECT person_code, person_uid, business_status_code, structure_code, structure_level
    FROM base
    """

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert list(res.columns.keys()) == [
        "person_code",
        "person_uid",
        "business_status_code",
        "structure_code",
        "structure_level",
    ]
    assert "rn" not in res.columns
    assert any("brm_business_relation.person_code" in orig for orig in res.columns["person_code"].origin)
    assert any("brm_person.person_uid" in orig for orig in res.columns["person_uid"].origin)


# -------------------------------------------------------------------------
# Caso 2: SELECT * FROM t
# -------------------------------------------------------------------------
def test_case_02_select_star_from_table():
    """Caso 2: select * from t -> Todas as colunas de t, na ordem do catálogo."""
    fake_catalog = FakeCatalogProvider({
        "t": [
            CatalogColumn("col_a", "integer", False, True),
            CatalogColumn("col_b", "character varying(30)", True, False, length=30),
            CatalogColumn("col_c", "boolean", True, False),
        ]
    })

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage("SELECT * FROM t")

    assert list(res.columns.keys()) == ["col_a", "col_b", "col_c"]
    assert res.columns["col_a"].is_primary_key is True


# -------------------------------------------------------------------------
# Caso 3: WITH a AS (SELECT * FROM t) SELECT x, y FROM a
# -------------------------------------------------------------------------
def test_case_03_cte_filtering_columns():
    """Caso 3: with a as (select * from t) select x, y from a -> Só x e y, com origem em t."""
    fake_catalog = FakeCatalogProvider({
        "t": [
            CatalogColumn("x", "integer", False, True),
            CatalogColumn("y", "character varying(50)", True, False),
            CatalogColumn("z", "boolean", True, False),
        ]
    })

    sql = "WITH a AS (SELECT * FROM t) SELECT x, y FROM a"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert list(res.columns.keys()) == ["x", "y"]
    assert "z" not in res.columns
    assert any("t.x" in orig for orig in res.columns["x"].origin)
    assert any("t.y" in orig for orig in res.columns["y"].origin)


# -------------------------------------------------------------------------
# Caso 4: SELECT a.*, b.z FROM a JOIN b USING(id)
# -------------------------------------------------------------------------
def test_case_04_join_using_no_duplicate_id():
    """Caso 4: select a.*, b.z from a join b using(id) -> Colunas de a mais z, sem duplicar id."""
    fake_catalog = FakeCatalogProvider({
        "a": [
            CatalogColumn("id", "integer", False, True),
            CatalogColumn("alpha", "character varying(50)", True, False),
        ],
        "b": [
            CatalogColumn("id", "integer", False, True),
            CatalogColumn("z", "numeric(10,2)", True, False),
        ],
    })

    sql = "SELECT a.*, b.z FROM a JOIN b USING(id)"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert list(res.columns.keys()) == ["id", "alpha", "z"]


# -------------------------------------------------------------------------
# Caso 5: LEFT JOIN ajusta nullable para True
# -------------------------------------------------------------------------
def test_case_05_left_join_nullable_adjustment():
    """Caso 5: select a.id, b.v from a left join b on b.id = a.id, com b.v NOT NULL.

    Resultado: v com nullable = true (lado anulável do LEFT JOIN).
    """
    fake_catalog = FakeCatalogProvider({
        "a": [CatalogColumn("id", "integer", False, True)],
        "b": [
            CatalogColumn("id", "integer", False, True),
            CatalogColumn("v", "character varying(50)", False, False),  # NOT NULL no banco
        ],
    })

    sql = "SELECT a.id, b.v FROM a LEFT JOIN b ON b.id = a.id"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert res.columns["id"].nullable is False
    assert res.columns["v"].nullable is True


# -------------------------------------------------------------------------
# Caso 6: Agregações (count, max) marcadas computed
# -------------------------------------------------------------------------
def test_case_06_aggregations_marked_computed():
    """Caso 6: select count(*) as n, max(d) from t -> n e max marcadas computed."""
    fake_catalog = FakeCatalogProvider({
        "t": [CatalogColumn("d", "integer", False, False)]
    })

    sql = "SELECT count(*) AS n, max(d) AS max_d FROM t"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert res.columns["n"].computed is True
    assert res.columns["max_d"].computed is True


# -------------------------------------------------------------------------
# Caso 7: COALESCE(a.x, b.x) com duas origens
# -------------------------------------------------------------------------
def test_case_07_coalesce_multiple_origins():
    """Caso 7: select coalesce(a.x, b.x) as x from a, b -> x com duas origens."""
    fake_catalog = FakeCatalogProvider({
        "a": [CatalogColumn("x", "integer", False, False)],
        "b": [CatalogColumn("x", "integer", True, False)],
    })

    sql = "SELECT coalesce(a.x, b.x) AS x FROM a, b"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert len(res.columns["x"].origin) == 2
    assert any("a.x" in orig for orig in res.columns["x"].origin)
    assert any("b.x" in orig for orig in res.columns["x"].origin)


# -------------------------------------------------------------------------
# Caso 8: UNION ALL com origens em t1 e t2
# -------------------------------------------------------------------------
def test_case_08_union_all_multiple_origins():
    """Caso 8: select id from t1 union all select id from t2 -> id com origens em t1 e t2."""
    fake_catalog = FakeCatalogProvider({
        "t1": [CatalogColumn("id", "integer", False, True)],
        "t2": [CatalogColumn("id", "integer", False, True)],
    })

    sql = "SELECT id FROM t1 UNION ALL SELECT id FROM t2"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert any("t1.id" in orig for orig in res.columns["id"].origin)
    assert any("t2.id" in orig for orig in res.columns["id"].origin)


# -------------------------------------------------------------------------
# Caso 9: Subquery SELECT * FROM (SELECT id, name FROM t) s
# -------------------------------------------------------------------------
def test_case_09_subquery_projections():
    """Caso 9: select * from (select id, name from t) s -> id e name."""
    fake_catalog = FakeCatalogProvider({
        "t": [
            CatalogColumn("id", "integer", False, True),
            CatalogColumn("name", "character varying(100)", True, False),
        ]
    })

    sql = "SELECT * FROM (SELECT id, name FROM t) s"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert list(res.columns.keys()) == ["id", "name"]
    assert any("t.id" in orig for orig in res.columns["id"].origin)


# -------------------------------------------------------------------------
# Caso 10: Query com erro de sintaxe
# -------------------------------------------------------------------------
def test_case_10_syntax_error_returns_db_error_never_regex():
    """Caso 10: Query com erro de sintaxe devolve erro com mensagem sanitizada do banco, nunca regex."""
    inferer = SchemaInferer()
    broken_sql = "SELECT FROM WHERE"

    with pytest.raises(DomainValidationError) as exc:
        inferer.infer_from_sql_query(broken_sql)

    err = str(exc.value).lower()
    assert "erro" in err or "sintaxe" in err or "não foi possível" in err


# -------------------------------------------------------------------------
# Caso 11: Query com token {n.code}
# -------------------------------------------------------------------------
def test_case_11_token_replaced_by_null():
    """Caso 11: Query com where code = {n.code} -> A inferência funciona, token vira NULL."""
    inferer = SchemaInferer()
    query = "SELECT id FROM users WHERE code = {n.code}"
    conn_details = {"host": "localhost", "database": "db"}

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = [("id", "integer")]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn):
        schema = inferer.infer_from_sql_query(query, connection_details=conn_details)

    all_sqls = [call[0][0] for call in mock_cur.execute.call_args_list]
    assert any("WHERE code = NULL" in sql for sql in all_sqls)
    assert not any("WHERE code = 1" in sql for sql in all_sqls)
    assert schema.fields[0].name == "id"


# -------------------------------------------------------------------------
# Caso 12: Identificador entre aspas preserva a caixa
# -------------------------------------------------------------------------
def test_case_12_quoted_identifier_preserves_case():
    """Caso 12: select "Person_Code" from t -> Respeita a caixa."""
    fake_catalog = FakeCatalogProvider({
        "t": [CatalogColumn("Person_Code", "character varying(50)", True, False)]
    })

    sql = 'SELECT "Person_Code" FROM t'
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert "Person_Code" in res.columns


# -------------------------------------------------------------------------
# Caso 13: Tabela base é uma view (relkind = 'v')
# -------------------------------------------------------------------------
def test_case_13_base_table_is_a_view():
    """Caso 13: Tabela base é uma view -> Resolvida pelo catálogo (relkind in ('r','v','m','p','f'))."""
    assert "c.relkind IN ('r', 'v', 'm', 'p', 'f')" in POSTGRES_CATALOG_QUERY

    fake_catalog = FakeCatalogProvider({
        "v_active_users": [
            CatalogColumn("user_id", "integer", False, True),
            CatalogColumn("email", "character varying(100)", True, False),
        ]
    })

    sql = "SELECT user_id, email FROM v_active_users"
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    res = analyzer.analyze_lineage(sql)

    assert list(res.columns.keys()) == ["user_id", "email"]
    assert any("v_active_users.user_id" in orig for orig in res.columns["user_id"].origin)


# -------------------------------------------------------------------------
# Caso 14: Tabela inexistente
# -------------------------------------------------------------------------
def test_case_14_non_existent_table_raises_validation_error():
    """Caso 14: Tabela inexistente -> ValidationError com o nome da tabela; sem schema parcial silencioso."""
    fake_catalog = FakeCatalogProvider({})
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")

    with pytest.raises(DomainValidationError) as exc:
        analyzer.infer_offline("SELECT * FROM missing_table")

    assert "missing_table" in str(exc.value)


# -------------------------------------------------------------------------
# Caso 15: Parsing de length, precision e scale
# -------------------------------------------------------------------------
def test_case_15_length_precision_scale_parsing():
    """Caso 15: varchar(50) e numeric(12,2) no catálogo -> length = 50; precision = 12, scale = 2."""
    len1, prec1, scale1 = parse_format_type("character varying(50)")
    assert len1 == 50
    assert prec1 is None
    assert scale1 is None

    len2, prec2, scale2 = parse_format_type("numeric(12,2)")
    assert len2 is None
    assert prec2 == 12
    assert scale2 == 2


# -------------------------------------------------------------------------
# Caso 16: Mapeamento de tipos especiais do PostgreSQL
# -------------------------------------------------------------------------
def test_case_16_postgres_special_types_mapping():
    """Caso 16: timestamptz, int2, uuid, jsonb, text[].

    Mapeamento para TIMESTAMP_TZ, INT16, STRING (physical uuid), JSON, ARRAY.
    """
    prov = PostgresCatalogProvider()

    assert prov.resolve_type("timestamp with time zone") == LogicalDataType.TIMESTAMP_TZ
    assert prov.resolve_type("timestamptz") == LogicalDataType.TIMESTAMP_TZ

    assert prov.resolve_type("smallint") == LogicalDataType.INT16
    assert prov.resolve_type("int2") == LogicalDataType.INT16

    assert prov.resolve_type("uuid") == LogicalDataType.STRING

    assert prov.resolve_type("jsonb") == LogicalDataType.JSON
    assert prov.resolve_type("json") == LogicalDataType.JSON

    assert prov.resolve_type("text[]") == LogicalDataType.ARRAY
    assert prov.resolve_type("integer[]") == LogicalDataType.ARRAY

    # Via mapeamento de OID do PostgreSQL (Camada A1)
    logical, physical = map_postgres_type_to_logical(1184)
    assert logical == LogicalDataType.TIMESTAMP_TZ
    assert physical == "timestamptz"

    logical, physical = map_postgres_type_to_logical(21)
    assert logical == LogicalDataType.INT16
    assert physical == "smallint"

    logical, physical = map_postgres_type_to_logical(2950)
    assert logical == LogicalDataType.STRING
    assert physical == "uuid"

    logical, physical = map_postgres_type_to_logical(3802)
    assert logical == LogicalDataType.JSON
    assert physical == "jsonb"

    logical, physical = map_postgres_type_to_logical(1009)
    assert logical == LogicalDataType.ARRAY
    assert physical == "text[]"
