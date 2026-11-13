"""Testes da Tarefa 4: Aquecimento de backend e polling incremental com seq nos logs."""

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from src.core.infrastructure.execution.manager import ExecutionManager, ExecutionLogRecord
from src.core.infrastructure.execution.warmup import run_warmup, is_backend_warm, get_warmup_details
from src.core.infrastructure.web.app import create_app


def test_execution_log_record_has_seq_and_cell_id():
    record = ExecutionLogRecord(
        execution_id="exec-123",
        level="INFO",
        message="Teste de log",
        node_id="node_1",
        seq=42,
        cell_id="canvas-cell-01"
    )
    assert record.seq == 42
    assert record.cell_id == "canvas-cell-01"
    d = record.to_dict()
    assert d["seq"] == 42
    assert d["cell_id"] == "canvas-cell-01"


def test_execution_manager_generates_monotonically_increasing_seq():
    manager = ExecutionManager()
    token = manager.register_execution("exec-seq-test")
    assert token is not None

    manager.log("exec-seq-test", "INFO", "Mensagem 1", node_id="node_a")
    manager.log("exec-seq-test", "DEBUG", "Mensagem 2", node_id="node_a")
    manager.log("exec-seq-test", "WARN", "Mensagem 3", node_id="node_b")

    logs = manager.get_logs("exec-seq-test")
    assert len(logs) == 3
    assert [l.seq for l in logs] == [1, 2, 3]

    # Test incremental logs query with after=<seq>
    after_1 = manager.get_logs("exec-seq-test", after=1)
    assert len(after_1) == 2
    assert [l.seq for l in after_1] == [2, 3]

    after_2 = manager.get_logs("exec-seq-test", after=2)
    assert len(after_2) == 1
    assert after_2[0].seq == 3

    after_3 = manager.get_logs("exec-seq-test", after=3)
    assert len(after_3) == 0


def test_warmup_runner_completes_and_sets_warm():
    details = run_warmup()
    assert details["duckdb"] is True
    assert details["polars"] is True
    assert details["expressions"] is True
    assert details["connectors"] is True
    assert is_backend_warm() is True
    assert get_warmup_details()["duration_ms"] >= 0


def test_health_endpoint_exposes_warm_status():
    app = create_app()
    with TestClient(app) as client:
        res = client.get("/api/v1/health")
        assert res.status_code == 200
        data = res.json()
        assert "warm" in data
        assert isinstance(data["warm"], bool)

