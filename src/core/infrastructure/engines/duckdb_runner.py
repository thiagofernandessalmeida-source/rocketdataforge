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

    @classmethod
    def compile_tmap_expression(
        cls,
        expr: str,
        alias_map: Optional[Dict[str, Dict[str, Any]]] = None,
        vars_map: Optional[Dict[str, str]] = None,
        known_columns: Optional[List[str]] = None
    ) -> str:
        """Transpila expressões tMap para DuckDB SQL com resolução case-insensitive de aliases e colunas."""
        if not expr or not expr.strip():
            return "NULL"

        s = expr.strip()
        alias_map = alias_map or {}
        vars_map = vars_map or {}

        # 1. Transpila sintaxes padrão (Java, operadores lógicos, strings, ternários, sequências)
        s = cls.transpile_expression(s, known_columns=known_columns)

        # 2. Desempacota tags/tokens do tipo {{alias.col}} ou {alias.col}
        s = re.sub(r'\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}', r'\1', s)
        s = re.sub(r'\{\s*([a-zA-Z0-9_\-\.]+)\s*\}', r'\1', s)

        # 3. Remove aspas externas em torno de identificadores com ponto para normalização
        s = re.sub(r'"([a-zA-Z0-9_\-]+)\.([^"\n]+)"', r'\1.\2', s)

        # 4. Tratamento de Variáveis (Var.var_name ou var_name direto)
        def replace_var(m):
            v_name = m.group(1)
            return f'_tmap_working."Var.{v_name}"'

        s = re.sub(r'\bVar\.([a-zA-Z0-9_]+)\b', replace_var, s)

        for v_name in vars_map.values():
            pattern = rf'(?<!_tmap_working\.)(?<![\."\'])\b({re.escape(v_name)})\b(?![\."\'])'
            s = re.sub(pattern, rf'_tmap_working."{v_name}"', s)

        # 5. Substituição determinística baseada no alias_map e nos nomes reais das colunas
        for alias, info in alias_map.items():
            col_map = info.get("columns", {})
            table_ref = info.get("table_ref", "_tmap_working")
            for col_lower, real_col in sorted(col_map.items(), key=lambda x: len(x[0]), reverse=True):
                esc_col = re.escape(real_col)
                esc_lower = re.escape(col_lower)
                col_patterns = f'"{esc_col}"|\'{esc_col}\'|{esc_col}'
                if esc_lower != esc_col:
                    col_patterns += f'|"{esc_lower}"|\'{esc_lower}\'|{esc_lower}'
                pattern = rf'(?<!_tmap_working\.)(?<!")\b{re.escape(alias)}\.(?:{col_patterns})(?!")'

                if table_ref == "_tmap_working":
                    replacement = rf'_tmap_working."{alias.lower()}.{col_lower}"'
                else:
                    replacement = rf'{table_ref}."{real_col}"'
                s = re.sub(pattern, replacement, s, flags=re.IGNORECASE)

        # 6. Fallback para aliases/colunas remanescentes
        def replace_fallback(m):
            raw_alias = m.group(1).lower()
            raw_col = m.group(2).strip('"').strip("'").lower()
            if raw_alias in alias_map:
                table_ref = alias_map[raw_alias].get("table_ref", "_tmap_working")
                if table_ref == "_tmap_working":
                    return f'_tmap_working."{raw_alias}.{raw_col}"'
                else:
                    return f'{table_ref}."{raw_col}"'
            return m.group(0)

        s = re.sub(r'(?<!_tmap_working\.)(?<!")\b([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_]+)\b(?!")', replace_fallback, s)

        s = s.replace('""', '"')
        return s

    def execute_tmap_transform(
        self,
        main_df: pl.DataFrame,
        lookups: List[Dict[str, Any]],
        lookup_dfs: Dict[str, pl.DataFrame],
        variables: List[Dict[str, Any]],
        outputs: List[Dict[str, Any]],
        main_alias: str = "main",
        **kwargs: Any
    ) -> Dict[str, pl.DataFrame]:
        """Executa a transformação completa do tMap usando DuckDB com suporte a Namespaces, Aliasing e Match Models."""
        if not outputs:
            clean_cols = [c for c in main_df.columns if not c.startswith("_tmap")]
            empty_df = pl.DataFrame({c: [] for c in clean_cols}) if clean_cols else pl.DataFrame()
            fallback_df = main_df if main_df.height > 0 else empty_df
            return {"main": fallback_df, "out1": fallback_df, "output": fallback_df}

        if main_df.height == 0:
            empty_results = {}
            for i, out in enumerate(outputs):
                out_name = out.get("name") or out.get("id") or f"out_{i+1}"
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

        # ─── 1. Criação das Views e Tabela de Trabalho do Fluxo Principal (Main) ───
        main_alias_raw = kwargs.get("main_alias") or main_alias or "main"
        main_alias_safe = re.sub(r'[^a-zA-Z0-9_]', '_', str(main_alias_raw).strip()) or "main"

        conn.register("_main_raw", main_df.to_arrow())
        conn.execute(f"""
            CREATE TEMPORARY VIEW {main_alias_safe} AS 
            SELECT *, ROW_NUMBER() OVER () as _tmap_main_idx 
            FROM _main_raw;
        """)
        if main_alias_safe.lower() != "main":
            conn.execute(f"CREATE TEMPORARY VIEW main AS SELECT * FROM {main_alias_safe};")
        if main_alias_safe.lower() != "row1":
            conn.execute(f"CREATE TEMPORARY VIEW row1 AS SELECT * FROM {main_alias_safe};")

        # Monta alias_map e vars_map para resolução insensível a maiúsculas/minúsculas
        alias_map: Dict[str, Dict[str, Any]] = {}
        main_col_map = {c.lower(): c for c in main_df.columns}

        main_aliases = {main_alias_safe.lower(), "main", "row1"}
        main_node_id = kwargs.get("main_node_id") or kwargs.get("main_id")
        if main_node_id:
            main_aliases.add(str(main_node_id).lower())
            main_aliases.add(re.sub(r'[^a-zA-Z0-9_]', '_', str(main_node_id).strip()).lower())

        for ma in main_aliases:
            alias_map[ma] = {"table_ref": "_tmap_working", "columns": main_col_map}

        # Constrói tabela de trabalho inicial com colunas prefixadas e livres (suporte a UPPER/lower)
        main_init_cols = []
        for c in main_df.columns:
            c_low = c.lower()
            main_init_cols.append(f'"{c}" AS "{c}"')
            if c_low != c:
                main_init_cols.append(f'"{c}" AS "{c_low}"')

            for ma in main_aliases:
                main_init_cols.append(f'"{c}" AS "{ma}.{c}"')
                if c_low != c:
                    main_init_cols.append(f'"{c}" AS "{ma}.{c_low}"')

        main_init_cols.append("_tmap_main_idx")
        main_init_cols.append("ROW_NUMBER() OVER () as _step_0_row_id")
        init_cols_sql = ", ".join(main_init_cols)
        conn.execute(f"CREATE TEMPORARY TABLE _tmap_working AS SELECT {init_cols_sql} FROM {main_alias_safe};")

        # ─── 2. Processa cada Lookup com Views, Joins, Filtros e Match Models ───
        inner_join_checks = []

        for idx, lk in enumerate(lookups):
            node_id = lk.get("node_id") or lk.get("id") or ""
            raw_alias = lk.get("alias") or lk.get("label") or f"lkp{idx+1}"
            safe_lk_alias = re.sub(r'[^a-zA-Z0-9_]', '_', str(raw_alias).strip()) or f"lkp{idx+1}"
            lk_df = lookup_dfs.get(node_id, pl.DataFrame())

            if lk_df.height == 0:
                continue

            conn.register(f"_{safe_lk_alias}_raw", lk_df.to_arrow())
            lk_col_map = {c.lower(): c for c in lk_df.columns}

            lk_aliases = {safe_lk_alias.lower(), f"row{idx+2}".lower(), f"lkp{idx+1}".lower()}
            if node_id:
                lk_aliases.add(str(node_id).lower())
                lk_aliases.add(re.sub(r'[^a-zA-Z0-9_]', '_', str(node_id).strip()).lower())
            if lk.get("label"):
                lk_aliases.add(str(lk.get("label")).lower())

            for la in lk_aliases:
                alias_map[la] = {"table_ref": "_tmap_working", "columns": lk_col_map}

            # Filtro pré-join do Lookup
            raw_lk_filter = (lk.get("lookup_filter") or lk.get("filter") or "").strip()
            where_lk_sql = ""
            if raw_lk_filter:
                transpiled_filter = self.compile_tmap_expression(raw_lk_filter, alias_map=alias_map, known_columns=known_cols)
                where_lk_sql = f"WHERE ({transpiled_filter})"

            conn.execute(f"""
                CREATE TEMPORARY VIEW _{safe_lk_alias}_prepared AS 
                SELECT *, 
                       ROW_NUMBER() OVER () as _lkp_row_order,
                       1 as _lkp_{safe_lk_alias}_matched
                FROM _{safe_lk_alias}_raw
                {where_lk_sql};
            """)
            conn.execute(f"CREATE TEMPORARY VIEW {safe_lk_alias} AS SELECT * FROM _{safe_lk_alias}_prepared;")

            # ─── Chaves de Junção (Left Keys / expr_key x Right Keys / column) ───
            join_keys = lk.get("join_keys", [])
            left_keys = lk.get("left_keys", [])
            right_keys = lk.get("right_keys", [])

            key_pairs = []
            if join_keys:
                for jk in join_keys:
                    ek = jk.get("expr_key") or jk.get("left") or ""
                    rc = jk.get("column") or jk.get("right") or ""
                    if ek and rc:
                        key_pairs.append((str(ek).strip(), str(rc).strip()))
            elif left_keys and right_keys:
                for lk_k, rk_k in zip(left_keys, right_keys):
                    key_pairs.append((str(lk_k).strip(), str(rk_k).strip()))

            join_clauses = []
            for raw_left, raw_right in key_pairs:
                clean_raw_left = re.sub(r'^\{\{?|\}\}?$', '', raw_left).strip()
                t_left = self.compile_tmap_expression(clean_raw_left, alias_map=alias_map, known_columns=known_cols)
                clean_left = clean_raw_left.strip('"').strip("'")
                if "_tmap_working." not in t_left:
                    if "." not in clean_left:
                        t_left = f'_tmap_working."{clean_left}"'
                    else:
                        prefix_left, col_left = clean_left.split(".", 1)
                        if prefix_left.lower() in alias_map:
                            t_left = f'_tmap_working."{prefix_left.lower()}.{col_left.lower()}"'

                clean_raw_right = re.sub(r'^\{\{?|\}\}?$', '', raw_right).strip().strip('"').strip("'")
                if "." in clean_raw_right:
                    col_right_name = clean_raw_right.split(".")[-1].strip().strip('"').strip("'")
                else:
                    col_right_name = clean_raw_right

                real_right_col = lk_col_map.get(col_right_name.lower(), col_right_name)
                t_right = f'{safe_lk_alias}."{real_right_col}"'

                join_clauses.append(f"({t_left}) = ({t_right})")

            # Join Filter no ON
            raw_join_filter = (lk.get("join_filter") or lk.get("filter_expression") or "").strip()
            if raw_join_filter:
                t_join_filter = self.compile_tmap_expression(raw_join_filter, alias_map=alias_map, known_columns=known_cols)
                join_clauses.append(f"({t_join_filter})")

            join_cond = " AND ".join(join_clauses) if join_clauses else "1=1"

            # Match Model (all, first, unique/last)
            match_model = str(lk.get("match_model") or "all").lower()
            qualify_clause = ""
            if "first" in match_model:
                qualify_clause = f"QUALIFY ROW_NUMBER() OVER (PARTITION BY _tmap_working._step_{idx}_row_id ORDER BY {safe_lk_alias}._lkp_row_order ASC NULLS LAST) = 1"
            elif "unique" in match_model or "last" in match_model:
                qualify_clause = f"QUALIFY ROW_NUMBER() OVER (PARTITION BY _tmap_working._step_{idx}_row_id ORDER BY {safe_lk_alias}._lkp_row_order DESC NULLS LAST) = 1"

            # Projeção das colunas do lookup com namespace para evitar colisão
            lk_proj_cols = []
            for c in lk_df.columns:
                c_low = c.lower()
                for la in lk_aliases:
                    lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{la}.{c}"')
                    if c_low != c:
                        lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{la}.{c_low}"')

                if c not in main_df.columns and c_low not in [m.lower() for m in main_df.columns]:
                    lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{c}"')
                    if c_low != c:
                        lk_proj_cols.append(f'{safe_lk_alias}."{c}" AS "{c_low}"')

            lk_proj_sql = (", " + ", ".join(lk_proj_cols)) if lk_proj_cols else ""
            has_match_col = f"_has_match_{idx+1}"
            lk_matched_indicator = f"_lkp_{safe_lk_alias}_matched"

            conn.execute(f"""
                CREATE TEMPORARY TABLE _tmap_step_{idx+1} AS
                SELECT 
                    _tmap_working.*
                    {lk_proj_sql},
                    CASE WHEN {safe_lk_alias}._lkp_row_order IS NOT NULL THEN 1 ELSE 0 END AS {has_match_col},
                    CASE WHEN {safe_lk_alias}._lkp_row_order IS NOT NULL THEN 1 ELSE NULL END AS {lk_matched_indicator},
                    ROW_NUMBER() OVER () as _step_{idx+1}_row_id
                FROM _tmap_working
                LEFT JOIN _{safe_lk_alias}_prepared {safe_lk_alias}
                    ON {join_cond}
                {qualify_clause};
            """)
            conn.execute("DROP TABLE _tmap_working;")
            conn.execute(f"ALTER TABLE _tmap_step_{idx+1} RENAME TO _tmap_working;")

            join_type_val = str(lk.get("join_type") or lk.get("join_model") or "left").lower()
            if "inner" in join_type_val:
                inner_join_checks.append(f"{lk_matched_indicator} IS NOT NULL")

        # ─── 3. Lazy / Dead-Variable Elimination e Avaliação Topológica de Variáveis ───
        all_refs_parts = []
        for out in outputs:
            all_refs_parts.append(str(out.get("filter_expression") or ""))
            for col in out.get("columns", []):
                all_refs_parts.append(str(col.get("expression") or ""))
        for lk in lookups:
            all_refs_parts.append(str(lk.get("join_filter") or ""))
            all_refs_parts.append(str(lk.get("filter_expression") or ""))
        all_refs_text = " ".join(all_refs_parts)

        needed_var_names = set()
        for v in variables:
            v_name = v.get("name")
            if v_name and (
                re.search(rf'\bVar\.{re.escape(v_name)}\b', all_refs_text, re.IGNORECASE) or
                re.search(rf'\b{re.escape(v_name)}\b', all_refs_text, re.IGNORECASE)
            ):
                needed_var_names.add(v_name)

        changed = True
        while changed:
            changed = False
            for v in variables:
                v_name = v.get("name")
                v_expr = v.get("expression", "")
                if v_name in needed_var_names:
                    for other_v in variables:
                        other_name = other_v.get("name")
                        if other_name and other_name != v_name and other_name not in needed_var_names:
                            if re.search(rf'\bVar\.{re.escape(other_name)}\b', v_expr, re.IGNORECASE) or \
                               re.search(rf'\b{re.escape(other_name)}\b', v_expr, re.IGNORECASE):
                                needed_var_names.add(other_name)
                                changed = True

        active_vars = []
        for v in variables:
            v_name = v.get("name")
            if v_name in needed_var_names:
                active_vars.append(v)
            else:
                logger.warning(
                    f"Variável intermediária '{v_name}' (expressão '{v.get('expression', '')}') "
                    "não é utilizada em nenhuma saída ou filtro e foi descartada (Dead-Variable Elimination)."
                )

        vars_map = {v.get("name").lower(): v.get("name") for v in active_vars if v.get("name")}

        for v_idx, var in enumerate(active_vars):
            var_name = var.get("name")
            var_expr = var.get("expression", "")
            var_type = str(var.get("type", "String")).lower()
            if var_name and var_expr:
                transpiled_v = self.compile_tmap_expression(
                    var_expr,
                    alias_map=alias_map,
                    vars_map=vars_map,
                    known_columns=known_cols
                )
                cast_type = "VARCHAR"
                if "int" in var_type:
                    cast_type = "BIGINT"
                elif "bool" in var_type:
                    cast_type = "BOOLEAN"
                elif any(t in var_type for t in ("float", "double", "decimal", "numeric")):
                    cast_type = "DOUBLE"
                elif "date" in var_type or "time" in var_type:
                    cast_type = "TIMESTAMP"

                v_sql = f"TRY_CAST(({transpiled_v}) AS {cast_type})"
                try:
                    conn.execute(f"""
                        CREATE TEMPORARY TABLE _tmap_var_step_{v_idx} AS
                        SELECT *, 
                               ({v_sql}) AS "Var.{var_name}",
                               ({v_sql}) AS "{var_name}"
                        FROM _tmap_working;
                    """)
                    conn.execute("DROP TABLE _tmap_working;")
                    conn.execute(f"ALTER TABLE _tmap_var_step_{v_idx} RENAME TO _tmap_working;")
                except Exception as e:
                    logger.warning(f"Erro ao avaliar variável '{var_name}': {e}. Criando coluna NULL.")
                    conn.execute(f'ALTER TABLE _tmap_working ADD COLUMN "Var.{var_name}" VARCHAR;')
                    conn.execute(f'ALTER TABLE _tmap_working ADD COLUMN "{var_name}" VARCHAR;')

        # ─── 4. Processa Tabelas de Saída, Rejeições e Deduplicação Defensiva ───
        results: Dict[str, pl.DataFrame] = {}
        standard_filter_conditions: List[str] = []

        # Primeiro passa pelas saídas normais para coletar os filtros padrão
        for out in outputs:
            is_catch_output = out.get("catch_output_reject", False)
            is_catch_inner = out.get("catch_inner_join_reject", False) or out.get("catch_lookup_reject", False) or out.get("is_reject", False)
            if not is_catch_output and not is_catch_inner:
                f_expr = (out.get("filter_expression") or "").strip()
                if f_expr:
                    t_f_expr = self.compile_tmap_expression(f_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)
                    standard_filter_conditions.append(f"COALESCE(({t_f_expr}), FALSE)")

        for idx, out in enumerate(outputs):
            out_name = out.get("name") or out.get("id") or f"out_{idx+1}"
            is_catch_output = out.get("catch_output_reject", False)
            is_catch_inner = out.get("catch_inner_join_reject", False) or out.get("catch_lookup_reject", False) or out.get("is_reject", False)
            filter_expr = (out.get("filter_expression") or "").strip()
            cols = out.get("columns", [])

            where_clauses = []
            if is_catch_inner:
                if inner_join_checks:
                    where_clauses.append("NOT (" + " AND ".join(inner_join_checks) + ")")
                else:
                    where_clauses.append("1=0")
                if filter_expr:
                    where_clauses.append(f"({self.compile_tmap_expression(filter_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)})")
            elif is_catch_output:
                if inner_join_checks:
                    where_clauses.extend(inner_join_checks)
                if standard_filter_conditions:
                    where_clauses.append("NOT (" + " OR ".join(standard_filter_conditions) + ")")
                else:
                    where_clauses.append("1=0")
                if filter_expr:
                    where_clauses.append(f"({self.compile_tmap_expression(filter_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)})")
            else:
                if inner_join_checks:
                    where_clauses.extend(inner_join_checks)
                if filter_expr:
                    where_clauses.append(f"({self.compile_tmap_expression(filter_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)})")

            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""

            # Constrói SELECT com Deduplicação Defensiva de Colunas
            if cols:
                select_items = []
                seen_targets = {}
                for c in cols:
                    target_name = (c.get("name") or c.get("target") or "col").strip()
                    raw_expr = (c.get("expression") or target_name).strip()
                    target_lower = target_name.lower()

                    if target_lower in seen_targets:
                        # Coluna duplicada detectada!
                        prev_entry = seen_targets[target_lower]
                        prev_expr = prev_entry["raw_expr"]
                        # Se uma for de lookup e outra de main (ou vice-versa):
                        is_lkp_main_pair = (
                            ("lkp" in raw_expr.lower() and ("main" in prev_expr.lower() or "row1" in prev_expr.lower())) or
                            ("lkp" in prev_expr.lower() and ("main" in raw_expr.lower() or "row1" in raw_expr.lower()))
                        )
                        if is_lkp_main_pair:
                            t_expr1 = self.compile_tmap_expression(raw_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)
                            t_expr2 = self.compile_tmap_expression(prev_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)
                            prev_idx = prev_entry["index"]
                            select_items[prev_idx] = f'COALESCE(({t_expr1}), ({t_expr2})) AS "{target_name}"'
                            logger.warning(
                                f"Coluna de saída duplicada '{target_name}' no output '{out_name}' consolidada com COALESCE({raw_expr}, {prev_expr})."
                            )
                        else:
                            # Desambigua renomeando para target_1, target_2, ...
                            counter = 1
                            new_target = f"{target_name}_{counter}"
                            while new_target.lower() in seen_targets:
                                counter += 1
                                new_target = f"{target_name}_{counter}"
                            t_expr = self.compile_tmap_expression(raw_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)
                            select_items.append(f'({t_expr}) AS "{new_target}"')
                            seen_targets[new_target.lower()] = {"raw_expr": raw_expr, "index": len(select_items) - 1}
                            logger.warning(
                                f"Coluna de saída duplicada '{target_name}' no output '{out_name}' renomeada defensivamente para '{new_target}'."
                            )
                    else:
                        t_expr = self.compile_tmap_expression(raw_expr, alias_map=alias_map, vars_map=vars_map, known_columns=known_cols)
                        select_items.append(f'({t_expr}) AS "{target_name}"')
                        seen_targets[target_lower] = {"raw_expr": raw_expr, "index": len(select_items) - 1}

                select_sql = ", ".join(select_items)
            else:
                table_cols = [r[0] for r in conn.execute("DESCRIBE _tmap_working").fetchall()]
                clean_cols = [c for c in table_cols if not c.startswith("_") and "." not in c]
                if clean_cols:
                    select_sql = ", ".join([f'"{c}"' for c in clean_cols])
                else:
                    orig_main_cols = [f'_tmap_working."{c}" AS "{c}"' for c in main_df.columns if not c.startswith("_tmap")]
                    select_sql = ", ".join(orig_main_cols) if orig_main_cols else "*"

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


