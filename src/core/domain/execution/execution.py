"""Agregado Execution.

Aggregate Root responsável pelo ciclo de vida, transições de estado,
telemetria e cancelamento cooperativo de uma execução de pipeline.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.core.domain.execution.status import (
    ExecutionStatus,
    is_terminal_status,
    is_valid_transition,
)
from src.core.domain.execution.task_run import TaskRun
from src.core.domain.shared.exceptions import (
    DomainValidationError,
    InvalidStateTransitionError,
)


@dataclass
class Execution:
    """Aggregate Root de Execução de Pipeline."""
    id: str
    pipeline_version_id: str
    correlation_id: str
    status: ExecutionStatus = ExecutionStatus.CREATED
    attempt: int = 1
    tasks: Dict[str, TaskRun] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_details: Optional[Dict[str, Any]] = None

    def __post_init__(self) -> None:
        if not self.id or not self.id.strip():
            raise DomainValidationError("Execution id não pode ser vazio")
        if not self.pipeline_version_id or not self.pipeline_version_id.strip():
            raise DomainValidationError("Execution pipeline_version_id não pode ser vazio")
        if not self.correlation_id or not self.correlation_id.strip():
            raise DomainValidationError("Execution correlation_id é obrigatório para rastreabilidade")
        if self.attempt < 1:
            raise DomainValidationError("Execution attempt deve ser >= 1")

    def transition_to(self, new_status: ExecutionStatus) -> None:
        """Transita de estado validando estritamente a FSM."""
        if not is_valid_transition(self.status, new_status):
            raise InvalidStateTransitionError(
                current_state=self.status.value,
                target_state=new_status.value
            )
        self.status = new_status

    def start_planning(self) -> None:
        """Inicia a fase de compilação dos planos."""
        self.transition_to(ExecutionStatus.PLANNING)

    def mark_queued(self) -> None:
        """Marca a execução como enfileirada para o worker."""
        self.transition_to(ExecutionStatus.QUEUED)

    def start_running(self) -> None:
        """Inicia o processamento no worker."""
        self.transition_to(ExecutionStatus.RUNNING)
        self.started_at = datetime.now(timezone.utc)

    def succeed(self) -> None:
        """Finaliza a execução com sucesso."""
        self.transition_to(ExecutionStatus.SUCCEEDED)
        self.finished_at = datetime.now(timezone.utc)

    def fail(self, error_code: str, error_message: str, details: Optional[Dict[str, Any]] = None) -> None:
        """Finaliza a execução como falha."""
        self.transition_to(ExecutionStatus.FAILED)
        self.finished_at = datetime.now(timezone.utc)
        self.error_details = {
            "code": error_code,
            "message": error_message,
            "details": details or {}
        }

    def request_cancellation(self) -> None:
        """Solicita cancelamento de forma estritamente cooperativa e idempotente."""
        # Se já estiver em cancelamento ou cancelado, é idempotente
        if self.status in {ExecutionStatus.CANCELLING, ExecutionStatus.CANCELLED}:
            return

        # Se já terminou em SUCCEEDED ou FAILED, não cancela o que já concluiu
        if is_terminal_status(self.status):
            return

        self.transition_to(ExecutionStatus.CANCELLING)

    def complete_cancellation(self) -> None:
        """Confirma a conclusão do cancelamento pelo worker."""
        self.transition_to(ExecutionStatus.CANCELLED)
        self.finished_at = datetime.now(timezone.utc)

    def add_task(self, node_id: str) -> TaskRun:
        """Registra um nó para monitoramento de execução."""
        if node_id in self.tasks:
            raise DomainValidationError(f"Task para nó '{node_id}' já está registrada")
        task = TaskRun(node_id=node_id)
        self.tasks[node_id] = task
        return task

    def get_task(self, node_id: str) -> TaskRun:
        """Obtém a task de um nó."""
        if node_id not in self.tasks:
            raise DomainValidationError(f"Task para nó '{node_id}' não encontrada")
        return self.tasks[node_id]
