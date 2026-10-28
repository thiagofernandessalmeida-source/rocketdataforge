"""Testes unitários para o Cache de Preview e Paginação DuckDB (Fase 3 - Spec 005).

Cobre:
1. Armazenamento de saídas limitadas a 5.000 linhas por nó/porta.
2. Paginação virtualizada (page, page_size, total_rows, total_pages).
3. Suporte a múltiplas portas de saída (ex: 'main', 'reject').
4. Busca textual e ordenação por coluna.
5. Expiração automática por TTL (1 hora / configurável).
"""

import time
import polars as pl
import pytest

from src.core.domain.shared.exceptions import DomainError
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner


@pytest.fixture
def runner():
    """Instância isolada de DuckDBRunner para testes de preview cache."""
    r = DuckDBRunner(memory_limit="256MB")
    yield r
    r.close()


def test_preview_cache_stores_and_limits_to_5000_rows(runner):
    """Armazenamento deve limitar automaticamente em 5.000 linhas máximas."""
    # Cria DataFrame com 6.000 linhas
    df = pl.DataFrame({
        "id": list(range(6000)),
        "val": [f"item_{i}" for i in range(6000)]
    })

    exec_id = "exec_test_001"
    node_id = "filter_1"

    table_name = runner.store_node_preview(
        execution_id=exec_id,
        node_id=node_id,
        port_name="main",
        df=df,
        max_rows=5000
    )
    assert table_name is not None

    preview = runner.get_node_preview(
        execution_id=exec_id,
        node_id=node_id,
        port_name="main",
        page=1,
        page_size=50
    )

    assert preview["total_rows"] == 5000
    assert len(preview["rows"]) == 50
    assert preview["total_pages"] == 100
    assert preview["page"] == 1
    assert preview["page_size"] == 50
    assert preview["port"] == "main"
    assert preview["columns"] == ["id", "val"]


def test_preview_cache_pagination_offsets(runner):
    """Valida offsets e páginas intermediárias."""
    df = pl.DataFrame({
        "id": list(range(100)),
        "name": [f"Name_{i}" for i in range(100)]
    })

    exec_id = "exec_test_002"
    node_id = "tmap_1"

    runner.store_node_preview(exec_id, node_id, "output", df)

    # Página 1 (0 a 19)
    p1 = runner.get_node_preview(exec_id, node_id, "output", page=1, page_size=20)
    assert len(p1["rows"]) == 20
    assert p1["rows"][0]["id"] == 0
    assert p1["rows"][-1]["id"] == 19

    # Página 2 (20 a 39)
    p2 = runner.get_node_preview(exec_id, node_id, "output", page=2, page_size=20)
    assert len(p2["rows"]) == 20
    assert p2["rows"][0]["id"] == 20
    assert p2["rows"][-1]["id"] == 39

    # Página 5 (80 a 99)
    p5 = runner.get_node_preview(exec_id, node_id, "output", page=5, page_size=20)
    assert len(p5["rows"]) == 20
    assert p5["rows"][-1]["id"] == 99


def test_preview_cache_multi_port_support(runner):
    """Valida armazenamento e recuperação de múltiplas portas de um mesmo nó (ex: main vs reject)."""
    df_main = pl.DataFrame({"id": [1, 2], "status": ["OK", "OK"]})
    df_reject = pl.DataFrame({"id": [3], "status": ["ERROR"], "reason": ["null pointer"]})

    exec_id = "exec_test_003"
    node_id = "split_filter"

    runner.store_node_preview(exec_id, node_id, "main", df_main)
    runner.store_node_preview(exec_id, node_id, "reject", df_reject)

    # Consulta main
    prev_main = runner.get_node_preview(exec_id, node_id, "main")
    assert prev_main["total_rows"] == 2
    assert "reject" in prev_main["available_ports"]
    assert "main" in prev_main["available_ports"]
    assert prev_main["columns"] == ["id", "status"]

    # Consulta reject
    prev_reject = runner.get_node_preview(exec_id, node_id, "reject")
    assert prev_reject["total_rows"] == 1
    assert prev_reject["columns"] == ["id", "status", "reason"]
    assert prev_reject["rows"][0]["reason"] == "null pointer"


def test_preview_cache_search_and_sorting(runner):
    """Valida busca textual e ordenação dentro do DuckDB."""
    df = pl.DataFrame({
        "id": [1, 2, 3, 4],
        "name": ["Alice", "Bob", "Alicia", "Charlie"],
        "score": [85.5, 92.0, 78.0, 95.0]
    })

    exec_id = "exec_test_004"
    node_id = "ranker"
    runner.store_node_preview(exec_id, node_id, "out", df)

    # Busca por 'Alic' deve retornar Alice e Alicia
    search_res = runner.get_node_preview(exec_id, node_id, "out", search="Alic")
    assert search_res["total_rows"] == 2
    names = [r["name"] for r in search_res["rows"]]
    assert "Alice" in names
    assert "Alicia" in names

    # Ordenação por score DESC
    sorted_res = runner.get_node_preview(exec_id, node_id, "out", sort_by="score", sort_desc=True)
    assert sorted_res["rows"][0]["name"] == "Charlie"  # 95.0
    assert sorted_res["rows"][1]["name"] == "Bob"      # 92.0


def test_preview_cache_expiration(runner):
    """Valida expiração após TTL configurado."""
    df = pl.DataFrame({"x": [1, 2, 3]})
    exec_id = "exec_test_005"
    node_id = "expiring_node"

    runner.store_node_preview(exec_id, node_id, "main", df)

    # Com TTL de 0 segundos deve ser considerado expirado ao consultar
    prev = runner.get_node_preview(exec_id, node_id, "main", ttl_seconds=0.0)
    assert prev is None

    # Armazena outro item e valida que cleanup_expired_previews o remove
    runner.store_node_preview(exec_id, "node_to_cleanup", "main", df)
    cleaned = runner.cleanup_expired_previews(ttl_seconds=0.0)
    assert cleaned >= 1


def test_api_get_node_preview_endpoint(tmp_path):
    """Valida a rota REST GET /api/v1/executions/{id}/nodes/{node_id}/preview após uma execução."""
    import time
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # 1. Cria dados e pipeline
    csv_file = tmp_path / "api_prev_input.csv"
    pl.DataFrame({
        "id": [1, 2, 3],
        "category": ["A", "B", "A"],
        "val": [10.5, 20.0, 30.5]
    }).write_csv(csv_file)

    draft_def = {
        "metadata": {"name": "prev_pipe"},
        "spec": {
            "nodes": [
                {
                    "id": "src_node",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {"path": str(csv_file), "format": "csv", "table": "src_table"}
                },
                {
                    "id": "filter_node",
                    "component": {"type": "core.filter", "version": "1.0.0"},
                    "config": {
                        "conditions": [{"column": "category", "operator": "==", "value": "A"}]
                    }
                }
            ],
            "edges": [
                {"from": "src_node.output", "to": "filter_node.input"}
            ]
        }
    }

    # Dispara execução parcial até filter_node
    res_exec = client.post("/api/v1/executions/partial", json={
        "target_node_id": "filter_node",
        "draft_definition": draft_def
    })
    assert res_exec.status_code == 202
    exec_id = res_exec.json()["execution_id"]

    for _ in range(20):
        time.sleep(0.1)
        res_status = client.get(f"/api/v1/executions/{exec_id}")
        if res_status.status_code == 200 and res_status.json()["status"] in {"succeeded", "failed"}:
            break

    # Consulta preview de filter_node
    res_prev = client.get(f"/api/v1/executions/{exec_id}/nodes/filter_node/preview")
    assert res_prev.status_code == 200
    prev_data = res_prev.json()
    assert prev_data["node_id"] == "filter_node"
    assert prev_data["total_rows"] == 2
    assert len(prev_data["rows"]) == 2
    assert prev_data["rows"][0]["category"] == "A"
    assert "main" in prev_data["available_ports"]
