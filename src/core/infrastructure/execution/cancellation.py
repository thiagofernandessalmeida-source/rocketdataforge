"""Token de Cancelamento Cooperativo (CancellationToken) e Interrupção DuckDB.

Permite interrupção atômica e segura entre fronteiras de chunks, operadores e
execução física síncrona no DuckDB através de conn.interrupt().
"""

import logging
import threading
from typing import Any, Dict, Optional

from src.core.domain.shared.exceptions import DomainError

logger = logging.getLogger(__name__)

# Registro global thread-safe de conexões ativas mapeadas por execution_id
_active_connections: Dict[str, Any] = {}
_registry_lock = threading.RLock()


def register_active_connection(execution_id: str, conn: Any) -> None:
    """Registra uma conexão ativa (ex: DuckDBPyConnection) para um execution_id."""
    with _registry_lock:
        _active_connections[execution_id] = conn
        logger.debug(f"[Cancellation] Conexão ativa registrada para execution_id={execution_id}")


def unregister_active_connection(execution_id: str) -> None:
    """Remove a conexão ativa associada ao execution_id."""
    with _registry_lock:
        if execution_id in _active_connections:
            del _active_connections[execution_id]
            logger.debug(f"[Cancellation] Conexão ativa desregistrada para execution_id={execution_id}")


def get_active_connection(execution_id: str) -> Optional[Any]:
    """Retorna a conexão ativa associada ao execution_id se existir."""
    with _registry_lock:
        return _active_connections.get(execution_id)


def interrupt_execution(execution_id: str) -> bool:
    """Invoca conn.interrupt() de forma thread-safe na conexão DuckDB ativa do execution_id.
    
    Retorna True se uma conexão foi encontrada e interrompida, False caso contrário.
    """
    with _registry_lock:
        conn = _active_connections.get(execution_id)
        if conn is not None:
            try:
                if hasattr(conn, "interrupt"):
                    conn.interrupt()
                    logger.info(f"[Cancellation] conn.interrupt() invocado com sucesso para execution_id={execution_id}")
                    return True
            except Exception as e:
                logger.warning(f"[Cancellation] Erro ao invocar interrupt na conexão de {execution_id}: {e}")
                return False
    return False


class CancellationToken:
    """Token thread-safe para sinalização de cancelamento cooperativo e interrupção física."""

    def __init__(self) -> None:
        self._cancelled = threading.Event()
        self._conn: Optional[Any] = None
        self._lock = threading.RLock()

    def register_connection(self, conn: Optional[Any]) -> None:
        """Registra a conexão física DuckDB associada à thread de execução deste token."""
        with self._lock:
            self._conn = conn
            if self._cancelled.is_set() and conn is not None and hasattr(conn, "interrupt"):
                try:
                    conn.interrupt()
                except Exception as e:
                    logger.warning(f"[CancellationToken] Erro ao interromper conexão recém-registrada: {e}")

    def get_connection(self) -> Optional[Any]:
        """Retorna a conexão física associada a este token."""
        with self._lock:
            return self._conn

    def cancel(self) -> None:
        """Sinaliza pedido de cancelamento e interrompe a conexão física DuckDB se registrada."""
        self._cancelled.set()
        with self._lock:
            if self._conn is not None and hasattr(self._conn, "interrupt"):
                try:
                    self._conn.interrupt()
                    logger.info("[CancellationToken] conn.interrupt() chamado com sucesso.")
                except Exception as e:
                    logger.warning(f"[CancellationToken] Falha ao interromper conexão: {e}")

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
