"""Token de Cancelamento Cooperativo (CancellationToken).

Permite interrupção atômica e segura entre fronteiras de chunks e operadores.
"""

import threading
from src.core.domain.shared.exceptions import DomainError


class CancellationToken:
    """Token thread-safe para sinalização de cancelamento cooperativo."""

    def __init__(self) -> None:
        self._cancelled = threading.Event()

    def cancel(self) -> None:
        """Sinaliza pedido de cancelamento."""
        self._cancelled.set()

    def is_cancelled(self) -> bool:
        """Verifica se o cancelamento foi solicitado."""
        return self._cancelled.is_set()

    def check_cancelled(self) -> None:
        """Lança exceção de cancelamento caso o token tenha sido acionado."""
        if self.is_cancelled():
            raise DomainError(
                "A execução foi interrompida cooperativamente a pedido do usuário.",
                code="ERR_EXECUTION_CANCELLED"
            )
