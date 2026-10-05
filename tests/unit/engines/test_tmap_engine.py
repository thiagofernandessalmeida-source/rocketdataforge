"""Testes Unitários para o Motor de Execução tMap (Talend Standard).

Valida Match Models, Inner Join Rejects, Output Rejects, Variáveis Intermediárias e Múltiplas Saídas.
"""

import polars as pl
import pytest
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner():
    r = DuckDBRunner()
    yield r
    r.close()


def test_tmap_basic_mapping_and_arithmetic(runner):
    main_df = pl.DataFrame({
        "id": [1, 2],
        "first_name": ["John", "Jane"],
        "last_name": ["Doe", "Smith"],
        "price": [100.0, 50.0],
        "discount": [0.1, 0.2]
    })

    outputs = [{
        "name": "main_out",
        "columns": [
            {"name": "full_name", "expression": "first_name || ' ' || last_name"},
            {"name": "final_price", "expression": "price * (1 - discount)"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[],
        lookup_dfs={},
        variables=[],
        outputs=outputs
    )

    out_df = res["main_out"]
    assert out_df.height == 2
    assert out_df["full_name"].to_list() == ["John Doe", "Jane Smith"]
    assert out_df["final_price"].to_list() == [90.0, 40.0]


def test_tmap_match_models_all_first_unique(runner):
    main_df = pl.DataFrame({"cust_id": [1, 2]})
    lookup_df = pl.DataFrame({
        "cust_id": [1, 1, 1, 2],
        "car_color": ["Blue", "Red", "Black", "Silver"]
    })

    lookups_all = [{
        "node_id": "cars",
        "left_keys": ["cust_id"],
        "right_keys": ["cust_id"],
        "match_model": "all",
        "join_model": "left_outer"
    }]
    res_all = runner.execute_tmap_transform(main_df, lookups_all, {"cars": lookup_df}, [], [{"name": "out"}])
    # cust 1 tem 3 carros, cust 2 tem 1 -> total 4 linhas
    assert res_all["out"].height == 4

    lookups_first = [{
        "node_id": "cars",
        "left_keys": ["cust_id"],
        "right_keys": ["cust_id"],
        "match_model": "first",
        "join_model": "left_outer"
    }]
    res_first = runner.execute_tmap_transform(main_df, lookups_first, {"cars": lookup_df}, [], [{"name": "out"}])
    # First match pega o primeiro carro inserido (Blue)
    assert res_first["out"].height == 2
    assert res_first["out"].filter(pl.col("cust_id") == 1)["car_color"][0] == "Blue"

    lookups_unique = [{
        "node_id": "cars",
        "left_keys": ["cust_id"],
        "right_keys": ["cust_id"],
        "match_model": "unique",
        "join_model": "left_outer"
    }]
    res_unique = runner.execute_tmap_transform(main_df, lookups_unique, {"cars": lookup_df}, [], [{"name": "out"}])
    # Unique match no Talend pega o último registro (Black)
    assert res_unique["out"].height == 2
    assert res_unique["out"].filter(pl.col("cust_id") == 1)["car_color"][0] == "Black"


def test_tmap_inner_join_and_rejections(runner):
    # Cenário dos PDFs do Talend (Owners, Cars, Resellers)
    owners_df = pl.DataFrame({
        "ID_Owner": [1, 2, 3, 4, 5],
        "Name": ["Alice", "Bob", "Charlie", "David", "Eve"],
        "Children_Nr": [3, 1, 4, 0, 5]
    })
    cars_df = pl.DataFrame({
        "ID_Owner": [1, 1, 3, 4, 99],
        "Make": ["BMW", "BMW", "Audi", "BMW", "Ford"],
        "Color": ["Blue", "Black", "Red", "Silver", "Green"],
        "ID_Reseller": [10, 10, 20, 30, 99]
    })
    resellers_df = pl.DataFrame({
        "ID_Reseller": [10, 20, 30],
        "Name_Reseller": ["AutoBMW", "AudiPrime", "CityMotors"]
    })

    lookups = [
        {
            "node_id": "cars",
            "left_keys": ["ID_Owner"],
            "right_keys": ["ID_Owner"],
            "join_model": "inner",
            "match_model": "all",
            "lookup_filter": "Make = 'BMW'"
        },
        {
            "node_id": "resellers",
            "left_keys": ["ID_Reseller"],
            "right_keys": ["ID_Reseller"],
            "join_model": "inner",
            "match_model": "all"
        }
    ]

    variables = [
        {"name": "Summary", "expression": "Name || ' (' || CAST(Children_Nr AS VARCHAR) || ' kids)'"}
    ]

    outputs = [
        {
            "name": "Main_Output",
            "filter_expression": "Children_Nr >= 2 AND Children_Nr <= 6",
            "columns": [
                {"name": "ID_Owner", "expression": "ID_Owner"},
                {"name": "Name", "expression": "Name"},
                {"name": "Make", "expression": "Make"},
                {"name": "Name_Reseller", "expression": "Name_Reseller"},
                {"name": "Summary", "expression": "Var.Summary"}
            ]
        },
        {
            "name": "Inner_Reject",
            "catch_inner_join_reject": True,
            "columns": [
                {"name": "ID_Owner", "expression": "ID_Owner"},
                {"name": "Name", "expression": "Name"}
            ]
        },
        {
            "name": "Output_Reject",
            "catch_output_reject": True,
            "columns": [
                {"name": "ID_Owner", "expression": "ID_Owner"},
                {"name": "Name", "expression": "Name"},
                {"name": "Make", "expression": "Make"}
            ]
        }
    ]

    res = runner.execute_tmap_transform(
        main_df=owners_df,
        lookups=lookups,
        lookup_dfs={"cars": cars_df, "resellers": resellers_df},
        variables=variables,
        outputs=outputs
    )

    main_out = res["Main_Output"]
    inner_reject = res["Inner_Reject"]
    output_reject = res["Output_Reject"]

    # 1. Main Output: Alice (2 carros BMW, 3 filhos) -> 2 linhas
    assert main_out.height == 2
    assert set(main_out["Name"].to_list()) == {"Alice"}
    assert main_out["Summary"][0] == "Alice (3 kids)"

    # 2. Inner Reject: Bob (sem carro), Charlie (Audi, não BMW), Eve (sem carro) -> 3 linhas
    assert inner_reject.height == 3
    assert set(inner_reject["Name"].to_list()) == {"Bob", "Charlie", "Eve"}

    # 3. Output Reject: David (tem BMW, mas 0 filhos < 2) -> 1 linha
    assert output_reject.height == 1
    assert output_reject["Name"][0] == "David"
    assert output_reject["Make"][0] == "BMW"
