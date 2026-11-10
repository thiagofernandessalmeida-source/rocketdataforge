"""Motor de Execução de Células Python (PythonCellRunner) do CellFlow Data Studio.

Executa scripts Python em células do tipo PYTHON com suporte a State Handoff
através de um objeto global 'context', permitindo ler saídas de etapas anteriores
(Canvas ou Python) e publicar novos DataFrames Polars / DuckDB para etapas posteriores.
"""

from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime
import io
import logging
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple, Union

import duckdb
import polars as pl

logger = logging.getLogger(__name__)


class PythonCellContext:
    """Objeto de contexto injetado no escopo global do script Python.
    
    Permite interação direta com os dados do Job, recuperação de saídas
    de outras células e publicação da saída da célula atual.
    """

    def __init__(
        self,
        cell_id: str,
        cell_name: str,
        shared_outputs: Optional[Dict[str, Any]] = None,
        variables: Optional[Dict[str, Any]] = None,
        duckdb_con: Optional[duckdb.DuckDBPyConnection] = None,
    ):
        self.cell_id = cell_id
        self.cell_name = cell_name
        self._shared_outputs = shared_outputs if shared_outputs is not None else {}
        self._variables = variables or {}
        self._written_output: Optional[Any] = None
        self._logs: List[Dict[str, Any]] = []
        self._duckdb_con = duckdb_con or duckdb.connect(database=":memory:")
        self._sync_outputs_to_duckdb()

    def _sync_outputs_to_duckdb(self) -> None:
        """Registra DataFrames de saídas compartilhadas como views no DuckDB para consultas SQL."""
        for key, val in self._shared_outputs.items():
            safe_name = key.replace("-", "_").replace(" ", "_")
            if isinstance(val, pl.DataFrame):
                try:
                    arrow_table = val.to_arrow()
                    self._duckdb_con.register(safe_name, arrow_table)
                except Exception as e:
                    logger.debug(f"Não foi possível registrar view DuckDB para '{safe_name}': {e}")

    def read_output(self, cell_id_or_name: str) -> pl.DataFrame:
        """Lê os dados produzidos por uma célula anterior do Job.
        
        Args:
            cell_id_or_name: ID ou Nome da célula (ex: 'canvas-cell-01' ou 'Extracao_Bronze').
            
        Returns:
            pl.DataFrame contendo os dados produzidos pela célula.
        """
        # Busca por chave exata ou normalizada
        target = cell_id_or_name.strip()
        df = self._shared_outputs.get(target)

        if df is None:
            # Tenta variações (com ou sem hífens/underscores)
            normalized_target = target.replace("-", "_").lower()
            for k, v in self._shared_outputs.items():
                if k.replace("-", "_").lower() == normalized_target:
                    df = v
                    break

        if df is None:
            available = list(self._shared_outputs.keys())
            raise KeyError(
                f"Nenhuma saída encontrada para a célula '{cell_id_or_name}'. "
                f"Células disponíveis com saída: {available if available else 'nenhuma'}"
            )

        if isinstance(df, pl.DataFrame):
            return df
        elif isinstance(df, list):
            return pl.DataFrame(df)
        elif isinstance(df, dict):
            return pl.DataFrame([df])
        elif hasattr(df, "to_polars"):
            return df.to_polars()
        elif hasattr(df, "pl"):
            return df.pl()

        raise TypeError(
            f"A saída da célula '{cell_id_or_name}' é do tipo '{type(df).__name__}', "
            f"não compatível diretamente com Polars DataFrame."
        )

    def write_output(self, df_or_data: Any, table_name: Optional[str] = None) -> None:
        """Publica os dados resultantes desta célula para que as próximas células possam consumi-los.
        
        Args:
            df_or_data: Polars DataFrame, lista de dicionários, dicionário ou tabela DuckDB.
            table_name: Nome opcional para registrar no DuckDB (padrão: nome desta célula).
        """
        if isinstance(df_or_data, pl.DataFrame):
            self._written_output = df_or_data
        elif isinstance(df_or_data, list):
            self._written_output = pl.DataFrame(df_or_data)
        elif isinstance(df_or_data, dict):
            self._written_output = pl.DataFrame([df_or_data])
        elif hasattr(df_or_data, "df"):
            # Objeto de resultado DuckDB
            self._written_output = pl.from_arrow(df_or_data.arrow())
        else:
            self._written_output = df_or_data

        # Salva também no dicionário compartilhado sob ID e Nome
        self._shared_outputs[self.cell_id] = self._written_output
        self._shared_outputs[self.cell_name] = self._written_output

        # Registra no DuckDB em memória
        t_name = (table_name or self.cell_name).replace("-", "_").replace(" ", "_")
        if isinstance(self._written_output, pl.DataFrame):
            try:
                self._duckdb_con.register(t_name, self._written_output.to_arrow())
            except Exception:
                pass

    def get_written_output(self) -> Optional[Any]:
        """Retorna a saída gravada por esta célula."""
        return self._written_output

    def log(self, message: str, level: str = "INFO") -> None:
        """Registra uma mensagem no log estruturado da célula."""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "level": level.upper(),
            "message": str(message),
        }
        self._logs.append(entry)
        print(f"[{level.upper()}] {message}")

    @property
    def duckdb(self) -> duckdb.DuckDBPyConnection:
        """Acesso à conexão DuckDB compartilhada."""
        return self._duckdb_con

    @property
    def variables(self) -> Dict[str, Any]:
        """Variáveis de contexto e ambiente disponíveis."""
        return self._variables


class PythonCellRunner:
    """Executor seguro de código Python em memória para células do tipo PYTHON."""

    def __init__(self):
        pass

    def run(
        self,
        code: str,
        context: PythonCellContext,
        timeout_sec: int = 60,
    ) -> Dict[str, Any]:
        """Executa um script Python fornecido injetando o contexto do CellFlow.
        
        Args:
            code: Código fonte Python em texto.
            context: Instância de PythonCellContext com state handoff.
            timeout_sec: Tempo máximo de execução (informativo/cooperativo).
            
        Returns:
            Dicionário com {success, stdout, stderr, error, output_preview, duration_ms}.
        """
        start_time = time.time()
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()

        # Compila primeiro para checar erros de sintaxe antes de executar
        try:
            compiled = compile(code, f"<cell:{context.cell_name}>", "exec")
        except SyntaxError as e:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            tb = traceback.format_exc()
            return {
                "success": False,
                "stdout": "",
                "stderr": tb,
                "error": f"Erro de Sintaxe (linha {e.lineno}): {e.msg}",
                "output_preview": None,
                "duration_ms": duration_ms,
            }

        # Constrói o namespace global isolado
        safe_globals: Dict[str, Any] = {
            "__name__": "__main__",
            "__builtins__": __builtins__,
            "context": context,
            "pl": pl,
            "duckdb": duckdb,
            # Módulos auxiliares úteis frequentemente necessários em data science
            "datetime": datetime,
            "time": time,
            "math": __import__("math"),
            "json": __import__("json"),
            "re": __import__("re"),
        }

        success = True
        error_msg = None

        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            try:
                exec(compiled, safe_globals, safe_globals)
            except Exception as e:
                success = False
                error_msg = str(e)
                traceback.print_exc(file=stderr_buf)

        duration_ms = round((time.time() - start_time) * 1000, 2)
        out_str = stdout_buf.getvalue()
        err_str = stderr_buf.getvalue()

        # Prepara preview da saída caso a célula tenha publicado um DataFrame
        written_output = context.get_written_output()
        output_preview = None

        if isinstance(written_output, pl.DataFrame):
            try:
                row_count = written_output.height
                col_count = written_output.width
                columns = [
                    {"name": col, "type": str(dtype)}
                    for col, dtype in zip(written_output.columns, written_output.dtypes)
                ]
                sample_rows = written_output.head(50).to_dicts()
                output_preview = {
                    "type": "dataframe",
                    "rowCount": row_count,
                    "colCount": col_count,
                    "columns": columns,
                    "sample": sample_rows,
                }
            except Exception as e:
                output_preview = {"type": "raw", "value": f"Erro ao gerar preview do DataFrame: {e}"}
        elif written_output is not None:
            output_preview = {"type": "raw", "value": str(written_output)[:2000]}

        return {
            "success": success,
            "stdout": out_str,
            "stderr": err_str,
            "error": error_msg,
            "output_preview": output_preview,
            "duration_ms": duration_ms,
            "rows_out": written_output.height if isinstance(written_output, pl.DataFrame) else (1 if written_output else 0),
        }
