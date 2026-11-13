"""Testes da Tarefa 5: Registro de ciclo de vida de nós (início/fim) e mascaramento de segredos."""

import pytest
from datetime import datetime, timezone

from src.core.domain.execution.execution import Execution, ExecutionStatus
from src.core.application.compiler.physical_planner import PhysicalPlan, PhysicalOperator
from src.core.infrastructure.execution.manager import ExecutionManager
from src.core.infrastructure.execution.worker import ExecutionWorker
from src.core.infrastructure.execution.context_variable_interpolation import mask_secrets


def test_mask_secrets_in_logs():
    secrets = ["super_secret_token_123", "password_abc"]
    raw_msg = "Conectando ao banco com token super_secret_token_123 e senha password_abc"
    masked = mask_secrets(raw_msg, secrets)
    assert "super_secret_token_123" not in masked
    assert "password_abc" not in masked
    assert "***" in masked


def test_worker_logs_node_start_and_end_with_duration():
    manager = ExecutionManager()
    token = manager.register_execution("exec-lifecycle-test")

    captured_logs = []
    def custom_log(exec_id, level, msg, node_id=None, cell_id=None):
        captured_logs.append({
            "exec_id": exec_id,
            "level": level,
            "msg": msg,
            "node_id": node_id,
            "cell_id": cell_id
        })
        manager.log(exec_id, level, msg, node_id=node_id, cell_id=cell_id)

    worker = ExecutionWorker()

    execution = Execution(
        id="exec-lifecycle-test",
        pipeline_version_id="ver-1",
        correlation_id="corr-123",
        status=ExecutionStatus.CREATED
    )

    # Cria plano simples com operador scan DuckDB
    op = PhysicalOperator(
        id="scan_1",
        operator_type="scan",
        engine="duckdb",
        config={"format": "duckdb", "query": "SELECT 1 AS val", "cell_id": "cell_alpha"}
    )
    plan = PhysicalPlan(
        pipeline_id="pipe-1",
        operators={"scan_1": op},
        execution_order=["scan_1"]
    )

    worker.run(execution, plan, token, log_fn=custom_log)

    # Verifica se houve log de início e de conclusão do nó scan_1
    start_logs = [l for l in captured_logs if l["node_id"] == "scan_1" and "Iniciando" in l["msg"]]
    end_logs = [l for l in captured_logs if l["node_id"] == "scan_1" and "concluído" in l["msg"]]

    assert len(start_logs) == 1, "Deve registrar início do nó"
    assert len(end_logs) == 1, "Deve registrar conclusão do nó"
    assert "cell_alpha" in start_logs[0]["cell_id"] or "cell_alpha" in str(start_logs[0])
    assert "ms" in end_logs[0]["msg"]
