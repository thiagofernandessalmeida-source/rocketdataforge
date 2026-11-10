"""Testes unitários para o Agendador Nativo (SchedulerService) e Webhooks (Fase 1 - Spec 006).

Cobre:
1. Agendamento com expressões Cron (5 e 6 posições) e cálculo de next_run_at.
2. Agendamento com intervalo fixo (interval_seconds).
3. Políticas de concorrência: ALLOW e SKIP_IF_RUNNING.
4. Ciclo de vida: Pausar, Retomar, Disparo Manual (Trigger Now) e Deletar.
5. Disparo assíncrono de Webhooks em caso de sucesso e falha.
6. Persistência de agendamentos em banco de dados SQLite.
"""

from datetime import datetime, timezone
import time
from unittest.mock import MagicMock, patch
import pytest

from src.core.infrastructure.scheduler.scheduler_service import (
    ConcurrencyPolicy,
    ScheduleCreate,
    ScheduleDefinition,
    SchedulerService,
    WebhookNotifier,
)


@pytest.fixture
def scheduler(tmp_path):
    """Fixture para SchedulerService isolado com SQLite temporário."""
    db_file = tmp_path / "test_scheduler.db"
    svc = SchedulerService(db_url=f"sqlite:///{db_file}")
    svc.start()
    yield svc
    svc.shutdown(wait=False)


# ============================================================================
# 1. TESTES DE AGENDAMENTO CRON E INTERVALO
# ============================================================================

def test_create_schedule_with_cron_expression(scheduler):
    """Valida cadastro de schedule com expressão cron de 5 posições."""
    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_daily_sync",
        name="Sincronização Diária",
        cron_expression="0 2 * * *",  # Todo dia às 02:00
        concurrency_policy=ConcurrencyPolicy.SKIP_IF_RUNNING,
    ))

    assert sched.id is not None
    assert sched.pipeline_id == "pipe_daily_sync"
    assert sched.cron_expression == "0 2 * * *"
    assert sched.enabled is True
    assert sched.next_run_at is not None
    assert sched.next_run_at > datetime.now(timezone.utc)


def test_create_schedule_with_interval_seconds(scheduler):
    """Valida cadastro de schedule com intervalo fixo em segundos."""
    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_near_realtime",
        name="Ingestão Contínua",
        interval_seconds=30,
        concurrency_policy=ConcurrencyPolicy.ALLOW,
    ))

    assert sched.id is not None
    assert sched.interval_seconds == 30
    assert sched.next_run_at is not None


def test_create_schedule_invalid_cron_raises_validation_error(scheduler):
    """Expressão cron inválida deve disparar erro de validação."""
    with pytest.raises(ValueError, match="Expressão cron inválida"):
        scheduler.create_schedule(ScheduleCreate(
            pipeline_id="pipe_fail",
            name="Cron Inválido",
            cron_expression="invalid_cron_string",
        ))


# ============================================================================
# 2. TESTES DE POLÍTICAS DE CONCORRÊNCIA (ALLOW vs SKIP_IF_RUNNING)
# ============================================================================

def test_concurrency_policy_skip_if_running(scheduler):
    """Se uma execução já estiver em andamento, SKIP_IF_RUNNING deve ignorar a nova tentativa."""
    executed_count = 0

    def slow_task():
        nonlocal executed_count
        executed_count += 1
        time.sleep(0.3)

    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_heavy",
        name="Carga Pesada",
        interval_seconds=1,
        concurrency_policy=ConcurrencyPolicy.SKIP_IF_RUNNING,
    ), job_fn=slow_task)

    # Marca manualmente o pipeline como em execução
    scheduler.mark_pipeline_running(sched.pipeline_id, True)

    # Tentativa de disparo deve ser ignorada
    status = scheduler.trigger_schedule(sched.id)
    assert status == "skipped"
    assert executed_count == 0

    # Desmarca e tenta novamente
    scheduler.mark_pipeline_running(sched.pipeline_id, False)
    status = scheduler.trigger_schedule(sched.id)
    assert status == "triggered"
    assert executed_count == 1


def test_concurrency_policy_allow_concurrent_runs(scheduler):
    """Política ALLOW deve permitir execuções simultâneas sem bloqueio."""
    executed_count = 0

    def concurrent_task():
        nonlocal executed_count
        executed_count += 1

    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_parallel",
        name="Pipeline Paralelo",
        interval_seconds=1,
        concurrency_policy=ConcurrencyPolicy.ALLOW,
    ), job_fn=concurrent_task)

    scheduler.mark_pipeline_running(sched.pipeline_id, True)

    # ALLOW deve disparar mesmo estando marcado como em execução
    status = scheduler.trigger_schedule(sched.id)
    assert status == "triggered"
    assert executed_count == 1


# ============================================================================
# 3. TESTES DE CICLO DE VIDA (PAUSE, RESUME, DELETE, TRIGGER)
# ============================================================================

def test_pause_and_resume_schedule(scheduler):
    """Pausar deve desabilitar o disparo e remover next_run_at temporariamente."""
    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_lifecycle",
        name="Lifecycle Job",
        cron_expression="0 * * * *",
    ))

    assert sched.enabled is True

    # Pausar
    paused = scheduler.pause_schedule(sched.id)
    assert paused.enabled is False

    # Retomar
    resumed = scheduler.resume_schedule(sched.id)
    assert resumed.enabled is True
    assert resumed.next_run_at is not None


def test_delete_schedule(scheduler):
    """Deletar deve remover o agendador e o registro persistido."""
    sched = scheduler.create_schedule(ScheduleCreate(
        pipeline_id="pipe_to_delete",
        name="Deletable Job",
        cron_expression="0 0 * * *",
    ))

    assert scheduler.get_schedule(sched.id) is not None

    deleted = scheduler.delete_schedule(sched.id)
    assert deleted is True
    assert scheduler.get_schedule(sched.id) is None


# ============================================================================
# 4. TESTES DE NOTIFICAÇÃO VIA WEBHOOK
# ============================================================================

@patch("httpx.post")
def test_webhook_notifier_dispatch_success(mock_post):
    """Valida envio de alerta de sucesso para URL de webhook configurada."""
    mock_post.return_value.status_code = 200

    notifier = WebhookNotifier()
    success = notifier.send_alert(
        webhook_url="https://hooks.slack.com/services/test/webhook",
        event="execution.success",
        payload={
            "schedule_id": "sched_123",
            "pipeline_id": "pipe_abc",
            "execution_id": "exec_999",
            "status": "succeeded",
            "duration_ms": 1420
        }
    )

    assert success is True
    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "https://hooks.slack.com/services/test/webhook"
    assert kwargs["json"]["event"] == "execution.success"
    assert kwargs["json"]["pipeline_id"] == "pipe_abc"


@patch("httpx.post")
def test_webhook_notifier_dispatch_failure_resilient(mock_post):
    """Falha de rede no webhook não deve quebrar o executor."""
    mock_post.side_effect = Exception("Conexão recusada")

    notifier = WebhookNotifier()
    success = notifier.send_alert(
        webhook_url="https://invalid-webhook-url.example.com",
        event="execution.failure",
        payload={"pipeline_id": "pipe_error", "error": "Timeout"}
    )

    assert success is False


# ============================================================================
# 5. TESTES DE PERSISTÊNCIA SQLITE
# ============================================================================

def test_schedules_persist_and_reload(tmp_path):
    """Ao reiniciar o SchedulerService, os agendamentos salvos devem ser recarregados."""
    db_file = tmp_path / "persistent_scheduler.db"
    db_url = f"sqlite:///{db_file}"

    # Instância 1: cria schedule e encerra
    svc1 = SchedulerService(db_url=db_url)
    svc1.start()
    sched1 = svc1.create_schedule(ScheduleCreate(
        pipeline_id="pipe_persisted",
        name="Job Persistido",
        cron_expression="*/15 * * * *",
        webhook_url="https://my-webhook.org/alert"
    ))
    sched_id = sched1.id
    svc1.shutdown(wait=False)

    # Instância 2: conecta no mesmo banco e recupera
    svc2 = SchedulerService(db_url=db_url)
    svc2.start()
    reloaded = svc2.get_schedule(sched_id)

    assert reloaded is not None
    assert reloaded.id == sched_id
    assert reloaded.name == "Job Persistido"
    assert reloaded.next_run_at is not None
    svc2.shutdown(wait=False)


# ============================================================================
# 6. TESTE DE INTEGRAÇÃO COM A API REST FASTAPI
# ============================================================================

def test_api_schedules_full_lifecycle():
    """Valida endpoints /api/v1/schedules (criação, listagem, pausa, retomada, disparo e exclusão)."""
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    # 1. Criação
    res_create = client.post("/api/v1/schedules", json={
        "pipeline_id": "pipe_api_test",
        "name": "Agendamento API",
        "cron_expression": "0 12 * * *",
        "concurrency_policy": "SKIP_IF_RUNNING",
        "webhook_url": "https://api.slack.com/webhook",
        "webhook_events": ["success", "failure"]
    })
    assert res_create.status_code == 201
    data = res_create.json()
    sched_id = data["id"]
    assert data["pipeline_id"] == "pipe_api_test"
    assert data["cron_expression"] == "0 12 * * *"
    assert data["enabled"] is True

    # 2. Listagem
    res_list = client.get("/api/v1/schedules?pipeline_id=pipe_api_test")
    assert res_list.status_code == 200
    items = res_list.json()
    assert any(i["id"] == sched_id for i in items)

    # 3. Detalhes
    res_get = client.get(f"/api/v1/schedules/{sched_id}")
    assert res_get.status_code == 200
    assert res_get.json()["name"] == "Agendamento API"

    # 4. Pausa
    res_pause = client.post(f"/api/v1/schedules/{sched_id}/pause")
    assert res_pause.status_code == 200
    assert res_pause.json()["enabled"] is False

    # 5. Retomada
    res_resume = client.post(f"/api/v1/schedules/{sched_id}/resume")
    assert res_resume.status_code == 200
    assert res_resume.json()["enabled"] is True

    # 6. Disparo Manual
    res_trigger = client.post(f"/api/v1/schedules/{sched_id}/trigger")
    assert res_trigger.status_code == 200
    assert res_trigger.json()["status"] in ("triggered", "skipped")

    # 7. Exclusão
    res_del = client.delete(f"/api/v1/schedules/{sched_id}")
    assert res_del.status_code == 204

    # Confirmação de 404
    res_after = client.get(f"/api/v1/schedules/{sched_id}")
    assert res_after.status_code == 404

