"""Testes unitários para Regras de Mascaramento de Dados / LGPD (Fase 2 - Spec 006).

Cobre:
1. MASK_HASH: SHA-256 com salt configurável e determinístico.
2. MASK_EMAIL: Anonimização de endereço mantendo inicial e domínio (ex: j***@domain.com).
3. MASK_CPF_CNPJ: Ofuscação dos blocos intermediários de CPF e CNPJ.
4. MASK_NULL: Redação total para nulo.
5. MASK_REDACT / NOISE: Substituição por ruído ou valor fixo mascarado.
6. Geração de expressões SQL escalares para DuckDB.
7. Aplicação de regras em lote sobre Polars DataFrames.
"""

import duckdb
import polars as pl
import pytest

from src.core.application.security.masking import (
    DataMasker,
    MaskingRule,
    MaskingType,
    get_sql_masking_expression,
    mask_value,
)


# ============================================================================
# 1. TESTES DE MASK_HASH (SHA-256)
# ============================================================================

def test_mask_hash_sha256_with_salt():
    """Valida hashing SHA-256 com salt secreto."""
    rule_salt1 = MaskingRule(column_name="doc_id", masking_type=MaskingType.HASH, salt="salt_alpha")
    rule_salt2 = MaskingRule(column_name="doc_id", masking_type=MaskingType.HASH, salt="salt_beta")

    val = "123456789"
    h1 = mask_value(val, rule_salt1)
    h2 = mask_value(val, rule_salt2)

    # 64 caracteres hexadecimais para SHA-256
    assert len(h1) == 64
    assert len(h2) == 64
    # Determinístico para mesmo salt
    assert h1 == mask_value(val, rule_salt1)
    # Salts distintos produzem hashes distintos
    assert h1 != h2


def test_mask_hash_null_returns_null():
    """Valores nulos devem permanecer nulos após hashing."""
    rule = MaskingRule(column_name="token", masking_type=MaskingType.HASH)
    assert mask_value(None, rule) is None


# ============================================================================
# 2. TESTES DE MASK_EMAIL
# ============================================================================

def test_mask_email_preserves_initial_and_domain():
    """Valida ofuscação padrão de e-mail (j***@domain.com)."""
    rule = MaskingRule(column_name="email", masking_type=MaskingType.EMAIL)

    assert mask_value("john.doe@empresa.com", rule) == "j***@empresa.com"
    assert mask_value("roberta_silva+work@sub.dominio.org", rule) == "r***@sub.dominio.org"
    assert mask_value("a@teste.com", rule) == "a***@teste.com"


def test_mask_email_invalid_and_null():
    """Tratamento de nulos e strings que não são e-mail válido."""
    rule = MaskingRule(column_name="email", masking_type=MaskingType.EMAIL)

    assert mask_value(None, rule) is None
    # String sem '@' deve ser ofuscada integralmente
    assert mask_value("not_an_email", rule) == "***"


# ============================================================================
# 3. TESTES DE MASK_CPF_CNPJ
# ============================================================================

def test_mask_cpf_formatted_and_unformatted():
    """Ofuscação dos blocos intermediários de CPF (123.***.***-00)."""
    rule = MaskingRule(column_name="cpf", masking_type=MaskingType.CPF_CNPJ)

    # CPF formatado
    assert mask_value("123.456.789-00", rule) == "123.***.***-00"
    # CPF apenas dígitos
    assert mask_value("12345678900", rule) == "123.***.***-00"


def test_mask_cnpj_formatted_and_unformatted():
    """Ofuscação de CNPJ preservando raiz e dígito final."""
    rule = MaskingRule(column_name="cnpj", masking_type=MaskingType.CPF_CNPJ)

    # CNPJ formatado
    assert mask_value("12.345.678/0001-90", rule) == "12.***.***/****-90"
    # CNPJ apenas dígitos
    assert mask_value("12345678000190", rule) == "12.***.***/****-90"


def test_mask_cpf_cnpj_null():
    """Nulo preservado."""
    rule = MaskingRule(column_name="doc", masking_type=MaskingType.CPF_CNPJ)
    assert mask_value(None, rule) is None


# ============================================================================
# 4. TESTES DE MASK_NULL E MASK_REDACT
# ============================================================================

def test_mask_null():
    """Substituição incondicional por nulo."""
    rule = MaskingRule(column_name="salary", masking_type=MaskingType.NULL)
    assert mask_value(15000.50, rule) is None
    assert mask_value("secreto", rule) is None


def test_mask_redact_noise():
    """Substituição por valor fixo de redação / ruído."""
    rule = MaskingRule(column_name="notes", masking_type=MaskingType.REDACT)
    assert mask_value("dados confidenciais de clientes", rule) == "[REDACTED]"


# ============================================================================
# 5. TESTES DE GERAÇÃO SQL DUCKDB
# ============================================================================

def test_duckdb_sql_masking_execution():
    """Gera expressões SQL nativas e valida execução direta no DuckDB."""
    rules = [
        MaskingRule("user_email", MaskingType.EMAIL),
        MaskingRule("user_cpf", MaskingType.CPF_CNPJ),
        MaskingRule("user_token", MaskingType.HASH, salt="top_secret_salt"),
        MaskingRule("sensitive_col", MaskingType.NULL),
        MaskingRule("comment", MaskingType.REDACT),
    ]

    # Cria tabela de teste no DuckDB
    con = duckdb.connect(":memory:")
    con.execute("""
        CREATE TABLE raw_users AS SELECT
            'alice.wonderland@example.com' AS user_email,
            '123.456.789-00' AS user_cpf,
            'token_xyz_123' AS user_token,
            'keep_secret' AS sensitive_col,
            'public comment' AS comment
        UNION ALL SELECT
            NULL, NULL, NULL, NULL, NULL;
    """)

    select_items = [
        f"{get_sql_masking_expression(r.column_name, r)} AS \"{r.column_name}\""
        for r in rules
    ]
    query = f"SELECT {', '.join(select_items)} FROM raw_users;"

    df_res = con.execute(query).pl()

    # Linha 1 (não nula)
    row0 = df_res.to_dicts()[0]
    assert row0["user_email"] == "a***@example.com"
    assert row0["user_cpf"] == "123.***.***-00"
    assert len(row0["user_token"]) == 64  # SHA-256
    assert row0["sensitive_col"] is None
    assert row0["comment"] == "[REDACTED]"

    # Linha 2 (nula)
    row1 = df_res.to_dicts()[1]
    assert row1["user_email"] is None
    assert row1["user_cpf"] is None
    assert row1["user_token"] is None
    assert row1["sensitive_col"] is None
    assert row1["comment"] is None

    con.close()


# ============================================================================
# 6. TESTE DE APLICAÇÃO EM POLARS DATAFRAME
# ============================================================================

def test_data_masker_apply_dataframe():
    """Valida aplicação em lote sobre DataFrame Polars."""
    df = pl.DataFrame({
        "id": [1, 2],
        "email": ["carlos@natura.net", "marina@natura.net"],
        "cpf": ["98765432100", "11122233344"],
        "score": [100, 200]
    })

    rules = [
        MaskingRule("email", MaskingType.EMAIL),
        MaskingRule("cpf", MaskingType.CPF_CNPJ),
    ]

    masked_df = DataMasker.apply_masking(df, rules)

    assert masked_df["email"][0] == "c***@natura.net"
    assert masked_df["email"][1] == "m***@natura.net"
    assert masked_df["cpf"][0] == "987.***.***-00"
    assert masked_df["cpf"][1] == "111.***.***-44"
    # Coluna não mascarada permanece intocada
    assert masked_df["score"].to_list() == [100, 200]


# ============================================================================
# 7. TESTE DE INTEGRAÇÃO COM LOGICAL_PLANNER E EXECUÇÃO
# ============================================================================

def test_logical_planner_extracts_and_injects_masking():
    """Valida que o LogicalPlanner extrai regras de schema e injeta no operador."""
    from src.core.application.compiler.logical_planner import LogicalPlanner
    from src.core.application.compiler.validator import GraphValidator
    from src.core.domain.pipeline.draft import PipelineDraft
    from src.core.domain.shared.types import SemanticVersion

    draft = PipelineDraft(id="mask_pipe", project_id="proj", name="Masking Plan")
    draft.add_node(
        node_id="src_users",
        component_type="core.file.source",
        component_version=SemanticVersion(1, 0, 0),
        config={
            "path": "users.csv",
            "schema": [
                {"name": "id", "type": "Integer"},
                {"name": "email", "type": "String", "masking": "MASK_EMAIL"},
                {"name": "cpf", "type": "String", "masking": "MASK_CPF_CNPJ"},
                {"name": "secret_token", "type": "String", "masking": "MASK_HASH", "masking_salt": "salt123"}
            ]
        }
    )

    report = GraphValidator().validate(draft)
    assert report.is_valid

    plan = LogicalPlanner().compile(draft, report)
    op = plan.operators["src_users"]

    rules = op.config.get("masking_rules", [])
    assert len(rules) == 3
    rule_map = {r["column_name"]: r["masking_type"] for r in rules}
    assert rule_map["email"] == "MASK_EMAIL"
    assert rule_map["cpf"] == "MASK_CPF_CNPJ"
    assert rule_map["secret_token"] == "MASK_HASH"


def test_pipeline_execution_applies_masking_end_to_end(tmp_path):
    """Execução end-to-end deve salvar os dados e prévia mascarados."""
    import time
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    csv_file = tmp_path / "sensitive_users.csv"
    pl.DataFrame({
        "id": [1, 2],
        "full_name": ["Alice Smith", "Bob Jones"],
        "email": ["alice.smith@secure.com", "bob.jones@secure.com"],
        "cpf": ["12345678901", "98765432109"],
    }).write_csv(csv_file)

    out_file = tmp_path / "masked_users.parquet"

    draft_def = {
        "metadata": {"name": "mask_exec_pipe"},
        "spec": {
            "nodes": [
                {
                    "id": "src_csv",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {
                        "path": str(csv_file),
                        "format": "csv",
                        "table": "src_users",
                        "schema": [
                            {"name": "id", "type": "Integer"},
                            {"name": "full_name", "type": "String"},
                            {"name": "email", "type": "String", "masking": "MASK_EMAIL"},
                            {"name": "cpf", "type": "String", "masking": "MASK_CPF_CNPJ"}
                        ]
                    }
                },
                {
                    "id": "sink_masked",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {"path": str(out_file), "format": "parquet"}
                }
            ],
            "edges": [
                {"from": "src_csv.output", "to": "sink_masked.input"}
            ]
        }
    }

    res_exec = client.post("/api/v1/executions/partial", json={
        "target_node_id": "sink_masked",
        "draft_definition": draft_def
    })
    assert res_exec.status_code == 202
    exec_id = res_exec.json()["execution_id"]

    for _ in range(20):
        time.sleep(0.1)
        res_status = client.get(f"/api/v1/executions/{exec_id}")
        if res_status.status_code == 200 and res_status.json()["status"] in {"succeeded", "failed"}:
            break

    assert out_file.exists()
    df_out = pl.read_parquet(out_file)

    assert df_out["email"][0] == "a***@secure.com"
    assert df_out["email"][1] == "b***@secure.com"
    assert df_out["cpf"][0] == "123.***.***-01"
    assert df_out["cpf"][1] == "987.***.***-09"
    assert df_out["full_name"][0] == "Alice Smith"


# ============================================================================
# 8. TESTES DE CATÁLOGO E FORMATOS DE CONFIGURAÇÃO
# ============================================================================

def test_masking_catalog_completeness():
    """Valida completude e metadados do catálogo de mascaramento."""
    from src.core.application.security.masking import MASKING_CATALOG

    expected_keys = ["MASK_HASH", "MASK_EMAIL", "MASK_CPF_CNPJ", "MASK_NULL", "MASK_REDACT"]
    for key in expected_keys:
        assert key in MASKING_CATALOG
        assert "label" in MASKING_CATALOG[key]
        assert "description" in MASKING_CATALOG[key]
        assert "example" in MASKING_CATALOG[key]
        assert isinstance(MASKING_CATALOG[key]["has_salt"], bool)


def test_extract_masking_rules_from_various_formats():
    """Valida extração resiliente de regras a partir de formatos heterogêneos."""
    from src.core.application.security.masking import extract_masking_rules

    # Formato 1: lista em 'masking_rules'
    cfg1 = {
        "masking_rules": [
            {"column_name": "c1", "masking_type": "MASK_HASH", "salt": "s1"},
            {"name": "c2", "type": "MASK_EMAIL"}
        ]
    }
    res1 = extract_masking_rules(cfg1)
    assert len(res1) == 2
    assert res1[0]["column_name"] == "c1"
    assert res1[0]["masking_type"] == "MASK_HASH"
    assert res1[0]["salt"] == "s1"
    assert res1[1]["column_name"] == "c2"

    # Formato 2: lista de schema definitions
    cfg2 = {
        "schema_definitions": [
            {"name": "doc", "type": "String", "masking": "MASK_CPF_CNPJ"},
            {"name": "norm", "type": "String"}  # sem masking
        ]
    }
    res2 = extract_masking_rules(cfg2)
    assert len(res2) == 1
    assert res2[0]["column_name"] == "doc"
    assert res2[0]["masking_type"] == "MASK_CPF_CNPJ"

    # Formato 3: mapa chave-valor em 'pii_mask'
    cfg3 = {
        "pii_mask": {"usr_mail": "MASK_EMAIL", "usr_id": "NONE"},
        "masking_salt": "secret"
    }
    res3 = extract_masking_rules(cfg3)
    assert len(res3) == 1
    assert res3[0]["column_name"] == "usr_mail"
    assert res3[0]["salt"] == "secret"


def test_sql_projection_builder_and_escaping():
    """Valida geração segura de projeção SQL com escape de aspas."""
    from src.core.application.security.masking import build_masked_projection_sql, MaskingRule, MaskingType

    rules = [
        MaskingRule("user\"name", MaskingType.REDACT, custom_value="ANON"),
        MaskingRule("email", MaskingType.EMAIL)
    ]
    columns = ["id", "user\"name", "email"]
    sql_proj = build_masked_projection_sql(columns, rules)

    assert '"id"' in sql_proj
    assert '"user""name"' in sql_proj
    assert "'ANON'" in sql_proj
    assert "split_part" in sql_proj

