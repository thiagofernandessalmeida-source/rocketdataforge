"""Testes Unitários para tMap com Lookup Vazio (height == 0).

Valida conformidade com RF-04.1 e Tarefas T-2.1 / T-2.2:
- Lookups vazios (height == 0) não disparam 'continue'.
- Devem registrar schema e alias no catálogo DuckDB.
- Em INNER JOIN, a saída principal é esvaziada (todas as linhas são rejeitadas).
- Em LEFT JOIN, as colunas do lookup são preservadas e preenchidas com NULL.
"""

import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner():
    r = DuckDBRunner()
    yield r
    r.close()


def test_tmap_empty_lookup_left_join(runner):
    """Em LEFT JOIN com lookup vazio (0 linhas), preserva o main_df e preenche colunas do lookup com NULL."""
    main_df = pl.DataFrame({
        "id": [1, 2],
        "name": ["Alice", "Bob"]
    })
    empty_lookup_df = pl.DataFrame({
        "id": pl.Series([], dtype=pl.Int64),
        "city": pl.Series([], dtype=pl.Utf8)
    })

    lookups = [{
        "node_id": "cities_node",
        "alias": "lkp_city",
        "left_keys": ["id"],
        "right_keys": ["id"],
        "join_model": "left_outer",
        "match_model": "unique"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "name", "expression": "main.name"},
            {"name": "city", "expression": "lkp_city.city"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"cities_node": empty_lookup_df},
        variables=[],
        outputs=outputs
    )

    out_df = res["out"]
    assert out_df.height == 2
    assert out_df["name"].to_list() == ["Alice", "Bob"]
    assert out_df["city"].to_list() == [None, None]


def test_tmap_empty_lookup_inner_join(runner):
    """Em INNER JOIN com lookup vazio (0 linhas), a saída principal deve ser esvaziada."""
    main_df = pl.DataFrame({
        "id": [1, 2],
        "name": ["Alice", "Bob"]
    })
    empty_lookup_df = pl.DataFrame({
        "id": pl.Series([], dtype=pl.Int64),
        "city": pl.Series([], dtype=pl.Utf8)
    })

    lookups = [{
        "node_id": "cities_node",
        "alias": "lkp_city",
        "left_keys": ["id"],
        "right_keys": ["id"],
        "join_model": "inner",
        "match_model": "all"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "name", "expression": "main.name"},
            {"name": "city", "expression": "lkp_city.city"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"cities_node": empty_lookup_df},
        variables=[],
        outputs=outputs
    )

    out_df = res["out"]
    assert out_df.height == 0
