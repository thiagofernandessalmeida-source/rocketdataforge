"""Rotas REST para Agendamentos de Tarefas e Webhooks (Spec 006 - Fase 1)."""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.core.infrastructure.scheduler.scheduler_service import (
    ConcurrencyPolicy,
    ScheduleCreate,
    SchedulerService,
)

router = APIRouter(prefix="/schedules", tags=["Schedules & Automation"])


class ScheduleCreateDTO(BaseModel):
    pipeline_id: str = Field(..., description="ID do pipeline a ser agendado")
    name: str = Field(..., description="Nome amigável do agendamento")
    cron_expression: Optional[str] = Field(None, description="Expressão cron padrão (5 ou 6 posições)")
    interval_seconds: Optional[int] = Field(None, description="Intervalo fixo em segundos")
    concurrency_policy: ConcurrencyPolicy = Field(
        default=ConcurrencyPolicy.SKIP_IF_RUNNING,
        description="Política de concorrência: ALLOW, SKIP_IF_RUNNING, QUEUE"
    )
    enabled: bool = Field(True, description="Se o agendamento já inicia habilitado")
    webhook_url: Optional[str] = Field(None, description="URL do webhook para notificações")
    webhook_events: List[str] = Field(
        default=["success", "failure"],
        description="Eventos que acionam webhook"
    )


class ScheduleResponseDTO(BaseModel):
    id: str
    pipeline_id: str
    name: str
    cron_expression: Optional[str] = None
    interval_seconds: Optional[int] = None
    concurrency_policy: str
    enabled: bool
    webhook_url: Optional[str] = None
    webhook_events: List[str] = []
    created_at: Optional[str] = None
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    last_status: Optional[str] = None


@router.post("", response_model=ScheduleResponseDTO, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleCreateDTO):
    """Cria um novo agendamento com expressão cron ou intervalo."""
    scheduler = SchedulerService.get_instance()
    try:
        data = ScheduleCreate(
            pipeline_id=payload.pipeline_id,
            name=payload.name,
            cron_expression=payload.cron_expression,
            interval_seconds=payload.interval_seconds,
            concurrency_policy=payload.concurrency_policy,
            enabled=payload.enabled,
            webhook_url=payload.webhook_url,
            webhook_events=payload.webhook_events,
        )
        schedule = scheduler.create_schedule(data)
        return schedule.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("", response_model=List[ScheduleResponseDTO])
def list_schedules(pipeline_id: Optional[str] = Query(None, description="Filtrar por pipeline")):
    """Lista todos os agendamentos registrados."""
    scheduler = SchedulerService.get_instance()
    schedules = scheduler.list_schedules(pipeline_id=pipeline_id)
    return [s.to_dict() for s in schedules]


@router.get("/{schedule_id}", response_model=ScheduleResponseDTO)
def get_schedule(schedule_id: str):
    """Obtém detalhes de um agendamento específico."""
    scheduler = SchedulerService.get_instance()
    schedule = scheduler.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agendamento não encontrado.")
    return schedule.to_dict()


@router.post("/{schedule_id}/pause", response_model=ScheduleResponseDTO)
def pause_schedule(schedule_id: str):
    """Pausa o agendamento."""
    scheduler = SchedulerService.get_instance()
    try:
        schedule = scheduler.pause_schedule(schedule_id)
        return schedule.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{schedule_id}/resume", response_model=ScheduleResponseDTO)
def resume_schedule(schedule_id: str):
    """Retoma um agendamento pausado."""
    scheduler = SchedulerService.get_instance()
    try:
        schedule = scheduler.resume_schedule(schedule_id)
        return schedule.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{schedule_id}/trigger")
def trigger_schedule(schedule_id: str):
    """Dispara o agendamento imediatamente (Run Now)."""
    scheduler = SchedulerService.get_instance()
    try:
        result = scheduler.trigger_schedule(schedule_id)
        return {"schedule_id": schedule_id, "status": result}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: str):
    """Exclui permanentemente um agendamento."""
    scheduler = SchedulerService.get_instance()
    deleted = scheduler.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agendamento não encontrado.")
    return None
