import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


def test_tmap_lookup_filter_with_alias():
    runner = DuckDBRunner()

    main_df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"],
        "city_id": [10, 20, 30]
    })

    lkp_df = pl.DataFrame({
        "city_id": [10, 20, 30],
        "city_name": ["SP", "RJ", "MG"],
        "status": ["ACTIVE", "INACTIVE", "ACTIVE"]
    })

    lookups = [{
        "node_id": "lkp_city",
        "alias": "lkp_city",
        "join_type": "LEFT",
        "join_keys": [{"expr_key": "main.city_id", "column": "city_id"}],
        "lookup_filter": "lkp_city.status == 'ACTIVE'"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "name", "expression": "main.name"},
            {"name": "city_name", "expression": "lkp_city.city_name"}
        ]
    }]

    result = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"lkp_city": lkp_df},
        variables=[],
        outputs=outputs
    )

    out_df = result["out"]
    assert out_df.height == 3
    # id 1 -> SP
    assert out_df.filter(pl.col("id") == 1)["city_name"][0] == "SP"
    # id 2 -> None (since RJ was filtered out before join because status == 'INACTIVE')
    assert out_df.filter(pl.col("id") == 2)["city_name"][0] is None
    # id 3 -> MG
    assert out_df.filter(pl.col("id") == 3)["city_name"][0] == "MG"


def test_tmap_lookup_filter_bare_column():
    runner = DuckDBRunner()

    main_df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"],
        "city_id": [10, 20, 30]
    })

    lkp_df = pl.DataFrame({
        "city_id": [10, 20, 30],
        "city_name": ["SP", "RJ", "MG"],
        "status": ["ACTIVE", "INACTIVE", "ACTIVE"]
    })

    # Filter using bare column strictly in lookup: status == 'ACTIVE'
    lookups = [{
        "node_id": "lkp_city",
        "alias": "lkp_city",
        "join_type": "INNER",
        "join_keys": [{"expr_key": "main.city_id", "column": "city_id"}],
        "lookup_filter": "status == 'ACTIVE'"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "city_name", "expression": "lkp_city.city_name"}
        ]
    }]

    result = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"lkp_city": lkp_df},
        variables=[],
        outputs=outputs
    )

    out_df = result["out"]
    # With INNER join, id 2 is excluded because lkp_city record 20 was filtered out
    assert out_df.height == 2
    assert sorted(out_df["id"].to_list()) == [1, 3]
    assert sorted(out_df["city_name"].to_list()) == ["MG", "SP"]
