import os
import threading
from typing import Any, Dict, List, Optional

import duckdb
import polars as pl
from src.core.domain.shared.exceptions import DomainError


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

    def execute_query_on_database(self, database_path: str, query: str, read_only: bool = True) -> pl.DataFrame:
        """Executa consulta em um banco de dados DuckDB (.duckdb ou :memory:)."""
        db_path = database_path or self.database_path or ":memory:"
        if db_path != ":memory:" and not os.path.exists(db_path) and not read_only:
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

        try:
            conn = duckdb.connect(db_path, read_only=read_only and os.path.exists(db_path) and db_path != ":memory:")
            return self.execute_query_to_polars(query, conn=conn)
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
        is_first_chunk: bool = True
    ) -> int:
        """Grava dados no banco DuckDB com suporte a ações de tabela e dados no padrão Talend (Thread-Safe)."""
        with self._write_lock:
            db_path = database_path or self.database_path or ":memory:"
            if db_path != ":memory:":
                os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

            conn = duckdb.connect(db_path)
            arrow_table = df.to_arrow()
            conn.register("_chunk_batch", arrow_table)

            # 1. Executa Ação na Tabela apenas no primeiro chunk
            if is_first_chunk:
                if table_action in ("drop_create", "drop_if_exists_create"):
                    conn.execute(f"DROP TABLE IF EXISTS {table_name};")
                    conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                elif table_action == "create_if_not_exists":
                    conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")
                elif table_action in ("truncate", "delete_all"):
                    try:
                        conn.execute(f"DELETE FROM {table_name};")
                    except Exception:
                        conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")

            # Garante que a tabela existe antes de inserir
            try:
                conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1;")
            except Exception:
                conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM _chunk_batch WHERE 1=0;")

            # 2. Executa Ação nos Dados
            if data_action == "insert":
                conn.execute(f"INSERT INTO {table_name} SELECT * FROM _chunk_batch;")
            elif data_action in ("upsert", "update_or_insert", "insert_or_update") and keys:
                join_cond = " AND ".join([f"{table_name}.{k} = _chunk_batch.{k}" for k in keys])
                conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
                conn.execute(f"INSERT INTO {table_name} SELECT * FROM _chunk_batch;")
            elif data_action == "delete" and keys:
                join_cond = " AND ".join([f"{table_name}.{k} = _chunk_batch.{k}" for k in keys])
                conn.execute(f"DELETE FROM {table_name} WHERE EXISTS (SELECT 1 FROM _chunk_batch WHERE {join_cond});")
            else:
                conn.execute(f"INSERT INTO {table_name} SELECT * FROM _chunk_batch;")

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
        """Converte expressões com sintaxe mista (Java/Talend/Python/SQL) para DuckDB SQL válido."""
        if not expr or not expr.strip():
            return "NULL"

        import re
        s = expr.strip()

        # 0. Se colunas conhecidas forem fornecidas, substitui com prioridade referências a colunas conhecidas
        # (especialmente colunas com espaços ou caracteres especiais como "Working URL")
        if known_columns:
            sorted_cols = sorted(known_columns, key=len, reverse=True)
            for col in sorted_cols:
                escaped = re.escape(col)
                # Match {node.col}
                s = re.sub(r'\{[a-zA-Z0-9_\-]+\.' + escaped + r'\}', f'"{col}"', s)
                # Match prefix."col" ou prefix.'col'
                s = re.sub(r'\b[a-zA-Z0-9_]+\.["\']' + escaped + r'["\']', f'"{col}"', s)
                # Match prefix.col (mesmo com espaços, desde que case com o nome exato da coluna)
                s = re.sub(r'\b[a-zA-Z0-9_]+\.' + escaped + r'(?=\b|\s|[\(\)\+\-\*\/\,\<\>\=\!\?]|$)', f'"{col}"', s)
                # Match Var.col ou Var."col"
                s = re.sub(r'\bVar\.["\']?' + escaped + r'["\']?(?=\b|\s|[\(\)\+\-\*\/\,\<\>\=\!\?]|$)', f'"{col}"', s)
                # Se a expressão for exatamente o nome da coluna sem aspas
                if s == col:
                    s = f'"{col}"'

        # 1. Tokens genéricos {node.col} -> "col"
        s = re.sub(r'\{[a-zA-Z0-9_\-]+\.([^\}]+)\}', r'"\1"', s)

        # 2. Transpila Var."xxx" ou Var.xxx -> "xxx"
        s = re.sub(r'\bVar\.["\']?([a-zA-Z0-9_]+)["\']?\b', r'"\1"', s)

        # 3. Transpila prefixos com aspas: rowX."col name" -> "col name"
        s = re.sub(r'\b[a-zA-Z0-9_]+\.["\']([^"\']+)["\']', r'"\1"', s)

        # 4. Transpila prefixos de tabela (rowX.col -> "col")
        s = re.sub(r'\b[a-zA-Z0-9_]+\.([a-zA-Z0-9_]+)\b', r'"\1"', s)

        # 5. Operadores lógicos e de comparação comuns
        s = re.sub(r'==\s*null\b', ' IS NULL', s, flags=re.IGNORECASE)
        s = re.sub(r'!=\s*null\b', ' IS NOT NULL', s, flags=re.IGNORECASE)
        s = re.sub(r'==', '=', s)
        s = re.sub(r'&&', ' AND ', s)

        # 6. Converte ternário cond ? a : b -> CASE WHEN cond THEN a ELSE b END
        if "?" in s and ":" in s:
            ternary_match = re.match(r'^(.*?)\?(.*?)\:(.*)$', s)
            if ternary_match:
                cond, t_val, f_val = ternary_match.groups()
                s = f"CASE WHEN {cond.strip()} THEN {t_val.strip()} ELSE {f_val.strip()} END"

        return s

    def execute_tmap_transform(
        self,
        main_df: pl.DataFrame,
        lookups: List[Dict[str, Any]],
        lookup_dfs: Dict[str, pl.DataFrame],
        variables: List[Dict[str, Any]],
        outputs: List[Dict[str, Any]]
    ) -> Dict[str, pl.DataFrame]:
        """Executa a transformação completa do tMap padrão Talend usando DuckDB."""
        if main_df.height == 0:
            return {out.get("name", f"out_{i+1}"): pl.DataFrame() for i, out in enumerate(outputs)}

        # Coleta todas as colunas conhecidas para transpilação precisa de expressões com espaços
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

        # 1. Registra Main Table com índice único de ordenação
        conn.register("_main_raw", main_df.to_arrow())
        conn.execute("CREATE TEMPORARY TABLE _tmap_working AS SELECT *, ROW_NUMBER() OVER () as _tmap_main_idx FROM _main_raw;")

        # 2. Processa cada Lookup com Joins, Filtros e Match Models
        inner_join_checks = []

        for idx, lk in enumerate(lookups):
            node_id = lk.get("node_id") or lk.get("id") or ""
            lk_alias = f"_lk_{idx+1}"
            lk_df = lookup_dfs.get(node_id, pl.DataFrame())

            if lk_df.height == 0:
                continue

            conn.register(f"{lk_alias}_raw", lk_df.to_arrow())

            # Filtro do Lookup
            raw_lk_filter = lk.get("lookup_filter") or lk.get("filter") or ""
            if raw_lk_filter.strip():
                transpiled_filter = self.transpile_expression(raw_lk_filter, known_columns=known_cols)
                conn.execute(f"CREATE TEMPORARY VIEW {lk_alias}_filtered AS SELECT *, ROW_NUMBER() OVER () as _lk_row_id FROM {lk_alias}_raw WHERE ({transpiled_filter});")
            else:
                conn.execute(f"CREATE TEMPORARY VIEW {lk_alias}_filtered AS SELECT *, ROW_NUMBER() OVER () as _lk_row_id FROM {lk_alias}_raw;")

            # Match Model (all, first, unique/last)
            match_model = str(lk.get("match_model", "all")).lower()
            right_keys = lk.get("right_keys", [])
            left_keys = lk.get("left_keys", [])

            if right_keys and match_model == "first":
                part_cols = ", ".join([f'"{k}"' for k in right_keys])
                conn.execute(f"""
                    CREATE TEMPORARY VIEW {lk_alias}_dedup AS
                    SELECT * EXCLUDE (_rn) FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY _lk_row_id ASC) as _rn
                        FROM {lk_alias}_filtered
                    ) WHERE _rn = 1;
                """)
            elif right_keys and match_model == "unique":
                part_cols = ", ".join([f'"{k}"' for k in right_keys])
                conn.execute(f"""
                    CREATE TEMPORARY VIEW {lk_alias}_dedup AS
                    SELECT * EXCLUDE (_rn) FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_cols} ORDER BY _lk_row_id DESC) as _rn
                        FROM {lk_alias}_filtered
                    ) WHERE _rn = 1;
                """)
            else:
                conn.execute(f"CREATE TEMPORARY VIEW {lk_alias}_dedup AS SELECT * FROM {lk_alias}_filtered;")

            # Executa Join
            if left_keys and right_keys:
                join_cond = " AND ".join([
                    f'_tmap_working."{lk_k}" = {lk_alias}_dedup."{rk_k}"'
                    for lk_k, rk_k in zip(left_keys, right_keys)
                ])

                join_model = str(lk.get("join_model", "left_outer")).lower()
                has_match_col = f"_has_match_{idx+1}"

                # Realiza Left Join e cria flag indicadora de match
                conn.execute(f"""
                    CREATE TEMPORARY TABLE _tmap_step_{idx+1} AS
                    SELECT 
                        _tmap_working.*,
                        {lk_alias}_dedup.* EXCLUDE (_lk_row_id),
                        CASE WHEN {lk_alias}_dedup._lk_row_id IS NOT NULL THEN 1 ELSE 0 END AS {has_match_col}
                    FROM _tmap_working
                    LEFT JOIN {lk_alias}_dedup ON {join_cond};
                """)
                conn.execute("DROP TABLE _tmap_working;")
                conn.execute(f"ALTER TABLE _tmap_step_{idx+1} RENAME TO _tmap_working;")

                if join_model == "inner":
                    inner_join_checks.append(f"{has_match_col} = 1")

        # 3. Computa Variáveis Intermediárias (Var) em Ordem Sequencial
        for v_idx, var in enumerate(variables):
            var_name = var.get("name")
            var_expr = var.get("expression", "")
            if var_name and var_expr:
                transpiled_v = self.transpile_expression(var_expr, known_columns=known_cols)
                try:
                    conn.execute(f"""
                        CREATE TEMPORARY TABLE _tmap_var_step_{v_idx} AS
                        SELECT *, ({transpiled_v}) AS "{var_name}"
                        FROM _tmap_working;
                    """)
                    conn.execute("DROP TABLE _tmap_working;")
                    conn.execute(f"ALTER TABLE _tmap_var_step_{v_idx} RENAME TO _tmap_working;")
                except Exception as e:
                    # Se falhar a expressão da variável, continua com coluna nula
                    conn.execute(f'ALTER TABLE _tmap_working ADD COLUMN "{var_name}" VARCHAR;')

        # 4. Processa Tabelas de Saída e Rejeições
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
                # Rejeição de Inner Join: registros onde pelo menos um inner join falhou
                if inner_join_checks:
                    where_clauses.append("NOT (" + " AND ".join(inner_join_checks) + ")")
                else:
                    where_clauses.append("1=0")  # Sem inner joins, nenhum reject
            elif is_catch_output:
                # Rejeição de Filtro de Saída: registros aceitos pelos joins mas rejeitados por todas as saídas
                if inner_join_checks:
                    where_clauses.extend(inner_join_checks)
                if standard_filter_conditions:
                    where_clauses.append("NOT (" + " OR ".join(standard_filter_conditions) + ")")
                else:
                    where_clauses.append("1=0")
            else:
                # Saída normal
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
                select_sql = "* EXCLUDE (_tmap_main_idx" + "".join([f", _has_match_{i+1}" for i in range(len(lookups))]) + ")"

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


