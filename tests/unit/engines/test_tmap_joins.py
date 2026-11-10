import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


def test_tmap_join_match_models_determinism():
    runner = DuckDBRunner()

    main_df = pl.DataFrame({
        "id": [1, 2],
        "name": ["Alpha", "Beta"]
    })

    # Lookup has multiple matches for id 1 (orders 101, 102, 103) and single match for id 2 (order 201)
    orders_df = pl.DataFrame({
        "customer_id": [1, 1, 1, 2],
        "order_code": ["ORD-101", "ORD-102", "ORD-103", "ORD-201"],
        "amount": [10.0, 20.0, 30.0, 50.0]
    })

    # 1. Test All Matches
    lookups_all = [{
        "node_id": "orders",
        "alias": "orders",
        "join_type": "LEFT",
        "join_keys": [{"expr_key": "main.id", "column": "customer_id"}],
        "match_model": "All Matches"
    }]

    res_all = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups_all,
        lookup_dfs={"orders": orders_df},
        variables=[],
        outputs=[{
            "name": "out",
            "columns": [
                {"name": "id", "expression": "main.id"},
                {"name": "order_code", "expression": "orders.order_code"},
                {"name": "amount", "expression": "orders.amount"}
            ]
        }]
    )
    out_all = res_all["out"]
    assert out_all.height == 4
    # Check deterministic order of orders for customer 1
    cust1_orders = out_all.filter(pl.col("id") == 1)["order_code"].to_list()
    assert cust1_orders == ["ORD-101", "ORD-102", "ORD-103"]

    # 2. Test First Match
    lookups_first = [{
        "node_id": "orders",
        "alias": "orders",
        "join_type": "LEFT",
        "join_keys": [{"expr_key": "main.id", "column": "customer_id"}],
        "match_model": "First Match"
    }]

    res_first = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups_first,
        lookup_dfs={"orders": orders_df},
        variables=[],
        outputs=[{
            "name": "out",
            "columns": [
                {"name": "id", "expression": "main.id"},
                {"name": "order_code", "expression": "orders.order_code"}
            ]
        }]
    )
    out_first = res_first["out"]
    assert out_first.height == 2
    assert out_first.filter(pl.col("id") == 1)["order_code"][0] == "ORD-101"
    assert out_first.filter(pl.col("id") == 2)["order_code"][0] == "ORD-201"

    # 3. Test Unique Match (Talend standard: last matching row)
    lookups_unique = [{
        "node_id": "orders",
        "alias": "orders",
        "join_type": "LEFT",
        "join_keys": [{"expr_key": "main.id", "column": "customer_id"}],
        "match_model": "Unique Match"
    }]

    res_unique = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups_unique,
        lookup_dfs={"orders": orders_df},
        variables=[],
        outputs=[{
            "name": "out",
            "columns": [
                {"name": "id", "expression": "main.id"},
                {"name": "order_code", "expression": "orders.order_code"}
            ]
        }]
    )
    out_unique = res_unique["out"]
    assert out_unique.height == 2
    assert out_unique.filter(pl.col("id") == 1)["order_code"][0] == "ORD-103"
    assert out_unique.filter(pl.col("id") == 2)["order_code"][0] == "ORD-201"


def test_tmap_lookup_reject_flags():
    runner = DuckDBRunner()

    main_df = pl.DataFrame({
        "id": [1, 2, 3],
        "name": ["Alice", "Bob", "Charlie"]
    })

    # Only Alice (1) and Charlie (3) exist in lookup
    dept_df = pl.DataFrame({
        "emp_id": [1, 3],
        "dept_name": ["Engineering", "HR"]
    })

    lookups = [{
        "node_id": "dept",
        "alias": "dept",
        "join_type": "INNER",
        "join_keys": [{"expr_key": "main.id", "column": "emp_id"}],
        "match_model": "unique"
    }]

    outputs = [
        {
            "name": "main_output",
            "catch_inner_join_reject": False,
            "catch_output_reject": False,
            "columns": [
                {"name": "id", "expression": "main.id"},
                {"name": "name", "expression": "main.name"},
                {"name": "dept_name", "expression": "dept.dept_name"}
            ]
        },
        {
            "name": "lookup_reject_output",
            "catch_lookup_reject": True,
            "columns": [
                {"name": "id", "expression": "main.id"},
                {"name": "name", "expression": "main.name"}
            ]
        }
    ]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"dept": dept_df},
        variables=[],
        outputs=outputs
    )

    main_out = res["main_output"]
    reject_out = res["lookup_reject_output"]

    assert main_out.height == 2
    assert sorted(main_out["id"].to_list()) == [1, 3]

    # Bob (2) had no matching department and was rejected by inner join
    assert reject_out.height == 1
    assert reject_out["id"][0] == 2
    assert reject_out["name"][0] == "Bob"


def test_tmap_duckdb_security_external_access_disabled():
    runner = DuckDBRunner()
    main_df = pl.DataFrame({"id": [1]})
    outputs = [{
        "name": "out",
        "columns": [
            {"name": "hacked", "expression": "(SELECT * FROM read_text('some_external_file.txt'))"}
        ]
    }]
    with pytest.raises(Exception) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=[],
            lookup_dfs={},
            variables=[],
            outputs=outputs
        )
    err_text = str(exc_info.value).lower()
    assert any(term in err_text for term in ("external access", "permission error", "disabled"))



