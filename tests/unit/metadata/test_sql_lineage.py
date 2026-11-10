"""Testes unitários para o analisador de linhagem SQL (Camada B - sqlglot) (T6)."""

import pytest
from src.core.domain.shared.types import LogicalDataType
from src.core.application.metadata.catalog_provider import CatalogColumn, CatalogProvider
from src.core.application.metadata.sql_lineage import SqlLineageAnalyzer


class FakeCatalogProvider(CatalogProvider):
    """Provedor de catálogo em memória para testes."""

    def __init__(self, tables_meta: dict):
        self.tables_meta = tables_meta

    def get_table_columns(self, catalog, schema, table):
        # Chaves de busca: "catalog.schema.table", "schema.table" ou "table"
        candidates = [
            f"{catalog}.{schema}.{table}" if catalog and schema else None,
            f"{schema}.{table}" if schema else None,
            table,
        ]
        for key in candidates:
            if key and key in self.tables_meta:
                return self.tables_meta[key]
        return []

    def resolve_type(self, catalog_type: str) -> LogicalDataType:
        clean = catalog_type.lower()
        if "int" in clean:
            return LogicalDataType.INT32
        if "numeric" in clean or "decimal" in clean:
            return LogicalDataType.DECIMAL
        if "bool" in clean:
            return LogicalDataType.BOOLEAN
        return LogicalDataType.STRING


def test_t6_cte_lineage_main_acceptance_criteria():
    """T6 & Critério de Aceite Principal:

    Para a query com CTE 'base' (br.* + bp.person_uid + row_number() as rn) e SELECT final:
    person_code, person_uid, business_status_code, structure_code, structure_level.
    O schema tem exatamente essas 5 colunas, cada uma com tipo do catálogo e origem na tabela correta,
    e 'rn' NÃO aparece.
    """
    fake_catalog = FakeCatalogProvider({
        "brm.brm_business_relation": [
            CatalogColumn("person_code", "character varying(50)", nullable=False, is_primary_key=True, length=50),
            CatalogColumn("person_id", "integer", nullable=False, is_primary_key=False),
            CatalogColumn("business_status_code", "character varying(20)", nullable=True, is_primary_key=False, length=20),
            CatalogColumn("structure_code", "character varying(30)", nullable=True, is_primary_key=False, length=30),
            CatalogColumn("structure_level", "integer", nullable=True, is_primary_key=False),
        ],
        "brm.brm_person": [
            CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
            CatalogColumn("person_uid", "character varying(64)", nullable=False, is_primary_key=False, length=64),
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
    result = analyzer.analyze_lineage(sql)

    output_columns = list(result.columns.keys())
    # Exatamente as 5 colunas do SELECT final, sem rn
    assert output_columns == [
        "person_code",
        "person_uid",
        "business_status_code",
        "structure_code",
        "structure_level",
    ]
    assert "rn" not in output_columns

    # Origens corretas
    assert any("brm.brm_business_relation.person_code" in orig for orig in result.columns["person_code"].origin)
    assert result.columns["person_code"].is_primary_key is True
    assert result.columns["person_code"].length == 50

    assert any("brm.brm_person.person_uid" in orig for orig in result.columns["person_uid"].origin)
    assert result.columns["person_uid"].length == 64

    assert any("brm.brm_business_relation.business_status_code" in orig for orig in result.columns["business_status_code"].origin)
    assert any("brm.brm_business_relation.structure_code" in orig for orig in result.columns["structure_code"].origin)
    assert any("brm.brm_business_relation.structure_level" in orig for orig in result.columns["structure_level"].origin)


def test_t6_left_join_nullable_adjustment():
    """T6: Coluna de tabela no lado anulável de LEFT JOIN ganha nullable = True."""
    fake_catalog = FakeCatalogProvider({
        "a": [
            CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
        ],
        "b": [
            CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
            CatalogColumn("v", "character varying(50)", nullable=False, is_primary_key=False), # NOT NULL na tabela
        ],
    })

    sql = "SELECT a.id, b.v FROM a LEFT JOIN b ON b.id = a.id"

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    result = analyzer.analyze_lineage(sql)

    assert result.columns["id"].nullable is False
    # b.v era NOT NULL na tabela b, mas como veio de um LEFT JOIN, torna-se nullable = True
    assert result.columns["v"].nullable is True


def test_t6_computed_columns():
    """T6: Colunas sem tabela (count, max) são marcadas computed = True."""
    fake_catalog = FakeCatalogProvider({
        "t": [
            CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
            CatalogColumn("d", "integer", nullable=False, is_primary_key=False),
        ],
    })

    sql = "SELECT count(*) AS n, max(d) AS max_d FROM t"

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    result = analyzer.analyze_lineage(sql)

    assert result.columns["n"].computed is True
    assert result.columns["n"].origin == []

    assert result.columns["max_d"].computed is True


def test_t6_multiple_origins():
    """T6: Colunas com múltiplas origens (ex: coalesce(a.x, b.x)) guardam todas as origens."""
    fake_catalog = FakeCatalogProvider({
        "a": [CatalogColumn("x", "integer", nullable=False, is_primary_key=False)],
        "b": [CatalogColumn("x", "integer", nullable=True, is_primary_key=False)],
    })

    sql = "SELECT coalesce(a.x, b.x) AS x FROM a, b"

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    result = analyzer.analyze_lineage(sql)

    assert len(result.columns["x"].origin) == 2
    assert any("a.x" in orig for orig in result.columns["x"].origin)
    assert any("b.x" in orig for orig in result.columns["x"].origin)
    # Nulabilidade é união: True
    assert result.columns["x"].nullable is True


def test_t7_layer_c_offline_mode():
    """T7: Camada C (offline) infere schema estaticamente com annotate_types e inference_source='static'."""
    fake_catalog = FakeCatalogProvider({
        "products": [
            CatalogColumn("id", "integer", nullable=False, is_primary_key=True),
            CatalogColumn("name", "character varying(120)", nullable=False, is_primary_key=False, length=120),
            CatalogColumn("price", "numeric(10,2)", nullable=True, is_primary_key=False),
        ],
    })

    sql = "SELECT id, name, price, count(*) AS total FROM products GROUP BY id, name, price"

    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")
    inferred = analyzer.infer_offline(sql, dataset_name="products_offline")

    assert inferred.inference_source == "static"
    assert any("estimado" in w.lower() for w in inferred.warnings)

    fields_by_name = {f.name: f for f in inferred.fields}
    assert "id" in fields_by_name
    assert "name" in fields_by_name
    assert "price" in fields_by_name
    assert "total" in fields_by_name

    assert fields_by_name["id"].is_primary_key is True
    assert fields_by_name["name"].length == 120
    assert fields_by_name["total"].computed is True


def test_t7_layer_c_offline_syntax_error_raises():
    """T7: Se a query tiver erro de sintaxe, deve falhar com erro e nunca retornar schema parcial."""
    from src.core.domain.shared.exceptions import DomainValidationError

    fake_catalog = FakeCatalogProvider({})
    analyzer = SqlLineageAnalyzer(catalog_provider=fake_catalog, dialect="postgres")

    with pytest.raises(DomainValidationError):
        analyzer.infer_offline("SELECT FROM WHERE")
