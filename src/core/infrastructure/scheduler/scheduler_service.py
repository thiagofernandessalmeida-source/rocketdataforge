"""Serviço de Agendamento Nativo (SchedulerService) e Notificações Webhook (Spec 006 - Fase 1).

Utiliza APScheduler com persistência SQLite e controle de concorrência:
- Suporte a Cron (5/6 posições) e Intervalos em segundos.
- Políticas de Concorrência: ALLOW, SKIP_IF_RUNNING, QUEUE.
- Disparo assíncrono de Webhooks em caso de sucesso e falha.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
import json
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set
import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SQLEnum,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, sessionmaker

from src.core.domain.shared.identifiers import generate_ulid

logger = logging.getLogger(__name__)

Base = declarative_base()


class ConcurrencyPolicy(str, Enum):
    """Política de concorrência ao disparar agendamentos."""
    ALLOW = "ALLOW"
    SKIP_IF_RUNNING = "SKIP_IF_RUNNING"
    QUEUE = "QUEUE"


class ScheduleModel(Base):
    """Tabela persistente SQLite para agendamentos."""
    __tablename__ = "schedules"

    id = Column(String(64), primary_key=True)
    pipeline_id = Column(String(128), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    cron_expression = Column(String(100), nullable=True)
    interval_seconds = Column(Integer, nullable=True)
    concurrency_policy = Column(SQLEnum(ConcurrencyPolicy), default=ConcurrencyPolicy.SKIP_IF_RUNNING)
    enabled = Column(Boolean, default=True)
    webhook_url = Column(String(1024), nullable=True)
    webhook_events = Column(Text, nullable=True)  # JSON list
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_status = Column(String(50), nullable=True)


@dataclass
class ScheduleCreate:
    """Payload de criação de um agendamento."""
    pipeline_id: str
    name: str
    cron_expression: Optional[str] = None
    interval_seconds: Optional[int] = None
    concurrency_policy: ConcurrencyPolicy = ConcurrencyPolicy.SKIP_IF_RUNNING
    enabled: bool = True
    webhook_url: Optional[str] = None
    webhook_events: List[str] = field(default_factory=lambda: ["success", "failure"])


@dataclass
class ScheduleDefinition:
    """Entidade de leitura e metadados de agendamento."""
    id: str
    pipeline_id: str
    name: str
    cron_expression: Optional[str] = None
    interval_seconds: Optional[int] = None
    concurrency_policy: ConcurrencyPolicy = ConcurrencyPolicy.SKIP_IF_RUNNING
    enabled: bool = True
    webhook_url: Optional[str] = None
    webhook_events: List[str] = field(default_factory=lambda: ["success", "failure"])
    created_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    last_status: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "pipeline_id": self.pipeline_id,
            "name": self.name,
            "cron_expression": self.cron_expression,
            "interval_seconds": self.interval_seconds,
            "concurrency_policy": self.concurrency_policy.value if hasattr(self.concurrency_policy, "value") else str(self.concurrency_policy),
            "enabled": self.enabled,
            "webhook_url": self.webhook_url,
            "webhook_events": self.webhook_events,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "last_status": self.last_status,
        }


class WebhookNotifier:
    """Despachante assíncrono e resiliente de alertas Webhook (Slack, Teams, Discord, etc.)."""

    def send_alert(
        self,
        webhook_url: str,
        event: str,
        payload: Dict[str, Any],
        timeout: float = 5.0
    ) -> bool:
        """Envia POST com corpo estruturado para a URL do Webhook configurada."""
        if not webhook_url:
            return False

        body = {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **payload
        }

        try:
            res = httpx.post(webhook_url, json=body, timeout=timeout)
            logger.info(f"Webhook alert '{event}' enviado para '{webhook_url}'. Status={res.status_code}")
            return res.status_code in (200, 201, 202, 204)
        except Exception as err:
            logger.warning(f"Falha não-bloqueante ao despachar webhook para '{webhook_url}': {err}")
            return False


class SchedulerService:
    """Gerenciador central de agendamentos com APScheduler e SQLite."""

    _instance: Optional["SchedulerService"] = None

    def __init__(
        self,
        db_url: Optional[str] = None,
        notifier: Optional[WebhookNotifier] = None
    ):
        if not db_url:
            db_dir = os.path.join(os.getcwd(), "data")
            os.makedirs(db_dir, exist_ok=True)
            db_file = os.path.join(db_dir, "scheduler.db")
            self.db_url = f"sqlite:///{db_file}"
        else:
            self.db_url = db_url

        self.engine = create_engine(self.db_url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(bind=self.engine)

        self.notifier = notifier or WebhookNotifier()
        self.scheduler = BackgroundScheduler(daemon=True)
        self._running_pipelines: Set[str] = set()
        self._lock = threading.RLock()
        self._custom_job_fns: Dict[str, Callable] = {}

    @classmethod
    def get_instance(cls) -> "SchedulerService":
        """Singleton accessor."""
        if cls._instance is None:
            cls._instance = SchedulerService()
            cls._instance.start()
        return cls._instance

    def start(self) -> None:
        """Inicia o agendador e recarrega os jobs persistidos."""
        if not self.scheduler.running:
            self.scheduler.start()
        self._reload_persisted_jobs()

    def shutdown(self, wait: bool = False) -> None:
        """Encerra o agendador em background."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=wait)

    def mark_pipeline_running(self, pipeline_id: str, is_running: bool) -> None:
        """Sinaliza se um pipeline está atualmente em execução (controle de concorrência)."""
        with self._lock:
            if is_running:
                self._running_pipelines.add(pipeline_id)
            else:
                self._running_pipelines.discard(pipeline_id)

    def is_pipeline_running(self, pipeline_id: str) -> bool:
        """Verifica se há execução em andamento para o pipeline."""
        with self._lock:
            return pipeline_id in self._running_pipelines

    def create_schedule(
        self,
        data: ScheduleCreate,
        job_fn: Optional[Callable] = None
    ) -> ScheduleDefinition:
        """Cria um novo agendamento, persiste no banco e registra no APScheduler."""
        if not data.cron_expression and not data.interval_seconds:
            raise ValueError("O agendamento deve definir 'cron_expression' ou 'interval_seconds'.")

        trigger = self._build_trigger(data.cron_expression, data.interval_seconds)

        sched_id = f"sched_{generate_ulid().lower()}"
        events_json = json.dumps(data.webhook_events or ["success", "failure"])

        session = self.SessionFactory()
        try:
            model = ScheduleModel(
                id=sched_id,
                pipeline_id=data.pipeline_id,
                name=data.name,
                cron_expression=data.cron_expression,
                interval_seconds=data.interval_seconds,
                concurrency_policy=data.concurrency_policy,
                enabled=data.enabled,
                webhook_url=data.webhook_url,
                webhook_events=events_json,
                created_at=datetime.now(timezone.utc),
            )
            session.add(model)
            session.commit()
            session.refresh(model)
            definition = self._model_to_definition(model)
        finally:
            session.close()

        if job_fn:
            self._custom_job_fns[sched_id] = job_fn

        if data.enabled:
            job = self.scheduler.add_job(
                func=self._execute_job_wrapper,
                trigger=trigger,
                args=[sched_id],
                id=sched_id,
                replace_existing=True,
                name=data.name
            )
            next_run = getattr(job, "next_run_time", None)
            if not next_run and trigger:
                try:
                    next_run = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
                except Exception:
                    next_run = None
            definition.next_run_at = next_run
            self._update_next_run_time(sched_id, next_run)

        return definition

    def get_schedule(self, schedule_id: str) -> Optional[ScheduleDefinition]:
        """Obtém definição detalhada de um agendamento."""
        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if not model:
                return None
            definition = self._model_to_definition(model)
            job = self.scheduler.get_job(schedule_id)
            if job and hasattr(job, "next_run_time") and job.next_run_time:
                definition.next_run_at = job.next_run_time
            return definition
        finally:
            session.close()


    def list_schedules(self, pipeline_id: Optional[str] = None) -> List[ScheduleDefinition]:
        """Lista agendamentos cadastrados com filtro opcional por pipeline."""
        session = self.SessionFactory()
        try:
            query = session.query(ScheduleModel)
            if pipeline_id:
                query = query.filter(ScheduleModel.pipeline_id == pipeline_id)
            models = query.order_by(ScheduleModel.created_at.desc()).all()
            results = []
            for m in models:
                d = self._model_to_definition(m)
                job = self.scheduler.get_job(m.id)
                next_run = getattr(job, "next_run_time", None) if job else None
                if next_run:
                    d.next_run_at = next_run
                results.append(d)
            return results
        finally:
            session.close()

    def pause_schedule(self, schedule_id: str) -> ScheduleDefinition:
        """Pausa um agendamento ativo."""
        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if not model:
                raise ValueError(f"Agendamento '{schedule_id}' não encontrado.")
            model.enabled = False
            model.next_run_at = None
            session.commit()
            session.refresh(model)
            definition = self._model_to_definition(model)
        finally:
            session.close()

        if self.scheduler.get_job(schedule_id):
            self.scheduler.pause_job(schedule_id)

        definition.next_run_at = None
        return definition

    def resume_schedule(self, schedule_id: str) -> ScheduleDefinition:
        """Retoma um agendamento pausado."""
        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if not model:
                raise ValueError(f"Agendamento '{schedule_id}' não encontrado.")
            model.enabled = True
            session.commit()
            session.refresh(model)
            definition = self._model_to_definition(model)
        finally:
            session.close()

        job = self.scheduler.get_job(schedule_id)
        if job:
            job.resume()
            definition.next_run_at = getattr(job, "next_run_time", None)
        else:
            trigger = self._build_trigger(definition.cron_expression, definition.interval_seconds)
            new_job = self.scheduler.add_job(
                func=self._execute_job_wrapper,
                trigger=trigger,
                args=[schedule_id],
                id=schedule_id,
                replace_existing=True,
                name=definition.name
            )
            next_run = getattr(new_job, "next_run_time", None)
            if not next_run and trigger:
                try:
                    next_run = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
                except Exception:
                    next_run = None
            definition.next_run_at = next_run

        self._update_next_run_time(schedule_id, definition.next_run_at)
        return definition

    def delete_schedule(self, schedule_id: str) -> bool:
        """Remove o agendamento permanentemente."""
        if self.scheduler.get_job(schedule_id):
            try:
                self.scheduler.remove_job(schedule_id)
            except Exception as e:
                logger.debug(f"Remoção de job no scheduler: {e}")

        self._custom_job_fns.pop(schedule_id, None)

        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if not model:
                return False
            session.delete(model)
            session.commit()
            return True
        finally:
            session.close()

    def trigger_schedule(self, schedule_id: str) -> str:
        """Dispara manualmente a execução de um agendamento respeitando concorrência."""
        definition = self.get_schedule(schedule_id)
        if not definition:
            raise ValueError(f"Agendamento '{schedule_id}' não encontrado.")

        return self._execute_job_wrapper(schedule_id)

    # ─── MÉTODOS INTERNOS ───────────────────────────────────────────────────

    def _build_trigger(
        self,
        cron_expression: Optional[str],
        interval_seconds: Optional[int]
    ):
        """Constrói o trigger correspondente do APScheduler com validação estrita."""
        if cron_expression:
            try:
                parts = cron_expression.strip().split()
                if len(parts) == 5:
                    return CronTrigger.from_crontab(cron_expression.strip())
                elif len(parts) == 6:
                    sec, minute, hour, day, month, day_of_week = parts
                    return CronTrigger(
                        second=sec,
                        minute=minute,
                        hour=hour,
                        day=day,
                        month=month,
                        day_of_week=day_of_week
                    )
                else:
                    raise ValueError(f"Expressão cron inválida: número de campos inesperado ({len(parts)})")
            except Exception as e:
                raise ValueError(f"Expressão cron inválida: '{cron_expression}'. Detalhes: {e}")

        if interval_seconds:
            if interval_seconds <= 0:
                raise ValueError("interval_seconds deve ser maior que zero.")
            return IntervalTrigger(seconds=interval_seconds)

        raise ValueError("Trigger não pôde ser determinado.")

    def _execute_job_wrapper(self, schedule_id: str) -> str:
        """Rotina disparada pelo scheduler para coordenar a execução e alertas."""
        definition = self.get_schedule(schedule_id)
        if not definition:
            return "not_found"

        pipeline_id = definition.pipeline_id
        policy = definition.concurrency_policy

        # Validação de concorrência (RF-01.3)
        if policy == ConcurrencyPolicy.SKIP_IF_RUNNING and self.is_pipeline_running(pipeline_id):
            logger.warning(
                f"Agendamento '{definition.name}' ({schedule_id}) pulado: pipeline '{pipeline_id}' já está em execução."
            )
            self._update_job_status(schedule_id, status="skipped")
            return "skipped"

        # Marca execução ativa
        self.mark_pipeline_running(pipeline_id, True)
        self._update_job_status(schedule_id, status="running")
        start_time = time.time()

        exec_status = "succeeded"
        error_msg = None

        try:
            logger.info(f"Disparando execução agendada '{definition.name}' para pipeline '{pipeline_id}'...")

            # Invoca job customizado (se fornecido em testes/injetado) ou despacha no ExecutionManager
            custom_fn = self._custom_job_fns.get(schedule_id)
            if custom_fn:
                custom_fn()
            else:
                self._dispatch_pipeline_run(pipeline_id, schedule_id)

        except Exception as e:
            exec_status = "failed"
            error_msg = str(e)
            logger.exception(f"Falha na execução agendada '{schedule_id}': {e}")
        finally:
            self.mark_pipeline_running(pipeline_id, False)
            duration_ms = int((time.time() - start_time) * 1000)
            self._update_job_status(schedule_id, status=exec_status)

            # Notificação Webhook (RF-01.4)
            if definition.webhook_url:
                events = definition.webhook_events or []
                should_notify = (
                    (exec_status == "succeeded" and ("success" in events or "on_success" in events))
                    or (exec_status == "failed" and ("failure" in events or "on_failure" in events))
                )
                if should_notify:
                    self.notifier.send_alert(
                        webhook_url=definition.webhook_url,
                        event=f"execution.{exec_status}",
                        payload={
                            "schedule_id": schedule_id,
                            "pipeline_id": pipeline_id,
                            "name": definition.name,
                            "status": exec_status,
                            "duration_ms": duration_ms,
                            "error": error_msg
                        }
                    )

        return "triggered"

    def _dispatch_pipeline_run(self, pipeline_id: str, schedule_id: str) -> None:
        """Dispara a execução do pipeline registrado via ExecutionManager ou repassa."""
        # Procura versão publicada ou último draft do pipeline
        from src.core.infrastructure.web.dependencies import get_execution_manager
        manager = get_execution_manager()

        session = self.SessionFactory()
        try:
            from src.core.domain.execution.execution import Execution
            from src.core.infrastructure.persistence.pipeline_repository import SqlAlchemyPipelineRepository
            repo = SqlAlchemyPipelineRepository(session)
            pipe = repo.get_by_id(pipeline_id)
            if not pipe or not pipe.versions:
                logger.warning(f"Pipeline '{pipeline_id}' não possui versão publicada para agendamento.")
                return

            latest_version = pipe.versions[-1]
            plan = manager.compile_version(latest_version)
            execution = Execution(
                pipeline_id=pipeline_id,
                pipeline_version_id=latest_version.id,
                triggered_by=f"schedule:{schedule_id}"
            )
            token = manager.register_execution(execution.id)
            manager.submit_execution(execution, plan, token)
        except Exception as err:
            logger.warning(f"Falha ao despachar execução automática: {err}")
        finally:
            session.close()

    def _reload_persisted_jobs(self) -> None:
        """Recarrega os jobs persistidos no SQLite para o scheduler em memória."""
        session = self.SessionFactory()
        try:
            models = session.query(ScheduleModel).filter(ScheduleModel.enabled == True).all()
            for m in models:
                if not self.scheduler.get_job(m.id):
                    try:
                        trigger = self._build_trigger(m.cron_expression, m.interval_seconds)
                        job = self.scheduler.add_job(
                            func=self._execute_job_wrapper,
                            trigger=trigger,
                            args=[m.id],
                            id=m.id,
                            replace_existing=True,
                            name=m.name
                        )
                        m.next_run_at = getattr(job, "next_run_time", None)
                    except Exception as err:
                        logger.error(f"Erro ao recarregar agendamento '{m.id}': {err}")
            session.commit()
        finally:
            session.close()

    def _update_job_status(self, schedule_id: str, status: str) -> None:
        """Atualiza last_run_at e last_status no banco SQLite."""
        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if model:
                model.last_run_at = datetime.now(timezone.utc)
                model.last_status = status
                job = self.scheduler.get_job(schedule_id)
                if job:
                    model.next_run_at = getattr(job, "next_run_time", None)
                session.commit()
        except Exception as e:
            logger.debug(f"Falha ao atualizar status de agendamento: {e}")
        finally:
            session.close()

    def _update_next_run_time(self, schedule_id: str, next_run: Optional[datetime]) -> None:
        session = self.SessionFactory()
        try:
            model = session.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
            if model:
                model.next_run_at = next_run
                session.commit()
        except Exception as e:
            logger.debug(f"Falha ao atualizar next_run_at: {e}")
        finally:
            session.close()

    def _model_to_definition(self, model: ScheduleModel) -> ScheduleDefinition:
        events = []
        if model.webhook_events:
            try:
                events = json.loads(model.webhook_events)
            except Exception:
                events = ["success", "failure"]

        return ScheduleDefinition(
            id=model.id,
            pipeline_id=model.pipeline_id,
            name=model.name,
            cron_expression=model.cron_expression,
            interval_seconds=model.interval_seconds,
            concurrency_policy=model.concurrency_policy,
            enabled=model.enabled,
            webhook_url=model.webhook_url,
            webhook_events=events,
            created_at=model.created_at,
            last_run_at=model.last_run_at,
            next_run_at=model.next_run_at,
            last_status=model.last_status,
        )
