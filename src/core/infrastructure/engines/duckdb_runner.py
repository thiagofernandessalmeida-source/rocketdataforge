"""Motor de Execução DuckDB (DuckDBRunner).

Executa consultas relacionais, joins e operações analíticas com suporte nativo a
leitura de arquivos e spill-to-disk.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import duckdb
import polars as pl
from src.core.domain.shared.exceptions import DomainError


class DuckDBRunner:
    """Executor relacional de alto desempenho baseado em DuckDB."""

    def __init__(self, memory_limit: str = "512MB", temp_directory: Optional[str] = None):
        self.memory_limit = memory_limit
        self.temp_directory = temp_directory
        self._conn: Optional[duckdb.DuckDBPyConnection] = None

    def get_connection(self) -> duckdb.DuckDBPyConnection:
        """Obtém ou inicializa a conexão com DuckDB com configurações de limite de memória."""
        if self._conn is None:
            self._conn = duckdb.connect(":memory:")
            self._conn.execute(f"SET max_memory = '{self.memory_limit}';")
            if self.temp_directory:
                self._conn.execute(f"SET temp_directory = '{self.temp_directory}';")
        return self._conn

    def register_dataframe(self, view_name: str, df: pl.DataFrame) -> None:
        """Registra um DataFrame Polars/Arrow como uma view temporária no DuckDB."""
        conn = self.get_connection()
        # DuckDB consome PyArrow/Polars com interoperabilidade zero-copy
        arrow_table = df.to_arrow()
        conn.register(view_name, arrow_table)

    def execute_query_to_polars(self, query: str) -> pl.DataFrame:
        """Executa consulta SQL e retorna o resultado como um DataFrame Polars."""
        conn = self.get_connection()
        try:
            arrow_table = conn.execute(query).arrow()
            return pl.from_arrow(arrow_table)
        except Exception as e:
            raise DomainError(f"Erro ao executar consulta no DuckDB: {str(e)}", code="ERR_ENGINE_DUCKDB")

    def execute_join(
        self,
        left_df: pl.DataFrame,
        right_df: pl.DataFrame,
        left_keys: List[str],
        right_keys: List[str],
        join_type: str = "inner"
    ) -> pl.DataFrame:
        """Executa junção relacional entre dois DataFrames via DuckDB."""
        self.register_dataframe("left_table", left_df)
        self.register_dataframe("right_table", right_df)

        join_conditions = " AND ".join([
            f'left_table."{lk}" = right_table."{rk}"'
            for lk, rk in zip(left_keys, right_keys)
        ])

        sql_join_type = {
            "inner": "INNER JOIN",
            "left": "LEFT OUTER JOIN",
            "right": "RIGHT OUTER JOIN",
            "full": "FULL OUTER JOIN"
        }.get(join_type.lower(), "INNER JOIN")

        query = f"""
            SELECT *
            FROM left_table
            {sql_join_type} right_table
            ON {join_conditions}
        """

        return self.execute_query_to_polars(query)

    def close(self) -> None:
        """Fecha a conexão e libera recursos de memória."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None
