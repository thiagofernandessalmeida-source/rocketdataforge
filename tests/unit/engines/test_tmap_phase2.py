"""Testes da FASE 2: Alias e Condicional no tMap (duckdb_runner).

Valida:
2.1 Alias explícito vence; nomes posicionais apenas como fallback; erro em alias duplicado.
2.2 Expressão com alias inexistente falha com mensagem clara listando aliases disponíveis.
2.3 Cast das colunas de saída para o tipo declarado com erro explícito.
2.4 Colunas de saída duplicadas geram erro de validação (sem fusão silenciosa).
2.6 Expressão ternária com null: lkp1.cd_pessoa == null ? 0 : 1.
"""

import polars as pl
import pytest
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner():
    r = DuckDBRunner()
    yield r
    r.close()


def test_tmap_conditional_null_ternary_expression(runner):
    """2.6: lkp1.cd_pessoa == null? 0:1 com lookup que casa (resultado 1) e sem correspondência (resultado 0)."""
    # Main com duas pessoas: ID 10 e ID 20
    main_df = pl.DataFrame({
        "id": [10, 20],
        "nome": ["Alice", "Bob"]
    })

    # Lookup 'lkp1' só tem a pessoa 10
    lkp_df = pl.DataFrame({
        "cd_pessoa": [10],
        "detalhe": ["VIP"]
    })

    lookups = [{
        "node_id": "lkp_node_1",
        "alias": "lkp1",
        "join_type": "left",
        "join_keys": [{"expr_key": "row1.id", "column": "cd_pessoa"}]
    }]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "id", "expression": "row1.id"},
            {
                "name": "is_pessoa_present",
                "expression": "lkp1.cd_pessoa == null ? 0 : 1",
                "type": "Integer"
            }
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"lkp_node_1": lkp_df},
        variables=[],
        outputs=outputs
    )

    out_df = res["out"]
    assert out_df.height == 2
    # Para Alice (id 10), lkp1.cd_pessoa não é nulo => resultado 1
    # Para Bob (id 20), lkp1.cd_pessoa é nulo => resultado 0
    assert out_df["is_pessoa_present"].to_list() == [1, 0]


def test_tmap_two_lookups_with_explicit_aliases(runner):
    """2.1 e 2.6: 2 lookups com aliases explícitos determinísticos."""
    main_df = pl.DataFrame({"user_id": [1, 2]})
    lkp_roles = pl.DataFrame({"user_id": [1, 2], "role": ["admin", "editor"]})
    lkp_perms = pl.DataFrame({"role_name": ["admin"], "perm": ["ALL"]})

    lookups = [
        {
            "node_id": "roles_node",
            "alias": "roles",
            "join_type": "left",
            "join_keys": [{"expr_key": "row1.user_id", "column": "user_id"}]
        },
        {
            "node_id": "perms_node",
            "alias": "perms",
            "join_type": "left",
            "join_keys": [{"expr_key": "roles.role", "column": "role_name"}]
        }
    ]

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "user_id", "expression": "row1.user_id"},
            {"name": "user_role", "expression": "roles.role"},
            {"name": "user_perm", "expression": "perms.perm"}
        ]
    }]

    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=lookups,
        lookup_dfs={"roles_node": lkp_roles, "perms_node": lkp_perms},
        variables=[],
        outputs=outputs
    )

    out_df = res["out"]
    assert out_df.height == 2
    assert out_df["user_role"].to_list() == ["admin", "editor"]
    assert out_df["user_perm"].to_list() == ["ALL", None]


def test_tmap_duplicate_lookup_alias_raises_validation_error(runner):
    """2.1 e 2.6: alias duplicado entre lookups gera ValidationError com os nomes envolvidos."""
    main_df = pl.DataFrame({"id": [1]})
    lkp1 = pl.DataFrame({"id": [1]})
    lkp2 = pl.DataFrame({"id": [1]})

    lookups = [
        {"node_id": "n1", "alias": "lkp_dup", "join_keys": [{"expr_key": "row1.id", "column": "id"}]},
        {"node_id": "n2", "alias": "lkp_dup", "join_keys": [{"expr_key": "row1.id", "column": "id"}]},
    ]

    outputs = [{"name": "out", "columns": [{"name": "id", "expression": "row1.id"}]}]

    with pytest.raises(DomainValidationError) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=lookups,
            lookup_dfs={"n1": lkp1, "n2": lkp2},
            variables=[],
            outputs=outputs
        )

    assert "lkp_dup" in str(exc_info.value)
    assert "duplicado" in str(exc_info.value).lower()


def test_tmap_non_existent_alias_raises_error_with_available_list(runner):
    """2.2 e 2.6: se expressão referencia alias inexistente, falha com lista de aliases disponíveis."""
    main_df = pl.DataFrame({"id": [1]})
    lkp1 = pl.DataFrame({"id": [1], "val": ["A"]})

    lookups = [
        {"node_id": "n1", "alias": "lkp_valido", "join_keys": [{"expr_key": "row1.id", "column": "id"}]}
    ]

    # Expressão usa 'lkp_fantasma.val' que não existe
    outputs = [{
        "name": "out",
        "columns": [
            {"name": "res", "expression": "lkp_fantasma.val"}
        ]
    }]

    with pytest.raises(DomainValidationError) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=lookups,
            lookup_dfs={"n1": lkp1},
            variables=[],
            outputs=outputs
        )

    err = str(exc_info.value)
    assert "lkp_fantasma" in err
    assert "aliases disponíveis" in err.lower() or "disponíveis:" in err.lower()


def test_tmap_output_type_casting_and_error(runner):
    """2.3: Cast das colunas de saída para o tipo declarado; se falhar, erro explícito com coluna e valor."""
    main_df = pl.DataFrame({
        "str_num": ["10", "20"],
        "invalid_num": ["10", "nao_sou_numero"]
    })

    # Cast com sucesso
    outputs_valid = [{
        "name": "out",
        "columns": [
            {"name": "num", "expression": "row1.str_num", "type": "Integer"}
        ]
    }]
    res = runner.execute_tmap_transform(
        main_df=main_df,
        lookups=[],
        lookup_dfs={},
        variables=[],
        outputs=outputs_valid
    )
    assert res["out"]["num"].dtype == pl.Int32

    # Cast com falha
    outputs_invalid = [{
        "name": "out",
        "columns": [
            {"name": "bad_col", "expression": "row1.invalid_num", "type": "Integer"}
        ]
    }]
    with pytest.raises(Exception) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=[],
            lookup_dfs={},
            variables=[],
            outputs=outputs_invalid
        )
    err = str(exc_info.value)
    assert "bad_col" in err or "Integer" in err


def test_tmap_duplicate_output_columns_raises_validation_error(runner):
    """2.4: Colunas de saída duplicadas geram erro de validação (sem fusão automática com coalesce)."""
    main_df = pl.DataFrame({"id": [1], "name": ["Alpha"]})

    outputs = [{
        "name": "out",
        "columns": [
            {"name": "dup_col", "expression": "row1.id"},
            {"name": "dup_col", "expression": "row1.name"}
        ]
    }]

    with pytest.raises(DomainValidationError) as exc_info:
        runner.execute_tmap_transform(
            main_df=main_df,
            lookups=[],
            lookup_dfs={},
            variables=[],
            outputs=outputs
        )

    assert "dup_col" in str(exc_info.value)
    assert "duplicada" in str(exc_info.value).lower()
