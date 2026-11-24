"""Testes de integração para DuckDB Sink cobrindo DML completo:
- insert
- update (com e sem match, fail_on_no_match)
- update or insert (sem exigir constraint única)
- delete
- deduplicação de lotes (última linha vence)
- tratamento de chaves nulas
- field options (coluna não updatable não é alterada)
"""

import duckdb
import polars as pl
import pytest
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner(tmp_path):
    db_file = str(tmp_path / "test.duckdb")
    return DuckDBRunner(database_path=db_file)


def test_duckdb_sink_insert(runner):
    """Garante gravação correta de insert com métricas."""
    df = pl.DataFrame({
        "id": [1, 2, 3],
        "nome": ["Alice", "Bob", "Charlie"],
        "valor": [10.0, 20.0, 30.0]
    })
    res = runner.write_to_duckdb(
        df=df,
        table_name="teste_insert",
        data_action="insert"
    )
    assert res.rows_inserted == 3
    assert res.total_affected == 3
    assert int(res) == 3


def test_duckdb_sink_update_and_updatable_cols(runner):
    """Garante que UPDATE altera apenas colunas Updatable e mantém chaves e não-updatable intactas."""
    # 1. Cria tabela inicial com 3 registros
    initial_df = pl.DataFrame({
        "id": [1, 2, 3],
        "nome": ["Alice", "Bob", "Charlie"],
        "salario": [1000.0, 2000.0, 3000.0]
    })
    runner.write_to_duckdb(df=initial_df, table_name="tb_func", data_action="insert")

    # 2. Update nos ids 1 e 2, id 99 (não existe)
    # nome: updatable=False (não pode mudar), salario: updatable=True (deve mudar)
    update_df = pl.DataFrame({
        "id": [1, 2, 99],
        "nome": ["Alice_ALTERADA", "Bob_ALTERADO", "Novo"],
        "salario": [1500.0, 2500.0, 9999.0]
    })
    field_options = [
        {"column": "id", "update_key": True, "updatable": False, "insertable": True},
        {"column": "nome", "update_key": False, "updatable": False, "insertable": True},
        {"column": "salario", "update_key": False, "updatable": True, "insertable": True},
    ]

    res = runner.write_to_duckdb(
        df=update_df,
        table_name="tb_func",
        data_action="update",
        use_field_options=True,
        field_options=field_options
    )

    # 2 linhas atualizadas (1 e 2), 1 sem correspondência (99)
    assert res.rows_updated == 2
    assert res.rows_not_matched == 1
    assert res.rows_inserted == 0

    # Verifica os dados no banco
    conn = duckdb.connect(runner.database_path)
    rows = conn.execute("SELECT id, nome, salario FROM tb_func ORDER BY id;").fetchall()
    conn.close()

    # id 1: nome permaneceu Alice (pois updatable=False), salário mudou para 1500.0
    assert rows[0] == (1, "Alice", 1500.0)
    # id 2: nome permaneceu Bob, salário mudou para 2500.0
    assert rows[1] == (2, "Bob", 2500.0)
    # id 3: intacto
    assert rows[2] == (3, "Charlie", 3000.0)


def test_duckdb_sink_update_without_keys_raises_rule_1(runner):
    """Regra 1: Update sem chave falha com ERR_SINK_KEYS_REQUIRED e não altera tabela."""
    initial_df = pl.DataFrame({"id": [1], "nome": ["Teste"]})
    runner.write_to_duckdb(df=initial_df, table_name="tb_sem_chave", data_action="insert")

    upd_df = pl.DataFrame({"id": [1], "nome": ["Tentativa"]})
    with pytest.raises(DomainValidationError) as exc:
        runner.write_to_duckdb(
            df=upd_df,
            table_name="tb_sem_chave",
            data_action="update",
            keys=[]
        )
    assert exc.value.code == "ERR_SINK_KEYS_REQUIRED"

    conn = duckdb.connect(runner.database_path)
    rows = conn.execute("SELECT nome FROM tb_sem_chave;").fetchall()
    conn.close()
    assert rows[0][0] == "Teste"


def test_duckdb_sink_fail_on_no_match(runner):
    """Regra 7: fail_on_no_match=True lança ERR_SINK_NO_MATCH quando nenhuma linha casa."""
    initial_df = pl.DataFrame({"id": [1], "nome": ["Teste"]})
    runner.write_to_duckdb(df=initial_df, table_name="tb_no_match", data_action="insert")

    upd_df = pl.DataFrame({"id": [999], "nome": ["Inexistente"]})
    with pytest.raises(DomainValidationError) as exc:
        runner.write_to_duckdb(
            df=upd_df,
            table_name="tb_no_match",
            data_action="update",
            keys=["id"],
            fail_on_no_match=True
        )
    assert exc.value.code == "ERR_SINK_NO_MATCH"


def test_duckdb_sink_update_or_insert_without_unique_constraint(runner):
    """Update or Insert com 3 existentes e 2 novos resulta em 3 atualizados e 2 inseridos."""
    # Tabela inicial com ids 1, 2, 3
    initial_df = pl.DataFrame({
        "id": [1, 2, 3],
        "val": ["v1", "v2", "v3"]
    })
    runner.write_to_duckdb(df=initial_df, table_name="tb_upsert", data_action="insert")

    # Lote de entrada com ids 1, 2, 3 (existentes) e 4, 5 (novos)
    batch_df = pl.DataFrame({
        "id": [1, 2, 3, 4, 5],
        "val": ["v1_upd", "v2_upd", "v3_upd", "v4_novo", "v5_novo"]
    })
    res = runner.write_to_duckdb(
        df=batch_df,
        table_name="tb_upsert",
        data_action="update_or_insert",
        keys=["id"]
    )

    assert res.rows_updated == 3
    assert res.rows_inserted == 2
    assert res.total_affected == 5

    conn = duckdb.connect(runner.database_path)
    rows = conn.execute("SELECT id, val FROM tb_upsert ORDER BY id;").fetchall()
    conn.close()

    assert len(rows) == 5
    assert rows[0] == (1, "v1_upd")
    assert rows[1] == (2, "v2_upd")
    assert rows[2] == (3, "v3_upd")
    assert rows[3] == (4, "v4_novo")
    assert rows[4] == (5, "v5_novo")


def test_duckdb_sink_delete(runner):
    """Delete remove apenas as linhas das chaves de deleção e conta rows_deleted e rows_not_matched."""
    initial_df = pl.DataFrame({
        "id": [1, 2, 3, 4],
        "val": ["a", "b", "c", "d"]
    })
    runner.write_to_duckdb(df=initial_df, table_name="tb_del", data_action="insert")

    del_df = pl.DataFrame({
        "id": [2, 4, 999]  # 2 e 4 existem, 999 não existe
    })
    res = runner.write_to_duckdb(
        df=del_df,
        table_name="tb_del",
        data_action="delete",
        keys=["id"]
    )

    assert res.rows_deleted == 2
    assert res.rows_not_matched == 1

    conn = duckdb.connect(runner.database_path)
    rows = conn.execute("SELECT id FROM tb_del ORDER BY id;").fetchall()
    conn.close()

    assert rows == [(1,), (3,)]


def test_duckdb_sink_batch_deduplication_last_row_wins(runner):
    """Regra 6: Em chaves repetidas no lote, a última linha vence."""
    initial_df = pl.DataFrame({"id": [1], "val": ["original"]})
    runner.write_to_duckdb(df=initial_df, table_name="tb_dedup", data_action="insert")

    batch_df = pl.DataFrame({
        "id": [1, 1, 1],
        "val": ["primeira", "segunda", "terceira_vence"]
    })
    res = runner.write_to_duckdb(
        df=batch_df,
        table_name="tb_dedup",
        data_action="update",
        keys=["id"]
    )

    assert res.rows_updated == 1
    assert res.duplicates_in_batch == 2

    conn = duckdb.connect(runner.database_path)
    rows = conn.execute("SELECT val FROM tb_dedup WHERE id = 1;").fetchall()
    conn.close()
    assert rows[0][0] == "terceira_vence"
