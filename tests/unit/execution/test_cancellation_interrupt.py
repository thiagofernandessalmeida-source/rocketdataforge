import threading
import time
import pytest
import duckdb
from src.core.infrastructure.execution.cancellation import (
    CancellationToken,
    register_active_connection,
    unregister_active_connection,
    interrupt_execution,
    get_active_connection
)
from src.core.domain.shared.exceptions import DomainError


def test_cancellation_token_interrupts_registered_duckdb_connection():
    """T-1.3: Ao cancelar o CancellationToken, deve chamar conn.interrupt() na conexão DuckDB registrada."""
    conn = duckdb.connect(":memory:")
    token = CancellationToken()
    token.register_connection(conn)

    # Verifica que a conexão foi associada ao token
    assert token.get_connection() is conn

    interrupted = threading.Event()
    error_captured = []

    def long_running_query():
        try:
            # Query pesada de geração de números para dar tempo de ser interrompida
            conn.execute("SELECT count(*) FROM generate_series(1, 500000000) t(x), generate_series(1, 10) u(y)")
        except Exception as e:
            error_captured.append(e)
            interrupted.set()

    t = threading.Thread(target=long_running_query, daemon=True)
    t.start()
    time.sleep(0.05)  # Garante que a query iniciou no DuckDB

    # Dispara o cancelamento
    token.cancel()
    t.join(timeout=3.0)

    assert interrupted.is_set(), "A query deveria ter sido interrompida imediatamente"
    assert len(error_captured) == 1
    err_str = str(error_captured[0]).lower()
    assert "interrupt" in err_str or "cancel" in err_str


def test_global_cancellation_registry_interrupts_by_execution_id():
    """T-1.3: register_active_connection e interrupt_execution por execution_id."""
    exec_id = "exec-test-interrupt-123"
    conn = duckdb.connect(":memory:")

    register_active_connection(exec_id, conn)
    assert get_active_connection(exec_id) is conn

    interrupted = threading.Event()
    error_captured = []

    def long_running_query():
        try:
            conn.execute("SELECT count(*) FROM generate_series(1, 500000000) t(x), generate_series(1, 10) u(y)")
        except Exception as e:
            error_captured.append(e)
            interrupted.set()

    t = threading.Thread(target=long_running_query, daemon=True)
    t.start()
    time.sleep(0.05)

    success = interrupt_execution(exec_id)
    assert success is True
    t.join(timeout=3.0)

    assert interrupted.is_set()
    unregister_active_connection(exec_id)
    assert get_active_connection(exec_id) is None
