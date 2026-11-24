import polars as pl
import pytest
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner():
    r = DuckDBRunner()
    yield r
    r.close()


def test_tmap_lookup_without_key_raises_error(runner):
    """Lookup sem chaves de junção e sem allow_cross_join lança DomainValidationError com ERR_TMAP_LOOKUP_WITHOUT_KEY."""
    main_df = pl.DataFrame({"id": [1, 2, 3], "name": ["A", "B", "C"]})
    lk_df = pl.DataFrame({"id": [1, 2], "desc": ["X", "Y"]})

    lookups = [{
        "node_id": "lkp_node_1",
        "alias": "lkp1",
        "label": "Oracle - O02 - val_01",
        "join_keys": [{"expr_key": "", "column": ""}],
        "left_keys": [],
        "right_keys": [],
        "allow_cross_join": False,
    }]

    outputs = [{
        "name": "out1",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "name", "expression": "main.name"},
        ]
    }]

    with pytest.raises(DomainValidationError) as excinfo:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=lookups,
            lookup_dfs={"lkp_node_1": lk_df},
            variables=[],
            outputs=outputs,
        )

    assert excinfo.value.code == "ERR_TMAP_LOOKUP_WITHOUT_KEY"
    assert "O lookup 'lkp1' (Oracle - O02 - val_01) não tem chave de junção" in str(excinfo.value.message)


def test_tmap_lookup_allow_cross_join(runner):
    """Lookup sem chaves mas com allow_cross_join=True produz produto cartesiano sem erro."""
    main_df = pl.DataFrame({"id": [1, 2, 3], "name": ["A", "B", "C"]})
    lk_df = pl.DataFrame({"tag": ["X", "Y"]})

    lookups = [{
        "node_id": "lkp_node_1",
        "alias": "lkp1",
        "allow_cross_join": True,
        "join_keys": [],
        "left_keys": [],
        "right_keys": [],
    }]

    outputs = [{
        "name": "out1",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "tag", "expression": "lkp1.tag"},
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"lkp_node_1": lk_df},
        variables=[],
        outputs=outputs,
    )

    out = res["out1"]
    # 3 linhas do main x 2 linhas do lookup = 6 linhas
    assert out.height == 6


def test_tmap_match_models_and_multiplication_warning(runner):
    """
    Com 3 linhas no main e lookup com chave repetida:
    - 'all' devolve 4 linhas e emite warning com contagens
    - 'unique' devolve a última (3 linhas)
    - 'first' devolve a primeira (3 linhas)
    """
    main_df = pl.DataFrame({"id": [1, 2, 3], "main_val": ["m1", "m2", "m3"]})
    # id=1 tem 2 registros no lookup (primeiro 'first_1', segundo 'last_1')
    lk_df = pl.DataFrame({
        "lk_id": [1, 1, 2, 3],
        "val": ["first_1", "last_1", "val_2", "val_3"]
    })

    outputs = [{
        "name": "out1",
        "columns": [
            {"name": "id", "expression": "main.id"},
            {"name": "val", "expression": "lkp1.val"},
        ]
    }]

    # 1. Match model ALL
    warnings_captured = []
    res_all = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lkp_node_1",
            "alias": "lkp1",
            "match_model": "all",
            "join_keys": [{"expr_key": "main.id", "column": "lk_id"}],
        }],
        lookup_dfs={"lkp_node_1": lk_df},
        variables=[],
        outputs=outputs,
        warning_fn=lambda lvl, msg: warnings_captured.append((lvl, msg)),
    )
    assert res_all["out1"].height == 4
    assert len(warnings_captured) == 1
    lvl, msg = warnings_captured[0]
    assert lvl == "WARN"
    assert "lkp1 (all matches): 3 linhas do main viraram 4 (1 linhas extras por chaves repetidas no lookup)" in msg

    # 2. Match model UNIQUE (devolve a última linha)
    res_unique = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lkp_node_1",
            "alias": "lkp1",
            "match_model": "unique",
            "join_keys": [{"expr_key": "main.id", "column": "lk_id"}],
        }],
        lookup_dfs={"lkp_node_1": lk_df},
        variables=[],
        outputs=outputs,
    )
    df_u = res_unique["out1"]
    assert df_u.height == 3
    # id=1 deve ter casado com a última ocorrência 'last_1'
    row_1_u = df_u.filter(pl.col("id") == 1)["val"].to_list()[0]
    assert row_1_u == "last_1"

    # 3. Match model FIRST (devolve a primeira linha)
    res_first = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[{
            "node_id": "lkp_node_1",
            "alias": "lkp1",
            "match_model": "first",
            "join_keys": [{"expr_key": "main.id", "column": "lk_id"}],
        }],
        lookup_dfs={"lkp_node_1": lk_df},
        variables=[],
        outputs=outputs,
    )
    df_f = res_first["out1"]
    assert df_f.height == 3
    # id=1 deve ter casado com a primeira ocorrência 'first_1'
    row_1_f = df_f.filter(pl.col("id") == 1)["val"].to_list()[0]
    assert row_1_f == "first_1"
