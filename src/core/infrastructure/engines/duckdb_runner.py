import logging
import os
import re
import threading
from typing import Any, Dict, List, Optional

import duckdb
import polars as pl
from src.core.domain.shared.exceptions import DomainError

logger = logging.getLogger(__name__)


class DuckDBRunner:
    """Executor relacional de alto desempenho baseado em DuckDB."""

    def __init__(
        self,
        memory_limit: str = "512MB",
        temp_directory: Optional[str] = None,
        database_path: Optional[str] = None
    ):
        self.memory_limit = memory_limit
        self.temp_directory = temp_directory
        self.database_path = database_path
        self._conn: Optional[duckdb.DuckDBPyConnection] = None
        self._write_lock = threading.RLock()

    def get_connection(self) -> duckdb.DuckDBPyConnection:
        """Obtém ou inicializa a conexão com DuckDB com configurações de limite de memória."""
        if self._conn is None:
            db_target = self.database_path or ":memory:"
            self._conn = duckdb.connect(db_target)
            self._conn.execute(f"SET max_memory = '{self.memory_limit}';")
            if self.temp_directory:
                self._conn.execute(f"SET temp_directory = '{self.temp_directory}';")
        return self._conn

    def register_dataframe(self, view_name: str, df: pl.DataFrame) -> None:
        """Registra um DataFrame Polars/Arrow como uma view temporária no DuckDB."""
        conn = self.get_connection()
        arrow_table = df.to_arrow()
        conn.register(view_name, arrow_table)

    def execute_query_to_polars(self, query: str, conn: Optional[duckdb.DuckDBPyConnection] = None) -> pl.DataFrame:
        """Executa consulta SQL e retorna o resultado como um DataFrame Polars."""
        active_conn = conn or self.get_connection()
        try:
            arrow_table = active_conn.execute(query).arrow()
            return pl.from_arrow(arrow_table)
        except Exception as e:
            raise DomainError(f"Erro ao executar consulta no DuckDB: {str(e)}", code="ERR_ENGINE_DUCKDB")

    def execute_query_on_file(
        self,
        file_path: str,
        format_hint: str = "csv",
        custom_query: Optional[str] = None,
        format: Optional[str] = None,
        query: Optional[str] = None
    ) -> pl.DataFrame:
        """Executa consulta analítica diretamente em um arquivo (CSV, Parquet, JSON) via DuckDB."""
        clean_path = file_path.replace("\\", "/")
        fmt = (format or format_hint).lower()
        effective_query = query if query is not None else custom_query
        conn = self.get_connection()

        if fmt == "parquet" or clean_path.endswith(".parquet"):
            read_fn = f"read_parquet('{clean_path}')"
        elif fmt == "json" or clean_path.endswith(".json") or clean_path.endswith(".jsonl") or clean_path.endswith(".ndjson"):
            read_fn = f"read_json_auto('{clean_path}')"
        else:
            read_fn = f"read_csv_auto('{clean_path}')"

        if effective_query and effective_query.strip():
            # Cria view temporária 'source_data' e executa a query do usuário
            try:
                conn.execute(f"CREATE OR REPLACE TEMPORARY VIEW source_data AS SELECT * FROM {read_fn};")
                conn.execute(f"CREATE OR REPLACE TEMPORARY VIEW this_table AS SELECT * FROM source_data;")
                return self.execute_query_to_polars(effective_query, conn=conn)
            except Exception as e:
                raise DomainError(f"Erro ao executar query DuckDB no arquivo '{clean_path}': {str(e)}", code="ERR_ENGINE_DUCKDB")
        else:
            return self.execute_query_to_polars(f"SELECT * FROM {read_fn}", conn=conn)

    def execute_query_on_database(self, database_path: str, query: str, read_only: bool = True, fetch_size: Optional[int] = None) -> pl.DataFrame:
        """Executa consulta em um banco de dados DuckDB (.duckdb ou :memory:)."""
        db_path = database_path or self.database_path or ":memory:"
        if db_path != ":memory:" and not os.path.exists(db_path) and not read_only:
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

        try:
            conn = duckdb.connect(db_path, read_only=read_only and os.path.exists(db_path) and db_path != ":memory:")
            return self.execute_query_to_polars(query, conn=conn)
        except Exception as e:
            raise DomainError(f"Falha ao executar query no banco DuckDB '{db_path}': {str(e)}", code="ERR_DUCKDB_DATABASE")

    def execute_query_chunks_on_database(
        self,
        database_path: str,
        query: str,
        fetch_size: int = 10000,
        read_only: bool = True
    ) -> List[pl.DataFrame]:
        """Executa consulta em DuckDB retornando lista de chunks paginados (Fetch Size) sem carregar toda a tabela de uma vez."""
        db_path = database_path or self.database_path or ":memory:"
        if db_path != ":memory:" and not os.path.exists(db_path) and not read_only:
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

        try:
            conn = duckdb.connect(db_path, read_only=read_only and os.path.exists(db_path) and db_path != ":memory:")
            cur = conn.cursor()
            cur.execute(query)
            col_names = [d[0] for d in cur.description] if cur.description else ["result"]
            chunks: List[pl.DataFrame] = []

            while True:
                batch = cur.fetchmany(fetch_size)
                if not batch:
                    break
                from src.core.infrastructure.engines.polars_runner import batch_to_polars_df
                chunk_df = batch_to_polars_df(batch, col_names)
                chunks.append(chunk_df)

            if not chunks:
                chunks.append(pl.DataFrame({c: [] for c in col_names}))

            conn.close()
            return chunks
        except Exception as e:
            raise DomainError(f"Falha ao executar query no banco DuckDB '{db_path}': {str(e)}", code="ERR_DUCKDB_DATABASE")

    def materialize_cell_output(self, cell_id: str, df: pl.DataFrame) -> str:
        """Materializa o DataFrame de saída da célula como tabela/view compartilhada no DuckDB em memória."""
        clean_cell = cell_id.replace("-", "_").lower()
        view_name = f"cell_output_{clean_cell}"
        with self._write_lock:
            self.register_dataframe(view_name, df)
            # Também cria uma tabela/view sem prefixo se viável
            conn = self.get_connection()
            try:
                conn.execute(f"CREATE OR REPLACE TEMPORARY TABLE {view_name} AS SELECT * FROM {view_name};")
            except Exception:
                pass
        return view_name

    def get_cell_output(self, cell_id: str) -> pl.DataFrame:
        """Recupera o DataFrame resultante da execução de uma célula anterior."""
        clean_cell = cell_id.replace("-", "_").lower()
        view_name = f"cell_output_{clean_cell}"
        with self._write_lock:
            return self.execute_query_to_polars(f"SELECT * FROM {view_name};")

    def write_to_duckdb(
        self,
        df: pl.DataFrame,
        table_name: str,
        database_path: Optional[str] = None,
        table_action: str = "none",
        data_action: str = "insert",
        keys: Optional[List[str]] = None,
        is_first_chunk: bool = True,
        schema_definitions: Optional[List[Dict[str, Any]]] = None,
        use_batch_mode: bool = True,
        batch_size: int = 10000
    ) -> int:
        """Grava dados no banco DuckDB com suporte a ações de tabela, dados e escrita em lotes particionados (Batch Mode)."""
        with self._write_lock:
            if len(df.columns) == 0:
                logger.warning(f"write_to_duckdb: DataFrame fornecido para a tabela '{table_name}' não possui colunas. Nenhuma operação executada.")
                return 0

            db_path = database_path or self.database_path or ":memory:"
            if db_path != ":memory:":
                os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

            conn = duckdb.connect(db_path)
            arrow_table = df.to_arrow()
            conn.register("_chunk_batch", arrow_table)

            # Inspeciona tabela existente
            existing_col_info = {}
            try:
                col_rows = conn.execute(f"PRAGMA table_info('{table_name}');").fetchall()
                existing_col_info = {r[1]: str(r[2]).upper() for r in col_rows}
            except Exception:
                existing_col_info = {}

            # Se a tabela já existir no primeiro chunk, verifica se está vazia com tipos obsoletos/incompatíveis
            if is_first_chunk and existing_col_info:
                try:
                    row_cnt = conn.execute(f"SELECT COUNT(*) FROM {table_name};").fetchone()[0]
                    if row_cnt == 0:
                        type_mismatch = False
                        for col_name, dtype in df.schema.items():
                            if col_name in existing_col_info:
                                db_type = existing_col_info[col_name]
                                # Se o dado atual for String/Utf8 mas a tabela DuckDB vazia tiver guardado como número
                                if dtype in (pl.Utf8, pl.Categorical) and any(n in db_type for n in ("INT", "FLOAT", "DOUBLE", "NUMERIC")):
                                    type_mismatch = True
                                    break
                        if type_mismatch or table_action in ("drop_create", "drop_if_exists_create"):
                            logger.info(f"Tabela '{table_name}' vazia com tipos incompatíveis detectada. Recriando estrutura com schema correto...")
                            conn.execute(f"DROP TABLE IF EXISTS {table_name};")
                            existing_col_info = {}
                except Exception:
                    pass

            # 1. Executa Ação na Tabela apenas no primeiro chunk
            if is_first_chunk:
                if table_action in ("drop_create", "drop_if_exists_create"):
                    conn.execute(f"DROP TABLE IF EXISTS {table_name};")
                    conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                    existing_col_info = {c: True for c in df.columns}
                elif table_action == "create_if_not_exists" and not existing_col_info:
                    conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                    existing_col_info = {c: True for c in df.columns}
                elif table_action in ("truncate", "delete_all"):
                    try:
                        conn.execute(f"DELETE FROM {table_name};")
                    except Exception:
                        conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                        existing_col_info = {c: True for c in df.columns}

            # Garante que a tabela existe antes de inserir
            try:
                conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1;")
            except Exception:
                conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                existing_col_info = {c: True for c in df.columns}

            # Monta SQL de inserção com colunas explícitas para garantir mapeamento nominal
            try:
                table_cols = [r[1] for r in conn.execute(f"PRAGMA table_info('{table_name}');").fetchall()]
            except Exception:
                table_cols = list(df.columns)

            matching_cols = [c for c in df.columns if c in table_cols]
            if matching_cols:
                cols_str = ", ".join([f'"{c}"' for c in matching_cols])
                insert_clause = f"({cols_str}) SELECT {cols_str} FROM _chunk_batch"
            else:
                insert_clause = "SELECT * FROM _chunk_batch"

            # 2. Executa Ação nos Dados com Suporte a Batch Mode
            if use_batch_mode and batch_size > 0 and df.height > batch_size:
                total_written = 0
                for start_idx in range(0, df.height, batch_size):
                    slice_df = df.slice(start_idx, batch_size)
                    conn.register("_chunk_batch", slice_df.to_arrow())
                    if data_action == "insert":
                        conn.execute(f"INSERT INTO {table_name} {insert_clause};")
                    elif data_action in ("upsert", "update_or_insert", "insert_or_update") and keys:
                        join_cond = " AND ".join([f"{table_name}.\"{k}\" = _chunk_batch.\"{k}\"" for k in keys if k in df.columns])
                        if join_cond:
                            conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
                        conn.execute(f"INSERT INTO {table_name} {insert_clause};")
                    elif data_action == "delete" and keys:
                        join_cond = " AND ".join([f"{table_name}.\"{k}\" = _chunk_batch.\"{k}\"" for k in keys if k in df.columns])
                        if join_cond:
                            conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
                    else:
                        conn.execute(f"INSERT INTO {table_name} {insert_clause};")
                    total_written += slice_df.height
                conn.close()
                return total_written
            else:
                if data_action == "insert":
                    conn.execute(f"INSERT INTO {table_name} {insert_clause};")
                elif data_action in ("upsert", "update_or_insert", "insert_or_update") and keys:
                    join_cond = " AND ".join([f"{table_name}.\"{k}\" = _chunk_batch.\"{k}\"" for k in keys if k in df.columns])
                    if join_cond:
                        conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
                    conn.execute(f"INSERT INTO {table_name} {insert_clause};")
                elif data_action == "delete" and keys:
                    join_cond = " AND ".join([f"{table_name}.\"{k}\" = _chunk_batch.\"{k}\"" for k in keys if k in df.columns])
                    if join_cond:
                        conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
                else:
                    conn.execute(f"INSERT INTO {table_name} {insert_clause};")

                conn.close()
                return df.height

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

    @staticmethod
    def transpile_expression(expr: str, known_columns: Optional[List[str]] = None) -> str:
        """Converte expressões com sintaxe mista (Java/Talend/Python/SQL) para DuckDB SQL analítico válido.
        
        Suporta:
        - Namespaces / Aliasing preservados (main.col, row1.col, lk_regiao.cidade, Var.total)
        - Casts e Parsing de Java (Integer.parseInt, String.valueOf, (String)col, col.toString(), etc.)
        - Operadores lógicos booleanos Java convertidos ANTES da concatenação de strings
        - Concatenação Java (str1 + " " + str2 -> str1 || ' ' || str2) sem quebrar matemática numérica
        - Operador ternário aninhado ((cond) ? a : b -> CASE WHEN (cond) THEN a ELSE b END)
        - Window Functions e Utilitários Talend (Numeric.sequence, previous, Relational.isNull, etc.)
        """
        if not expr or not expr.strip():
            return "NULL"

        import re
        s = expr.strip()

        # ─── 1. Funções de Janela / Variáveis Stateful estilo Talend ───
        s = re.sub(r'\bNumeric\.sequence\s*\([^)]*\)', 'ROW_NUMBER() OVER ()', s)
        s = re.sub(r'\b(?:sequence|row_number)\s*\(\s*\)', 'ROW_NUMBER() OVER ()', s, flags=re.IGNORECASE)
        s = re.sub(
            r'\b(?:previous|prev|lag)\s*\(\s*([^,\)]+)(?:\s*,\s*(\d+))?\s*\)',
            lambda m: f'LAG({m.group(1).strip()}, {m.group(2) or 1}) OVER (ORDER BY _tmap_main_idx)',
            s,
            flags=re.IGNORECASE
        )
        s = re.sub(
            r'\b(?:next|lead)\s*\(\s*([^,\)]+)(?:\s*,\s*(\d+))?\s*\)',
            lambda m: f'LEAD({m.group(1).strip()}, {m.group(2) or 1}) OVER (ORDER BY _tmap_main_idx)',
            s,
            flags=re.IGNORECASE
        )
        s = re.sub(
            r'\b(?:running_sum|accumulate|sum_accum)\s*\(\s*([^,\)]+)\s*\)',
            r'SUM(\1) OVER (ORDER BY _tmap_main_idx)',
            s,
            flags=re.IGNORECASE
        )

        # ─── 2. Conversões e Casts de Tipos Estilo Java (Parsing & Casting) ───
        s = re.sub(r'\bString\.valueOf\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS VARCHAR)', s)
        s = re.sub(r'([a-zA-Z0-9_\.\"]+)\.toString\(\)', r'TRY_CAST(\1 AS VARCHAR)', s)
        s = re.sub(r'\((?:String|java\.lang\.String)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS VARCHAR)', s)

        s = re.sub(r'\bInteger\.parseInt\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS INTEGER)', s)
        s = re.sub(r'\((?:Integer|int)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS INTEGER)', s)
        s = re.sub(r'\bLong\.parseLong\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS BIGINT)', s)
        s = re.sub(r'\((?:Long|long)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS BIGINT)', s)
        s = re.sub(r'\bDouble\.parseDouble\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS DOUBLE)', s)
        s = re.sub(r'\((?:Double|double)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS DOUBLE)', s)
        s = re.sub(r'\bFloat\.parseFloat\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS FLOAT)', s)
        s = re.sub(r'\((?:Float|float)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS FLOAT)', s)
        s = re.sub(r'\bBoolean\.parseBoolean\s*\(\s*([^\)]+)\s*\)', r'TRY_CAST(\1 AS BOOLEAN)', s)
        s = re.sub(r'\((?:Boolean|bool|boolean)\)\s*([a-zA-Z0-9_\.\"]+)', r'TRY_CAST(\1 AS BOOLEAN)', s)

        # ─── 3. Funções Utilitárias Talend (StringHandling, Relational, TalendDate) ───
        s = re.sub(r'\bStringHandling\.UPCASE\s*\(\s*([^\)]+)\s*\)', r'UPPER(\1)', s)
        s = re.sub(r'\bStringHandling\.DOWNCASE\s*\(\s*([^\)]+)\s*\)', r'LOWER(\1)', s)
        s = re.sub(r'\bStringHandling\.TRIM\s*\(\s*([^\)]+)\s*\)', r'TRIM(\1)', s)
        s = re.sub(r'!\s*Relational\.isNull\s*\(\s*([^\)]+)\s*\)', r'\1 IS NOT NULL', s)
        s = re.sub(r'\bRelational\.isNull\s*\(\s*([^\)]+)\s*\)', r'\1 IS NULL', s)

        # ─── 4. OPERADORES LÓGICOS BOOLEANOS (EXECUTA ANTES DA CONCATENAÇÃO DE STRINGS) ───
        s = re.sub(r'==\s*null\b', ' IS NULL', s, flags=re.IGNORECASE)
        s = re.sub(r'!=\s*null\b', ' IS NOT NULL', s, flags=re.IGNORECASE)
        s = re.sub(r'==', '=', s)
        s = re.sub(r'&&', ' AND ', s)
        # Protege temporariamente a concatenação SQL de strings ('...' || ou || '...')
        s = re.sub(r"'\s*\|\|", "' __SQL_CONCAT__ ", s)
        s = re.sub(r"\|\|\s*'", " __SQL_CONCAT__ '", s)
        # Transforma qualquer '||' restante em ' OR ' (operador lógico Java)
        s = re.sub(r"\s*\|\|\s*", " OR ", s)
        # Restaura a concatenação SQL
        s = s.replace("__SQL_CONCAT__", "||")

        # ─── 5. CONCATENAÇÃO DE STRINGS ESTILO JAVA (str1 + " " + str2 -> str1 || ' ' || str2) ───
        # Converte aspas duplas de strings constantes Java ("...") para aspas simples SQL ('...')
        s = re.sub(r'"([^"\n\r]*)"', r"'\1'", s)
        # Substitui '+' adjacente a aspas simples por '||' (preserva adições numéricas puras como col + 500)
        s = re.sub(r"'\s*\+\s*", r"' || ", s)
        s = re.sub(r"\s*\+\s*'", r" || '", s)

        # ─── 6. Preservação de Namespaces (alias.coluna -> "alias.coluna") ───
        # Desempacota tags/tokens do tipo {{node.col}} ou {node.col}
        s = re.sub(r'\{\{\s*([a-zA-Z0-9_\-]+)\.([^\}]+)\s*\}\}', r'\1.\2', s)
        s = re.sub(r'\{([a-zA-Z0-9_\-]+)\.([^\}]+)\}', r'\1.\2', s)

        # Se houver colunas conhecidas, prioriza a substituição exata de prefix.coluna (suporta colunas com espaços)
        if known_columns:
            for col in sorted(known_columns, key=len, reverse=True):
                esc_col = re.escape(col)
                pattern = rf'(?<!")\b([a-zA-Z0-9_]+)\.(?:"{esc_col}"|\'{esc_col}\'|{esc_col})(?=\b|\s|[\(\)\+\-\*\/\,\<\>\=\!\?\'"]|$)(?!")'
                s = re.sub(pattern, rf'"\1.{col}"', s)

        s = re.sub(r'(?<!")\b([a-zA-Z0-9_]+)\.["\']([^"\']+)["\']', r'"\1.\2"', s)
        s = re.sub(r'(?<!")\b([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b(?!")', r'"\1.\2"', s)
        # Limpeza defensiva de chaves residuais em tokens
        s = re.sub(r'\{\{\s*"?([a-zA-Z0-9_\-]+)"?\."?([^\}"]+)"?\s*\}\}', r'"\1.\2"', s)
        s = re.sub(r'\{\s*"?([a-zA-Z0-9_\-]+)"?\."?([^\}"]+)"?\s*\}', r'"\1.\2"', s)

        # Se houver colunas conhecidas sem prefixo, coloca entre aspas se necessário
        if known_columns:
            for col in sorted(known_columns, key=len, reverse=True):
                if s == col:
                    s = f'"{col}"'
                    break

        # ─── 7. Operador Ternário (If/Else): (cond) ? valor_v : valor_f ───
        ternary_pattern = re.compile(r'([^?]+?)\s*\?\s*([^?:]+?)\s*:\s*([^,;)]+)')
        for _ in range(5):
            new_s = ternary_pattern.sub(r'CASE WHEN \1 THEN \2 ELSE \3 END', s)
            if new_s == s:
                break
            s = new_s

        return s

    def execute_tmap_transform(
        self,
        main_df: pl.DataFrame,
        lookups: List[Dict[str, Any]],
        lookup_dfs: Dict[str, pl.DataFrame],
        variables: List[Dict[str, Any]],
        outputs: List[Dict[str, Any]],
        main_alias: str = "row1",
        **kwargs: Any
    ) -> Dict[str, pl.DataFrame]:
        """Executa a transformação completa do tMap usando DuckDB com suporte a Namespaces e Aliasing."""
        if not outputs:
            clean_cols = [c for c in main_df.columns if not c.startswith("_tmap")]
            empty_df = pl.DataFrame({c: [] for c in clean_cols}) if clean_cols else pl.DataFrame()
            fallback_df = main_df if main_df.height > 0 else empty_df
            return {"main": fallback_df, "out1": fallback_df, "output": fallback_df}

        if main_df.height == 0:
            empty_results = {}
            for i, out in enumerate(outputs):
                out_name = out.get("name") or f"out_{i+1}"
                cols = out.get("columns", [])
                if cols:
                    col_names = [c.get("name") or c.get("target") or f"col_{j}" for j, c in enumerate(cols)]
                elif len(main_df.columns) > 0:
                    col_names = [c for c in main_df.columns if not c.startswith("_tmap")]
                else:
                    col_names = []
                
                if col_names:
                    empty_results[out_name] = pl.DataFrame({c: [] for c in col_names})
                else:
                    empty_results[out_name] = pl.DataFrame()
            return empty_results

        # Coleta todas as colunas conhecidas para auxílio na resolução
        known_cols = list(main_df.columns)
        for lk_df in lookup_dfs.values():
            for c in lk_df.columns:
                if c not in known_cols:
                    known_cols.append(c)
        for v in variables:
            v_name = v.get("name")
            if v_name and v_name not in known_cols:
                known_cols.append(v_name)

        conn = duckdb.connect(":memory:")

        # ─── 1. Criação das Views com Aliases do Fluxo Principal (Main) ───
        main_alias_raw = kwargs.get("main_alias") or main_alias or "row1"
        main_alias_safe = re.sub(r'[^a-zA-Z0-9_]', '_', str(main_alias_raw).strip()) or "row1"

        conn.register("_main_raw", main_df.to_arrow())
        conn.execute(f"""
            CREATE TEMPORARY VIEW {main_alias_safe} AS 
            SELECT *, ROW_NUMBER() OVER () as _tmap_main_idx 
            FROM _main_raw;
        """)
        if main_alias_safe != "main":
            conn.execute(f"CREATE TEMPORARY VIEW main AS SELECT * FROM {main_alias_safe};")
        if main_alias_safe != "row1":
            conn.execute(f"CREATE TEMPORARY VIEW row1 AS SELECT * FROM {main_alias_safe};")

        # Constrói tabela de trabalho inicial com colunas prefixadas e livres
        main_init_cols = []
        for c in main_df.columns:
            main_init_cols.append(f'"{c}" AS "{main_alias_safe}.{c}"')
            if main_alias_safe != "main":
                main_init_cols.append(f'"{c}" AS "main.{c}"')
            if main_alias_safe != "row1":
                main_init_cols.append(f'"{c}" AS "row1.{c}"')
            main_init_cols.append(f'"{c}" AS "{c}"')

        main_node_id = kwargs.get("main_node_id") or kwargs.get("main_id")
        if main_node_id:
            safe_main_node_id = re.sub(r'[^a-zA-Z0-9_]', '_', str(main_node_id).strip())
            for c in main_df.columns:
                main_init_cols.append(f'"{c}" AS "{safe_main_node_id}.{c}"')
                if safe_main_node_id != str(main_node_id):
                    main_init_cols.append(f'"{c}" AS "{main_node_id}.{c}"')

        main_init_cols.append("_tmap_main_idx")
        init_cols_sql = ", ".join(main_init_cols)
        conn.execute(f"CREATE TEMPORARY TABLE _tmap_working AS SELECT {init_cols_sql} FROM {main_alias_safe};")

        # ─── 2. Processa cada Lookup com Views Nomeadas, Joins, Filtros e Match Models ───
        inner_join_checks = []

        for idx, lk in enumerate(lookups):
            node_id = lk.get("node_id") or lk.get("id") or ""
            raw_alias = lk.get("alias") or lk.get("label") or f"row{idx+2}"
            safe_lk_alias = re.sub(r'[^a-zA-Z0-9_]', '_', str(raw_alias).strip()) or f"row{idx+2}"
            lk_df = lookup_dfs.get(node_id, pl.DataFrame())

            if lk_df.height == 0:
                continue

            conn.register(f"_{safe_lk_alias}_raw", lk_df.to_arrow())

            # Filtro pré-join do Lookup
            raw_lk_filter = (lk.get("lookup_filter") or lk.get("filter") or "").strip()
            if raw_lk_filter:
                transpiled_filter = self.transpile_expression(raw_lk_filter, known_columns=known_cols)
                conn.execute(f"""
                    CREATE TEMPORARY VIEW _{safe_lk_alias}_filtered AS 
                    SELECT *, ROW_NUMBER() OVER () as _lk_row_id 
                    FROM _{safe_lk_alias}_raw 
                    WHERE ({transpiled_filter});
                """)
            else:
                conn.execute(f"""
                    CREATE TEMPORARY VIEW _{safe_lk_alias}_filtered AS 
                    SELECT *, ROW_NUMBER() OVER () as _lk_row_id 
                    FROM _{safe_lk_alias}_raw;
                """)

            # Match Model (all, first, unique/last)
            match_model = str(lk.get("match_model", "all")).lower()
            right_keys = lk.get("right_keys", [])
            left_keys = lk.get("left_keys", [])

            # Limpa e sanitiza as colunas de partição para o deduplicador do DuckDB
            clean_part_cols = []
            for k in right_keys:
                raw_k = str(k).strip().strip('"').strip("'")
                raw_k = re.sub(r'^\{\{?|\}\}?$', '', raw_k).strip()
                col_name = raw_k.split(".")[-1].strip().strip('"').strip("'")
                if col_name in lk_df.columns:
                    clean_part_cols.append(f'"{col_name}"')
                elif raw_k in lk_df.columns:
                    clean_part_cols.append(f'"{raw_k}"')
                elif col_name:
                    clean_part_cols.append(f'"{col_name}"')

            part_cols = ", ".join(clean_part_cols)

            if clean_part_cols and "first" in match_model:
                conn.execute(f"""
                    CREATE TEMPORARY VIEW _{safe_lk_alias}_dedup AS
                    SELECT * EXCLUDE (_rn) FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY _lk_row_id ASC) as _rn
                        FROM _{safe_lk_alias}_filtered
                    ) WHERE _rn = 1;
                """)
            elif clean_part_cols and ("unique" in match_model or "last" in match_model):
                conn.execute(f"""
                    CREATE TEMPORARY VIEW _{safe_lk_alias}_dedup AS
                    SELECT * EXCLUDE (_rn) FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY _lk_row_id DESC) as _rn
                        FROM _{safe_lk_alias}_filtered
                    ) WHERE _rn = 1;
                """)
            else:
                conn.execute(f"CREATE TEMPORARY VIEW _{safe_lk_alias}_dedup AS SELECT * FROM _{safe_lk_alias}_filtered;")

            # Cria Views temporárias com o Alias do Lookup
            conn.execute(f"CREATE TEMPORARY VIEW {safe_lk_alias} AS SELECT * FROM _{safe_lk_alias}_dedup;")
            if safe_lk_alias != f"row{idx+2}":
                conn.execute(f"CREATE TEMPORARY VIEW row{idx+2} AS SELECT * FROM _{safe_lk_alias}_dedup;")

            # ─── Montagem Dinâmica do Join (Chaves Transpiladas + Join Filter) ───
            join_clauses = []

            # 1. Chaves de Junção (Left Keys x Right Keys) com suporte a expressões
            if left_keys and right_keys:
                for lk_k, rk_k in zip(left_keys, right_keys):
                    raw_left = str(lk_k).strip()
                    clean_raw_left = re.sub(r'^\{\{?|\}\}?$', '', raw_left).strip()
                    t_left = self.transpile_expression(clean_raw_left, known_columns=known_cols)
                    clean_left = clean_raw_left.strip('"').strip("'")
                    col_left = clean_left.split(".")[-1].strip().strip('"').strip("'")

                    if clean_left in known_cols or f"{main_alias_safe}.{col_left}" in known_cols:
                        t_left = f'_tmap_working."{clean_left}"'
                    elif re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', clean_raw_left) or re.match(r'^"[^"]+"$', t_left):
                        t_left = f'_tmap_working."{clean_left}"'

                    raw_right = str(rk_k).strip()
                    clean_raw_right = re.sub(r'^\{\{?|\}\}?$', '', raw_right).strip()
                    t_right = self.transpile_expression(clean_raw_right, known_columns=known_cols)
                    clean_right = clean_raw_right.strip('"').strip("'")
                    col_right = clean_right.split(".")[-1].strip().strip('"').strip("'")

                    if col_right in lk_df.columns:
                        t_right = f'{safe_lk_alias}."{col_right}"'
                    elif clean_right in lk_df.columns:
                        t_right = f'{safe_lk_alias}."{clean_right}"'
                    elif re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', clean_right) or re.match(r'^"[^"]+"$', t_right):
                        t_right = f'{safe_lk_alias}."{clean_right}"'

                    join_clauses.append(f"({t_left}) = ({t_right})")

            # 2. Join Filter (Filtro Condicional Adicional no ON do Join)
            raw_join_filter = (lk.get("join_filter") or lk.get("filter_expression") or "").strip()
            if raw_join_filter:
                t_join_filter = self.transpile_expression(raw_join_filter, known_columns=known_cols)
                t_join_filter = re.sub(r'\b(main|row1|_tmap_working)\.', '_tmap_working.', t_join_filter, flags=re.IGNORECASE)
                t_join_filter = re.sub(rf'\b({re.escape(node_id)}|lk|lookup|{safe_lk_alias})\.', f'{safe_lk_alias}.', t_join_filter, flags=re.IGNORECASE)
                join_clauses.append(f"({t_join_filter})")

            join_cond = " AND ".join(join_clauses) if join_clauses else "1=1"
            join_model = str(lk.get("join_model", "left_outer")).lower()
            has_match_col = f"_has_match_{idx+1}"

            # Projeção das colunas do lookup com namespace para evitar colisão no DuckDB
            lk_proj_cols = []
            safe_node_id = re.sub(r'[^a-zA-Z0-9_]', '_', str(node_id).strip()) if node_id else ""
            for c in lk_df.columns:
                lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{safe_lk_alias}.{c}"')
                if safe_lk_alias != f"row{idx+2}":
                    lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "row{idx+2}.{c}"')
                if node_id and safe_node_id != safe_lk_alias:
                    lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{safe_node_id}.{c}"')
                    if safe_node_id != str(node_id):
                        lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{node_id}.{c}"')
                raw_lk_label = lk.get("label")
                if raw_lk_label:
                    safe_lk_label = re.sub(r'[^a-zA-Z0-9_]', '_', str(raw_lk_label).strip())
                    if safe_lk_label not in (safe_lk_alias, f"row{idx+2}", safe_node_id):
                        lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{safe_lk_label}.{c}"')
                if c not in main_df.columns:
                    lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{c}"')
            lk_proj_sql = (", " + ", ".join(lk_proj_cols)) if lk_proj_cols else ""

            # Realiza Left Join e cria flag indicadora de match
            conn.execute(f"""
                CREATE TEMPORARY TABLE _tmap_step_{idx+1} AS
                SELECT 
                    _tmap_working.*
                    {lk_proj_sql},
                    CASE WHEN {safe_lk_alias}._lk_row_id IS NOT NULL THEN 1 ELSE 0 END AS {has_match_col}
                FROM _tmap_working
                LEFT JOIN {safe_lk_alias} ON {join_cond};
            """)
            conn.execute("DROP TABLE _tmap_working;")
            conn.execute(f"ALTER TABLE _tmap_step_{idx+1} RENAME TO _tmap_working;")

            if join_model == "inner":
                inner_join_checks.append(f"{has_match_col} = 1")

        # ─── 3. Computa Variáveis Intermediárias (Var) em Ordem Sequencial ───
        for v_idx, var in enumerate(variables):
            var_name = var.get("name")
            var_expr = var.get("expression", "")
            if var_name and var_expr:
                transpiled_v = self.transpile_expression(var_expr, known_columns=known_cols)
                try:
                    conn.execute(f"""
                        CREATE TEMPORARY TABLE _tmap_var_step_{v_idx} AS
                        SELECT *, 
                               ({transpiled_v}) AS "Var.{var_name}",
                               ({transpiled_v}) AS "{var_name}"
                        FROM _tmap_working;
                    """)
                    conn.execute("DROP TABLE _tmap_working;")
                    conn.execute(f"ALTER TABLE _tmap_var_step_{v_idx} RENAME TO _tmap_working;")
                except Exception as e:
                    conn.execute(f'ALTER TABLE _tmap_working ADD COLUMN "Var.{var_name}" VARCHAR;')
                    conn.execute(f'ALTER TABLE _tmap_working ADD COLUMN "{var_name}" VARCHAR;')

        # ─── 4. Processa Tabelas de Saída e Rejeições ───
        results: Dict[str, pl.DataFrame] = {}
        standard_filter_conditions: List[str] = []

        # Primeiro passa pelas saídas normais para coletar os filtros
        for out in outputs:
            is_catch_output = out.get("catch_output_reject", False)
            is_catch_inner = out.get("catch_inner_join_reject", False)
            if not is_catch_output and not is_catch_inner:
                f_expr = out.get("filter_expression", "").strip()
                if f_expr:
                    standard_filter_conditions.append(f"({self.transpile_expression(f_expr, known_columns=known_cols)})")

        for idx, out in enumerate(outputs):
            out_name = out.get("name") or f"out_{idx+1}"
            is_catch_output = out.get("catch_output_reject", False)
            is_catch_inner = out.get("catch_inner_join_reject", False)
            filter_expr = out.get("filter_expression", "").strip()
            cols = out.get("columns", [])

            # Constrói cláusula WHERE
            where_clauses = []

            if is_catch_inner:
                if inner_join_checks:
                    where_clauses.append("NOT (" + " AND ".join(inner_join_checks) + ")")
                else:
                    where_clauses.append("1=0")
            elif is_catch_output:
                if inner_join_checks:
                    where_clauses.extend(inner_join_checks)
                if standard_filter_conditions:
                    where_clauses.append("NOT (" + " OR ".join(standard_filter_conditions) + ")")
                else:
                    where_clauses.append("1=0")
            else:
                if inner_join_checks:
                    where_clauses.extend(inner_join_checks)
                if filter_expr:
                    where_clauses.append(f"({self.transpile_expression(filter_expr, known_columns=known_cols)})")

            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""

            # Constrói projeção SELECT
            if cols:
                select_items = []
                for c in cols:
                    target_name = c.get("name") or c.get("target") or "col"
                    raw_expr = c.get("expression") or target_name
                    trans_expr = self.transpile_expression(raw_expr, known_columns=known_cols)
                    select_items.append(f'({trans_expr}) AS "{target_name}"')
                select_sql = ", ".join(select_items)
            else:
                exclude_cols = ["_tmap_main_idx"] + [f"_has_match_{i+1}" for i in range(len(lookups))]
                exclude_clause = f" EXCLUDE ({', '.join(exclude_cols)})"
                select_sql = f"*{exclude_clause}"

            query = f"SELECT {select_sql} FROM _tmap_working{where_sql};"
            try:
                out_df = self.execute_query_to_polars(query, conn=conn)
            except Exception as e:
                raise DomainError(
                    f"Falha na execução da saída '{out_name}' do Data Mapper (tMap): {str(e)} (Query: {query})",
                    code="ERR_ENGINE_DUCKDB"
                )

            results[out_name] = out_df

        conn.close()
        return results

    def close(self) -> None:
        """Fecha a conexão e libera recursos de memória."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None


