"""Módulo de aquecimento (warm-up) assíncrono em background para o motor de execução.

Carrega previamente em memória as bibliotecas analíticas pesadas (DuckDB, Polars, SQLGlot,
conectores e compilador de expressões) para eliminar a latência de importação (cold start)
na primeira execução de células do Canvas.
"""

import time
import logging
import threading
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

_is_warm: bool = False
_warmup_details: Dict[str, Any] = {
    "warm": False,
    "duration_ms": 0,
    "duckdb": False,
    "polars": False,
    "expressions": False,
    "connectors": False,
    "error": None,
}
_warmup_thread: Optional[threading.Thread] = None
_lock = threading.Lock()


def is_backend_warm() -> bool:
    """Retorna se o aquecimento do backend foi concluído com sucesso."""
    with _lock:
        return _is_warm


def get_warmup_details() -> Dict[str, Any]:
    """Retorna os detalhes de tempo e módulos aquecidos."""
    with _lock:
        return dict(_warmup_details)


def run_warmup() -> Dict[str, Any]:
    """Executa o aquecimento das dependências analíticas principais de forma síncrona."""
    global _is_warm, _warmup_details
    start_time = time.perf_counter()
    details: Dict[str, Any] = {
        "warm": False,
        "duration_ms": 0,
        "duckdb": False,
        "polars": False,
        "expressions": False,
        "connectors": False,
        "error": None,
    }

    try:
        # 1. Pré-carregar DuckDB e executar query trivial in-memory
        try:
            import duckdb
            con = duckdb.connect(":memory:")
            con.execute("SELECT 1 AS warmup").fetchall()
            con.close()
            details["duckdb"] = True
        except Exception as e:
            logger.warning(f"[Warmup] Falha no aquecimento DuckDB: {e}")

        # 2. Pré-carregar Polars
        try:
            import polars as pl
            _ = pl.DataFrame({"a": [1, 2], "b": [3, 4]})
            details["polars"] = True
        except Exception as e:
            logger.warning(f"[Warmup] Falha no aquecimento Polars: {e}")

        # 3. Pré-carregar compilador de expressões AST e sqlglot
        try:
            import sqlglot
            from src.core.application.compiler.expressions.compiler import compile_expression
            _ = compile_expression("row1.val > 10 ? 'A' : 'B'")
            details["expressions"] = True
        except Exception as e:
            logger.warning(f"[Warmup] Falha no aquecimento de expressões/sqlglot: {e}")

        # 4. Pré-carregar conectores essenciais e engines
        try:
            from src.core.infrastructure.connectors.file_connector import LocalFileConnector
            from src.core.infrastructure.connectors.postgres_connector import PostgresConnector
            from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
            details["connectors"] = True
        except Exception as e:
            logger.warning(f"[Warmup] Falha no aquecimento de conectores: {e}")

        duration_ms = int((time.perf_counter() - start_time) * 1000)
        details["duration_ms"] = duration_ms
        details["warm"] = details["duckdb"] and details["polars"] and details["expressions"]

        with _lock:
            _is_warm = details["warm"]
            _warmup_details = dict(details)

        logger.info(f"[Warmup] Motor aquecido em {duration_ms}ms (DuckDB={details['duckdb']}, Polars={details['polars']}, Expr={details['expressions']})")
        return details

    except Exception as exc:
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        details["duration_ms"] = duration_ms
        details["error"] = str(exc)
        with _lock:
            _is_warm = False
            _warmup_details = dict(details)
        logger.error(f"[Warmup] Erro inesperado durante aquecimento: {exc}")
        return details


def start_background_warmup() -> threading.Thread:
    """Inicia o aquecimento em uma thread desacoplada daemon para não bloquear a inicialização da API."""
    global _warmup_thread
    with _lock:
        if _warmup_thread is not None and _warmup_thread.is_alive():
            return _warmup_thread
        t = threading.Thread(target=run_warmup, name="rdf-warmup", daemon=True)
        _warmup_thread = t
        t.start()
        return t
