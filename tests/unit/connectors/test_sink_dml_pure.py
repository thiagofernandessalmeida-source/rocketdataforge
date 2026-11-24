"""Testes unitários puros para a lógica DML de conectores de saída (Sinks) estilo tDBOutput.

Testa funções puras sem necessidade de banco de dados ativo:
- Construtores de SQL por dialeto (Postgres, Oracle, DuckDB)
- Resolução de Field Options (Update Key, Deletion Key, Updatable, Insertable)
- Regra 1: Sem chave não grava (ERR_SINK_KEYS_REQUIRED)
- Regra 3: Updatable / Insertable e chave fora do SET
- Regra 4: Chave inexistente na entrada (ERR_SINK_COLUMN_NOT_FOUND)
- Regra 5 e 6: Tratamento de chaves nulas e deduplicação de lotes (última linha vence)
"""

import pytest
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.connectors.sink_dml import (
    SinkFieldOptions,
    SinkWritePlan,
    SinkWriteResult,
    build_duckdb_delete_from_batch_sql,
    build_duckdb_direct_insert_sql,
    build_duckdb_insert_from_batch_sql,
    build_duckdb_update_from_batch_sql,
    build_oracle_delete_sql,
    build_oracle_insert_sql,
    build_oracle_merge_sql,
    build_postgres_delete_from_stage_sql,
    build_postgres_direct_insert_sql,
    build_postgres_insert_from_stage_sql,
    build_postgres_staging_create_sql,
    build_postgres_update_from_stage_sql,
    format_sink_dml_log,
    plan_write,
    prepare_batch_records,
    quote_identifier,
    quote_table_name,
    resolve_sink_field_options,
)


def test_quote_identifier_and_table_name():
    """Garante escape seguro de nomes de colunas e tabelas com e sem schema."""
    assert quote_identifier("col_a") == '"col_a"'
    assert quote_identifier('col"b') == '"col""b"'

    assert quote_table_name("tabela") == '"tabela"'
    assert quote_table_name("public.migra_1_atendentes") == '"public"."migra_1_atendentes"'
    assert quote_table_name('"odsdw"."users"') == '"odsdw"."users"'


def test_resolve_field_options_when_use_field_options_true():
    """Garante resolução granular de chaves e flags com use_field_options."""
    cfg = {
        "use_field_options": True,
        "field_options": [
            {"column": "cd_pessoa", "update_key": True, "deletion_key": True, "updatable": False, "insertable": True},
            {"column": "cpf", "update_key": False, "deletion_key": False, "updatable": False, "insertable": True},
            {"column": "validacao_01", "update_key": False, "deletion_key": False, "updatable": True, "insertable": True},
            {"column": "person_id", "update_key": False, "deletion_key": False, "updatable": True, "insertable": True},
        ]
    }
    df_cols = ["cd_pessoa", "cpf", "validacao_01", "person_id"]
    fo = resolve_sink_field_options(cfg, df_columns=df_cols)

    assert fo.use_field_options is True
    assert fo.update_keys == ["cd_pessoa"]
    assert fo.deletion_keys == ["cd_pessoa"]
    # Regra 3: cd_pessoa é chave, logo fica fora do SET; cpf está updatable=False
    assert fo.updatable_cols == ["validacao_01", "person_id"]
    assert fo.insertable_cols == ["cd_pessoa", "cpf", "validacao_01", "person_id"]


def test_resolve_field_options_legacy_mode_with_keys_and_schema():
    """Garante fallback para config.keys e schema_definitions no modo legado."""
    cfg = {"keys": ["id"]}
    schema_defs = [
        {"name": "id", "type": "Integer", "isPrimaryKey": True},
        {"name": "nome", "type": "String"},
        {"name": "status", "type": "String"}
    ]
    df_cols = ["id", "nome", "status"]
    fo = resolve_sink_field_options(cfg, schema_definitions=schema_defs, df_columns=df_cols)

    assert fo.use_field_options is False
    assert fo.update_keys == ["id"]
    assert fo.deletion_keys == ["id"]
    assert fo.updatable_cols == ["nome", "status"]
    assert fo.insertable_cols == ["id", "nome", "status"]


def test_rule_1_keys_required_prevents_insert_fallback():
    """Regra 1: Update e Delete sem chave devem falhar antes da execução (nunca cair em INSERT)."""
    empty_fo = SinkFieldOptions(use_field_options=False, update_keys=[], deletion_keys=[])

    # Update sem chave deve falhar
    with pytest.raises(DomainValidationError) as exc_upd:
        plan_write("update", empty_fo, component_name="postgres_sink_2")
    assert exc_upd.value.code == "ERR_SINK_KEYS_REQUIRED"
    assert "postgres_sink_2" in str(exc_upd.value)
    assert "Update Key" in str(exc_upd.value)

    # Upsert sem chave deve falhar
    with pytest.raises(DomainValidationError) as exc_ups:
        plan_write("upsert", empty_fo, component_name="postgres_sink_2")
    assert exc_ups.value.code == "ERR_SINK_KEYS_REQUIRED"

    # Delete sem chave deve falhar
    with pytest.raises(DomainValidationError) as exc_del:
        plan_write("delete", empty_fo, component_name="postgres_sink_2")
    assert exc_del.value.code == "ERR_SINK_KEYS_REQUIRED"
    assert "Deletion Key" in str(exc_del.value)


def test_rule_4_missing_key_in_input_raises_error():
    """Regra 4: Chave configurada que não existe no DataFrame de entrada gera erro."""
    cfg = {
        "use_field_options": True,
        "field_options": [
            {"column": "coluna_inexistente", "update_key": True, "updatable": True, "insertable": True}
        ]
    }
    df_cols = ["cd_pessoa", "nome"]
    with pytest.raises(DomainValidationError) as exc:
        resolve_sink_field_options(cfg, df_columns=df_cols)
    assert exc.value.code == "ERR_SINK_COLUMN_NOT_FOUND"
    assert "coluna_inexistente" in str(exc.value)


def test_rule_5_and_6_prepare_batch_records_null_keys_and_deduplication():
    """Regras 5 e 6: Chaves nulas descartadas e duplicados deduplicados com última linha vencendo."""
    cols = ["id", "val"]
    keys = ["id"]
    # 4 linhas: id 1 (primeira), id 2, id 1 (segunda - deve vencer), id None (deve ser descartada)
    records = [
        (1, "v1_original"),
        (2, "v2"),
        (1, "v1_atualizada"),
        (None, "v_nulo")
    ]
    valid_recs, dups, null_keys = prepare_batch_records(records, cols, keys, is_update_or_delete=True)

    assert dups == 1
    assert null_keys == 1
    assert len(valid_recs) == 2
    # Confere que id 1 ficou com "v1_atualizada" (última linha vence)
    rec_map = {r[0]: r[1] for r in valid_recs}
    assert rec_map[1] == "v1_atualizada"
    assert rec_map[2] == "v2"


def test_postgres_sql_generation():
    """Gera e valida SQL do PostgreSQL para staging, update, insert e delete."""
    target = "public.migra_1_atendentes"
    stage = "_rdf_stage_123"
    keys = ["cd_pessoa"]
    updatable = ["validacao_01", "person_id"]
    insertable = ["cd_pessoa", "validacao_01", "person_id"]

    # 1. Staging table create
    create_stage_sql = build_postgres_staging_create_sql(target, stage, insertable)
    assert create_stage_sql == 'CREATE TEMP TABLE _rdf_stage_123 ON COMMIT DROP AS SELECT "cd_pessoa", "validacao_01", "person_id" FROM "public"."migra_1_atendentes" WITH NO DATA;'

    # 2. Update from stage
    upd_sql = build_postgres_update_from_stage_sql(target, stage, keys, updatable)
    assert upd_sql == 'UPDATE "public"."migra_1_atendentes" AS t SET "validacao_01" = s."validacao_01", "person_id" = s."person_id" FROM _rdf_stage_123 AS s WHERE t."cd_pessoa" = s."cd_pessoa";'

    # 3. Insert from stage (Update or Insert)
    ins_stage_sql = build_postgres_insert_from_stage_sql(target, stage, keys, insertable)
    assert 'INSERT INTO "public"."migra_1_atendentes" ("cd_pessoa", "validacao_01", "person_id")' in ins_stage_sql
    assert 'SELECT "cd_pessoa", "validacao_01", "person_id" FROM _rdf_stage_123 AS s' in ins_stage_sql
    assert 'WHERE NOT EXISTS (SELECT 1 FROM "public"."migra_1_atendentes" AS t WHERE t."cd_pessoa" = s."cd_pessoa");' in ins_stage_sql

    # 4. Delete from stage
    del_sql = build_postgres_delete_from_stage_sql(target, stage, keys)
    assert del_sql == 'DELETE FROM "public"."migra_1_atendentes" AS t USING _rdf_stage_123 AS s WHERE t."cd_pessoa" = s."cd_pessoa";'

    # 5. Direct Insert
    direct_ins_sql = build_postgres_direct_insert_sql(target, insertable)
    assert direct_ins_sql == 'INSERT INTO "public"."migra_1_atendentes" ("cd_pessoa", "validacao_01", "person_id") VALUES %s;'


def test_oracle_sql_generation():
    """Gera e valida SQL do Oracle MERGE para update, upsert e delete."""
    target = "migra_1_atendentes"
    keys = ["cd_pessoa"]
    updatable = ["validacao_01", "person_id"]
    insertable = ["cd_pessoa", "validacao_01", "person_id"]
    all_cols = ["cd_pessoa", "validacao_01", "person_id"]

    # 1. Update only MERGE
    merge_upd = build_oracle_merge_sql(target, keys, updatable, insertable, all_cols, only_update=True)
    assert 'MERGE INTO "migra_1_atendentes" tgt' in merge_upd
    assert 'ON (tgt."cd_pessoa" = src."cd_pessoa")' in merge_upd
    assert 'WHEN MATCHED THEN UPDATE SET tgt."validacao_01" = src."validacao_01", tgt."person_id" = src."person_id"' in merge_upd
    assert 'WHEN NOT MATCHED' not in merge_upd

    # 2. Update or Insert MERGE
    merge_upsert = build_oracle_merge_sql(target, keys, updatable, insertable, all_cols, only_update=False)
    assert 'WHEN MATCHED THEN UPDATE SET' in merge_upsert
    assert 'WHEN NOT MATCHED THEN INSERT ("cd_pessoa", "validacao_01", "person_id")' in merge_upsert

    # 3. Delete
    del_sql = build_oracle_delete_sql(target, keys)
    assert del_sql == 'DELETE FROM "migra_1_atendentes" WHERE "cd_pessoa" = :1'


def test_duckdb_sql_generation():
    """Gera e valida SQL do DuckDB para update, upsert e delete."""
    target = "migra_1_atendentes"
    batch = "_chunk_batch"
    keys = ["cd_pessoa"]
    updatable = ["validacao_01", "person_id"]
    insertable = ["cd_pessoa", "validacao_01", "person_id"]

    # 1. Update from batch
    upd_sql = build_duckdb_update_from_batch_sql(target, batch, keys, updatable)
    assert upd_sql == 'UPDATE "migra_1_atendentes" SET "validacao_01" = _chunk_batch."validacao_01", "person_id" = _chunk_batch."person_id" FROM _chunk_batch WHERE "migra_1_atendentes"."cd_pessoa" = _chunk_batch."cd_pessoa";'

    # 2. Insert from batch (Update or Insert)
    ins_sql = build_duckdb_insert_from_batch_sql(target, batch, keys, insertable)
    assert 'INSERT INTO "migra_1_atendentes" ("cd_pessoa", "validacao_01", "person_id")' in ins_sql
    assert 'SELECT "cd_pessoa", "validacao_01", "person_id" FROM _chunk_batch' in ins_sql
    assert 'WHERE NOT EXISTS (SELECT 1 FROM "migra_1_atendentes" AS t WHERE t."cd_pessoa" = _chunk_batch."cd_pessoa");' in ins_sql

    # 3. Delete from batch
    del_sql = build_duckdb_delete_from_batch_sql(target, batch, keys)
    assert del_sql == 'DELETE FROM "migra_1_atendentes" WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE "migra_1_atendentes"."cd_pessoa" = _chunk_batch."cd_pessoa");'


def test_format_sink_dml_log_matches_prompt_specification():
    """Garante que o formato de log reproduz exatamente a especificação do Talend tDBOutput."""
    res = SinkWriteResult(rows_inserted=0, rows_updated=4, rows_deleted=0, rows_not_matched=1)
    log_text = format_sink_dml_log("PostgreSQL", "postgres_sink_2", "update", rows_read=5, result=res)
    assert log_text == "Nó PostgreSQL sink 'postgres_sink_2': 5 lidas, 4 atualizadas, 1 sem correspondência"

    res_upsert = SinkWriteResult(rows_inserted=2, rows_updated=3, rows_deleted=0, rows_not_matched=0)
    log_ups = format_sink_dml_log("DuckDB", "duckdb_sink_1", "update_or_insert", rows_read=5, result=res_upsert)
    assert log_ups == "Nó DuckDB sink 'duckdb_sink_1': 5 lidas, 3 atualizadas, 2 inseridas"
