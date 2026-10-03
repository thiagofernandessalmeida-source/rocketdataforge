"""Entidade TaskRun.

Representa a execução e telemetria de um nó individual dentro de uma Execution.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.shared.exceptions import DomainValidationError


@dataclass
class TaskRun:
    """Telemetria e status da execução de um nó de pipeline."""
    node_id: str
    status: ExecutionStatus = ExecutionStatus.CREATED
    rows_in: int = 0
    rows_out: int = 0
    rejected_count: int = 0
    duration_ms: Optional[int] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.node_id or not self.node_id.strip():
            raise DomainValidationError("TaskRun node_id não pode ser vazio")
        if self.rows_in < 0 or self.rows_out < 0 or self.rejected_count < 0:
            raise DomainValidationError("Contadores de linhas em TaskRun não podem ser negativos")

    def record_progress(self, rows_in_increment: int = 0, rows_out_increment: int = 0, rejected_increment: int = 0) -> None:
        """Incrementa de forma atômica o progresso de dados processados."""
        if rows_in_increment < 0 or rows_out_increment < 0 or rejected_increment < 0:
            raise DomainValidationError("Incrementos de progresso não podem ser negativos")
        self.rows_in += rows_in_increment
        self.rows_out += rows_out_increment
        self.rejected_count += rejected_increment

    def complete(self, finished_at: datetime) -> None:
        """Finaliza a tarefa com sucesso."""
        self.status = ExecutionStatus.SUCCEEDED
        self.finished_at = finished_at
        if self.started_at:
            self.duration_ms = int((finished_at - self.started_at).total_seconds() * 1000)

    def fail(self, finished_at: datetime, error_code: str, error_message: str) -> None:
        """Marca a tarefa como falha com erro normalizado."""
        self.status = ExecutionStatus.FAILED
        self.finished_at = finished_at
        self.error_code = error_code
        self.error_message = error_message
        if self.started_at:
            self.duration_ms = int((finished_at - self.started_at).total_seconds() * 1000)
