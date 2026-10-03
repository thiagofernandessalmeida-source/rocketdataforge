"""Status e regras de transição da Máquina de Estados de Execução.
"""

from enum import Enum


class ExecutionStatus(str, Enum):
    """Estados canônicos do ciclo de vida de uma execução."""
    CREATED = "created"
    PLANNING = "planning"
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

    def is_active(self) -> bool:
        return self not in {ExecutionStatus.CANCELLED, ExecutionStatus.SUCCEEDED, ExecutionStatus.FAILED}


TERMINAL_STATUSES = {
    ExecutionStatus.CANCELLED,
    ExecutionStatus.SUCCEEDED,
    ExecutionStatus.FAILED
}

# Mapa explícito de transições válidas
VALID_TRANSITIONS = {
    ExecutionStatus.CREATED: {ExecutionStatus.PLANNING, ExecutionStatus.CANCELLING, ExecutionStatus.FAILED},
    ExecutionStatus.PLANNING: {ExecutionStatus.QUEUED, ExecutionStatus.CANCELLING, ExecutionStatus.FAILED},
    ExecutionStatus.QUEUED: {ExecutionStatus.RUNNING, ExecutionStatus.CANCELLING, ExecutionStatus.FAILED},
    ExecutionStatus.RUNNING: {
        ExecutionStatus.SUCCEEDED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLING
    },
    ExecutionStatus.CANCELLING: {ExecutionStatus.CANCELLED, ExecutionStatus.FAILED},
    ExecutionStatus.CANCELLED: set(),
    ExecutionStatus.SUCCEEDED: set(),
    ExecutionStatus.FAILED: set()
}


def is_terminal_status(status: ExecutionStatus) -> bool:
    """Verifica se o status é terminal."""
    return status in TERMINAL_STATUSES


def is_valid_transition(current: ExecutionStatus, target: ExecutionStatus) -> bool:
    """Valida se a transição entre dois estados é permitida."""
    return target in VALID_TRANSITIONS.get(current, set())
