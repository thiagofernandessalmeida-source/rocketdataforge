"""Testes unitários do agregado Execution e Máquina de Estados Finita (FSM)."""

from datetime import datetime, timezone
import pytest
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.shared.exceptions import InvalidStateTransitionError


def test_execution_creation_initial_state():
    execution = Execution(
        id="exec-01",
        pipeline_version_id="ver-01",
        correlation_id="corr-123"
    )
    assert execution.id == "exec-01"
    assert execution.status == ExecutionStatus.CREATED
    assert execution.attempt == 1
    assert execution.started_at is None
    assert execution.finished_at is None


def test_happy_path_transitions():
    execution = Execution(
        id="exec-01",
        pipeline_version_id="ver-01",
        correlation_id="corr-123"
    )

    execution.start_planning()
    assert execution.status == ExecutionStatus.PLANNING

    execution.mark_queued()
    assert execution.status == ExecutionStatus.QUEUED

    execution.start_running()
    assert execution.status == ExecutionStatus.RUNNING
    assert execution.started_at is not None

    execution.succeed()
    assert execution.status == ExecutionStatus.SUCCEEDED
    assert execution.finished_at is not None


def test_invalid_transition_from_terminal_state():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    execution.start_planning()
    execution.mark_queued()
    execution.start_running()
    execution.succeed()

    # De SUCCEEDED não pode voltar para RUNNING
    with pytest.raises(InvalidStateTransitionError):
        execution.start_running()


def test_invalid_skip_transition():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    # Não pode pular de CREATED direto para SUCCEEDED
    with pytest.raises(InvalidStateTransitionError):
        execution.succeed()


def test_failure_transition():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    execution.start_planning()
    execution.mark_queued()
    execution.start_running()

    execution.fail("ERR_CONNECTOR", "Timeout ao conectar no banco de dados")
    assert execution.status == ExecutionStatus.FAILED
    assert execution.finished_at is not None
    assert execution.error_details["code"] == "ERR_CONNECTOR"


def test_cooperative_cancellation_and_idempotency():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    execution.start_planning()
    execution.mark_queued()
    execution.start_running()

    # 1. Solicita cancelamento
    execution.request_cancellation()
    assert execution.status == ExecutionStatus.CANCELLING

    # 2. Chamadas subsequentes devem ser estritamente idempotentes
    execution.request_cancellation()
    assert execution.status == ExecutionStatus.CANCELLING

    # 3. Worker confirma cancelamento
    execution.complete_cancellation()
    assert execution.status == ExecutionStatus.CANCELLED
    assert execution.finished_at is not None

    # 4. Outra chamada após CANCELLED é idempotente e mantem estado
    execution.request_cancellation()
    assert execution.status == ExecutionStatus.CANCELLED


def test_cancellation_on_completed_execution_is_ignored():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    execution.start_planning()
    execution.mark_queued()
    execution.start_running()
    execution.succeed()

    # Cancelamento em execução finalizada não altera o status SUCCEEDED
    execution.request_cancellation()
    assert execution.status == ExecutionStatus.SUCCEEDED


def test_task_run_progress_and_metrics():
    execution = Execution(id="exec-01", pipeline_version_id="v1", correlation_id="c1")
    task = execution.add_task("filter_node")

    assert task.node_id == "filter_node"
    assert task.rows_in == 0

    task.record_progress(rows_in_increment=500, rows_out_increment=450, rejected_increment=50)
    assert task.rows_in == 500
    assert task.rows_out == 450
    assert task.rejected_count == 50

    now = datetime.now(timezone.utc)
    task.complete(finished_at=now)
    assert task.status == ExecutionStatus.SUCCEEDED
    assert task.finished_at == now
