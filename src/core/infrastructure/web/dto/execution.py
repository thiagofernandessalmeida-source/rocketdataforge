"""DTOs para Execuções, Status, Métricas e Logs."""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class ExecutionResponse(BaseModel):
    execution_id: str
    status: str
    correlation_id: str


class TaskRunDetail(BaseModel):
    node_id: str
    status: str
    rows_in: int = 0
    rows_out: int = 0
    duration_ms: Optional[int] = None
    error_message: Optional[str] = None


class ExecutionDetail(BaseModel):
    execution_id: str
    pipeline_version_id: str
    status: str
    attempt: int = 1
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    tasks: List[TaskRunDetail] = Field(default_factory=list)


class LogEntry(BaseModel):
    timestamp: datetime
    level: str
    execution_id: str
    node_id: Optional[str] = None
    message: str
