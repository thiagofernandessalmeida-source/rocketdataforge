"""Testes Unitários para o Motor de Execução tMap.

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
    # Unique match pega o último registro (Black)
    assert res_unique["out"].height == 2
    assert res_unique["out"].filter(pl.col("cust_id") == 1)["car_color"][0] == "Black"


def test_tmap_qualified_right_keys_and_tokens(runner):
    """Testa que chaves com prefixo (ex: lkp1.person_code ou {{lkp1.person_code}}) não quebram o DuckDB Binder."""
    main_df = pl.DataFrame({"cust_id": [1, 2]})
    lookup_df = pl.DataFrame({
        "cust_id": [1, 1, 2],
        "person_code": ["P001", "P002", "P003"]
    })

    lookups = [{
        "node_id": "postgres_source_2",
        "alias": "lkp1",
        "left_keys": ["{{postgres_source_1.cust_id}}"],
        "right_keys": ["lkp1.cust_id"],
        "match_model": "unique",
        "join_model": "left_outer"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "code", "expression": "{{postgres_source_2.person_code}}"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"postgres_source_2": lookup_df},
        variables=[],
        outputs=outputs,
        main_node_id="postgres_source_1"
    )

    assert res["out"].height == 2
    assert res["out"]["code"].to_list() == ["P002", "P003"]


def test_tmap_inner_join_and_rejections(runner):
    # Cenário de referência (Owners, Cars, Resellers)
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


def test_tmap_columns_with_spaces_and_special_names(runner):
    main_df = pl.DataFrame({
        "Release_Date": ["2020-01-01"],
        "Movie Title": ["Inception"],
        "Working URL": ["https://example.com/movie"]
    })

    outputs = [{
        "name": "out1",
        "columns": [
            {"target": "Release_Date", "expression": "row1.Release_Date"},
            {"target": "Movie Title", "expression": "row1.Movie Title"},
            {"target": "Working URL", "expression": "row1.Working URL"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[],
        lookup_dfs={},
        variables=[],
        outputs=outputs
    )

    out_df = res["out1"]
    assert out_df.height == 1
    assert out_df["Working URL"][0] == "https://example.com/movie"
    assert out_df["Movie Title"][0] == "Inception"
    assert out_df["Release_Date"][0] == "2020-01-01"


def test_tmap_exact_user_scenario_main1_and_lkp1_case_insensitive_and_coalesce_dedup(runner):
    """Cenário exato do diagnóstico: main1 vindo do Postgres (lowercase person_code),

    lkp1 vindo do Oracle (UPPERCASE PERSON_CODE), join_model inner,
    variável fantasma row1.Title descartada por dead-variable elimination,
    e duas colunas mapeadas para o mesmo target 'person_code' unificadas com COALESCE.
    """
    main_df = pl.DataFrame({
        "person_code": ["P001", "P002", "P003"],
        "name": ["Alice", "Bob", "Charlie"]
    })
    # Oracle retorna colunas em UPPERCASE
    oracle_df = pl.DataFrame({
        "PERSON_CODE": ["P001", "P002", "P999"],
        "STATUS": ["ACTIVE", "PENDING", "REVOKED"]
    })

    lookups = [{
        "node_id": "oracle_source_1",
        "alias": "lkp1",
        "join_keys": [{"expr_key": "main1.person_code", "column": "lkp1.person_code"}],
        "join_model": "inner",
        "match_model": "unique"
    }]

    # Variável fantasma vinda do template residual de UI
    variables = [{
        "id": "v1",
        "name": "var1",
        "type": "String",
        "expression": "row1.Title"
    }]

    # Saída com target duplicado "person_code" vindo de lkp1 e main1
    outputs = [{
        "name": "out1",
        "catch_output_reject": False,
        "catch_inner_join_reject": False,
        "columns": [
            {"target": "person_code", "expression": "main1.person_code"},
            {"target": "person_code", "expression": "lkp1.person_code"},
            {"target": "name", "expression": "main1.name"},
            {"target": "status", "expression": "lkp1.STATUS"}
        ]
    }, {
        "name": "reject_inner",
        "catch_inner_join_reject": True,
        "columns": [
            {"target": "person_code", "expression": "main1.person_code"},
            {"target": "name", "expression": "main1.name"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"oracle_source_1": oracle_df},
        variables=variables,
        outputs=outputs,
        main_alias="main1",
        main_node_id="postgres_source_1"
    )

    out1 = res["out1"]
    reject_inner = res["reject_inner"]

    # 1. Deve processar sem erro de Binder ("main1.person_code")
    # 2. P001 e P002 deram match no inner join
    assert out1.height == 2
    assert set(out1["name"].to_list()) == {"Alice", "Bob"}
    # 3. Coluna person_code deve ser desambiguada e única (sem duplicata)
    assert "person_code" in out1.columns
    assert len([c for c in out1.columns if c == "person_code"]) == 1
    assert set(out1["person_code"].to_list()) == {"P001", "P002"}

    # 4. Reject Inner deve capturar P003 (Charlie, que não existe no Oracle)
    assert reject_inner.height == 1
    assert reject_inner["person_code"][0] == "P003"
    assert reject_inner["name"][0] == "Charlie"


def test_tmap_chained_intermediate_variables(runner):
    """Testa variáveis intermediárias encadeadas (var2 usa Var.var1) com cast de tipos."""
    main_df = pl.DataFrame({
        "unit_price": [10.0, 25.0],
        "quantity": [3, 2]
    })

    variables = [
        {"name": "subtotal", "type": "Double", "expression": "main.unit_price * main.quantity"},
        {"name": "tax", "type": "Double", "expression": "Var.subtotal * 0.1"},
        {"name": "total", "type": "Double", "expression": "Var.subtotal + Var.tax"},
        {"name": "formatted", "type": "String", "expression": "'Total: $' || Var.total"}
    ]

    outputs = [{
        "name": "sales_out",
        "columns": [
            {"target": "total_amount", "expression": "Var.total"},
            {"target": "display_text", "expression": "Var.formatted"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[],
        lookup_dfs={},
        variables=variables,
        outputs=outputs,
        main_alias="main"
    )

    sales_df = res["sales_out"]
    assert sales_df.height == 2
    assert sales_df["total_amount"][0] == pytest.approx(33.0)
    assert sales_df["total_amount"][1] == pytest.approx(55.0)
    assert sales_df["display_text"][0] == "Total: $33.0"

