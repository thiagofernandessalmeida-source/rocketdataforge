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


def test_tmap_parity_case_insensitive_postgres_oracle_aliases(runner):
    """Cenário 1: Teste de Paridade de Colunas (Case-Insensitive & Aliases).

    Validação:
    - O fluxo principal (main1) vem do Postgres com colunas em minúsculo (person_code, email_address).
    - O lookup (lkp1) vem do Oracle com colunas em maiúsculo (PERSON_CODE, REGISTRATION_DATE, STATUS).
    - O tMap deve compilar o SQL no DuckDB mapeando corretamente as chaves sem Binder Error.
    """
    main_df = pl.DataFrame({
        "person_code": ["P001", "P002", "P003"],
        "email_address": ["alice@corp.com", "bob@corp.com", "charlie@corp.com"]
    })
    oracle_df = pl.DataFrame({
        "PERSON_CODE": ["P001", "P002", "P004"],
        "REGISTRATION_DATE": ["2023-01-15", "2023-02-20", "2023-03-25"],
        "STATUS": ["ACTIVE", "PENDING", "EXPIRED"]
    })

    lookups = [{
        "node_id": "oracle_source_1",
        "alias": "lkp1",
        "join_keys": [{"expr_key": "main1.person_code", "column": "lkp1.PERSON_CODE"}],
        "join_model": "left_outer",
        "match_model": "all"
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"target": "person_code", "expression": "main1.person_code"},
            {"target": "email", "expression": "main1.email_address"},
            {"target": "status", "expression": "lkp1.status"},
            {"target": "reg_date", "expression": "lkp1.REGISTRATION_DATE"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"oracle_source_1": oracle_df},
        variables=[],
        outputs=outputs,
        main_alias="main1"
    )

    out = res["out"]
    assert out.height == 3
    assert out["person_code"].to_list() == ["P001", "P002", "P003"]
    assert out["status"].to_list() == ["ACTIVE", "PENDING", None]
    assert out["reg_date"].to_list() == ["2023-01-15", "2023-02-20", None]


def test_tmap_match_models_all_first_unique_multi_row(runner):
    """Cenário 2: Teste de Match Models (Unique vs First vs All).

    Validação:
    - Dataset de lookup com múltiplas linhas para a mesma chave com valores sequenciais.
    - Modo First traz a primeira linha inserida.
    - Modo Unique traz a última ocorrência (equivalente ao Last Match do Talend).
    - Modo All multiplica as linhas (cardinalidade 1:N).
    """
    main_df = pl.DataFrame({"key": [10]})
    lookup_multi_df = pl.DataFrame({
        "key": [10, 10, 10],
        "version": ["v1", "v2", "v3"],
        "score": [100, 200, 300]
    })

    outputs = [{
        "name": "out",
        "columns": [
            {"target": "key", "expression": "main1.key"},
            {"target": "version", "expression": "lkp1.version"},
            {"target": "score", "expression": "lkp1.score"}
        ]
    }]

    # 1. All Matches -> 3 linhas
    res_all = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lookup_1",
            "alias": "lkp1",
            "join_keys": [{"expr_key": "main1.key", "column": "lkp1.key"}],
            "join_model": "left_outer",
            "match_model": "all"
        }],
        lookup_dfs={"lookup_1": lookup_multi_df},
        variables=[],
        outputs=outputs,
        main_alias="main1"
    )
    assert res_all["out"].height == 3
    assert res_all["out"]["version"].to_list() == ["v1", "v2", "v3"]

    # 2. First Match -> 1 linha (v1)
    res_first = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lookup_1",
            "alias": "lkp1",
            "join_keys": [{"expr_key": "main1.key", "column": "lkp1.key"}],
            "join_model": "left_outer",
            "match_model": "first"
        }],
        lookup_dfs={"lookup_1": lookup_multi_df},
        variables=[],
        outputs=outputs,
        main_alias="main1"
    )
    assert res_first["out"].height == 1
    assert res_first["out"]["version"][0] == "v1"
    assert res_first["out"]["score"][0] == 100

    # 3. Unique Match (Talend Last Match) -> 1 linha (v3)
    res_unique = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lookup_1",
            "alias": "lkp1",
            "join_keys": [{"expr_key": "main1.key", "column": "lkp1.key"}],
            "join_model": "left_outer",
            "match_model": "unique"
        }],
        lookup_dfs={"lookup_1": lookup_multi_df},
        variables=[],
        outputs=outputs,
        main_alias="main1"
    )
    assert res_unique["out"].height == 1
    assert res_unique["out"]["version"][0] == "v3"
    assert res_unique["out"]["score"][0] == 300


def test_tmap_inner_join_reject_routing(runner):
    """Cenário 3: Teste de Rejects (Inner Join Reject & Output Reject).

    Validação:
    - Lookup com join_model=inner onde parte das chaves da principal não existe no lookup.
    - Linhas coincidentes vão para a saída principal.
    - Linhas rejeitadas pelo inner join vão para a saída catch_inner_join_reject.
    """
    main_df = pl.DataFrame({
        "id": [1, 2, 3, 4],
        "name": ["A", "B", "C", "D"]
    })
    lookup_df = pl.DataFrame({
        "id": [2, 3],
        "category": ["Cat2", "Cat3"]
    })

    lookups = [{
        "node_id": "lkp_node",
        "alias": "lkp1",
        "join_keys": [{"expr_key": "main1.id", "column": "lkp1.id"}],
        "join_model": "inner",
        "match_model": "unique"
    }]

    outputs = [
        {
            "name": "main_matched",
            "catch_inner_join_reject": False,
            "catch_output_reject": False,
            "columns": [
                {"target": "id", "expression": "main1.id"},
                {"target": "name", "expression": "main1.name"},
                {"target": "category", "expression": "lkp1.category"}
            ]
        },
        {
            "name": "reject_inner",
            "catch_inner_join_reject": True,
            "catch_output_reject": False,
            "columns": [
                {"target": "id", "expression": "main1.id"},
                {"target": "name", "expression": "main1.name"}
            ]
        }
    ]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"lkp_node": lookup_df},
        variables=[],
        outputs=outputs,
        main_alias="main1"
    )

    matched = res["main_matched"]
    rejected = res["reject_inner"]

    assert matched.height == 2
    assert set(matched["id"].to_list()) == {2, 3}
    assert set(matched["category"].to_list()) == {"Cat2", "Cat3"}

    assert rejected.height == 2
    assert set(rejected["id"].to_list()) == {1, 4}
    assert set(rejected["name"].to_list()) == {"A", "D"}


def test_tmap_ghost_variable_elimination_and_duplicate_target_prevention(runner):
    """Cenário 4: Teste de Limpeza de Variáveis e Prevenção de Colunas Duplicadas.

    Validação:
    - O job contém uma variável fantasma (var_ghost = row1.NonExistentField).
    - O job contém uma variável ativa (var_active = main1.val * 2).
    - O motor deve ignorar a variável fantasma sem interromper a execução.
    - A saída contém duas colunas com o mesmo target ('val' de main1 e 'val' de lkp1), que devem ser unificadas via COALESCE sem colisão.
    """
    main_df = pl.DataFrame({
        "id": [1, 2],
        "val": [10, 20]
    })
    lookup_df = pl.DataFrame({
        "id": [1, 2],
        "val": [100, 200]
    })

    variables = [
        {"name": "var_ghost", "expression": "row1.NonExistentField", "type": "String"},
        {"name": "var_active", "expression": "main1.val * 2", "type": "Integer"}
    ]

    outputs = [{
        "name": "clean_out",
        "columns": [
            {"target": "val", "expression": "lkp1.val"},
            {"target": "val", "expression": "main1.val"},
            {"target": "doubled", "expression": "Var.var_active"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lookup_1",
            "alias": "lkp1",
            "join_keys": [{"expr_key": "main1.id", "column": "lkp1.id"}],
            "join_model": "left_outer",
            "match_model": "unique"
        }],
        lookup_dfs={"lookup_1": lookup_df},
        variables=variables,
        outputs=outputs,
        main_alias="main1"
    )

    clean_out = res["clean_out"]
    assert clean_out.height == 2
    # Confirma deduplicação no schema final
    assert clean_out.columns == ["val", "doubled"]
    assert clean_out["val"].to_list() == [100, 200]
    assert clean_out["doubled"].to_list() == [20, 40]

