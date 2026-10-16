"""Executor Assíncrono Local (ExecutionWorker).

Orquestra a passagem de dados entre operadores do plano físico,
coleta métricas atômicas e verifica periodicamente o token de cancelamento cooperativo.
"""

from datetime import datetime, timezone
import logging
import re
import time
from typing import Any, Dict, List, Optional

import polars as pl
from src.core.application.compiler.physical_planner import PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.shared.exceptions import DomainError, DomainValidationError
from src.core.domain.metadata.connection import Connection, FORBIDDEN_PLAINTEXT_KEYS
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.connectors.file_connector import LocalFileConnector
from src.core.infrastructure.connectors.oracle_connector import OracleConnector
from src.core.infrastructure.connectors.scylla_connector import ScyllaConnector
from src.core.infrastructure.connectors.kafka_connector import KafkaConnector
from src.core.infrastructure.connectors.aws_messaging_connector import AwsMessagingConnector
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
from src.core.infrastructure.engines.polars_runner import PolarsRunner, batch_to_polars_df
from src.core.infrastructure.execution.cancellation import CancellationToken
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver

logger = logging.getLogger(__name__)


def map_schema_type_to_polars(col_type: str) -> pl.DataType:
    t = (col_type or "").lower().strip()
    if t in ("integer", "int", "int32"):
        return pl.Int32
    elif t in ("long", "int64", "bigint"):
        return pl.Int64
    elif t in ("float", "float32"):
        return pl.Float32
    elif t in ("double", "float64", "decimal", "numeric", "number"):
        return pl.Float64
    elif t in ("boolean", "bool"):
        return pl.Boolean
    elif t in ("date",):
        return pl.Date
    elif t in ("timestamp", "datetime"):
        return pl.Datetime
    else:
        return pl.Utf8


def cast_df_to_schema(df: pl.DataFrame, schema_defs: List[Dict[str, Any]]) -> pl.DataFrame:
    if not schema_defs or not isinstance(schema_defs, list) or len(df.columns) == 0:
        return df
    exprs = []
    for col_def in schema_defs:
        if not isinstance(col_def, dict):
            continue
        c_name = col_def.get("name")
        c_type = col_def.get("type")
        if c_name and c_name in df.columns:
            target_type = map_schema_type_to_polars(c_type)
            try:
                exprs.append(pl.col(c_name).cast(target_type, strict=False))
            except Exception:
                pass
    if exprs:
        try:
            return df.with_columns(exprs)
        except Exception:
            return df
    return df


def create_empty_df_from_schema(schema_defs: List[Dict[str, Any]], schema_cols: List[str]) -> pl.DataFrame:
    schema = {}
    if schema_defs and isinstance(schema_defs, list):
        for col_def in schema_defs:
            if isinstance(col_def, dict) and col_def.get("name"):
                schema[col_def["name"]] = map_schema_type_to_polars(col_def.get("type"))
    if not schema and schema_cols:
        for c in schema_cols:
            schema[c] = pl.Utf8
    return pl.DataFrame(schema=schema) if schema else pl.DataFrame()


class ExecutionWorker:
    """Worker responsável pelo processamento de um plano físico local."""

    def __init__(
        self,
        file_connector: Optional[LocalFileConnector] = None,
        duckdb_runner: Optional[DuckDBRunner] = None,
        polars_runner: Optional[PolarsRunner] = None,
        secret_resolver: Optional[SecretResolver] = None
    ):
        self.file_connector = file_connector or LocalFileConnector()
        self.duckdb_runner = duckdb_runner or DuckDBRunner()
        self.polars_runner = polars_runner or PolarsRunner()
        self.secret_resolver = secret_resolver or SecretResolver()
        self.oracle_connector = OracleConnector(self.secret_resolver)
        self.scylla_connector = ScyllaConnector(self.secret_resolver)
        self.kafka_connector = KafkaConnector(self.secret_resolver)
        self.aws_messaging_connector = AwsMessagingConnector(self.secret_resolver)

    def run(
        self,
        execution: Execution,
        plan: PhysicalPlan,
        cancellation_token: Optional[CancellationToken] = None
    ) -> Execution:
        """Executa o plano físico até a conclusão, erro ou cancelamento cooperativo."""
        token = cancellation_token or CancellationToken()

        # Respeita as transições canônicas da FSM até atingir o estado RUNNING
        if execution.status == ExecutionStatus.CREATED:
            execution.start_planning()
            execution.mark_queued()
            execution.start_running()
        elif execution.status == ExecutionStatus.PLANNING:
            execution.mark_queued()
            execution.start_running()
        elif execution.status == ExecutionStatus.QUEUED:
            execution.start_running()

        node_buffers: Dict[str, List[pl.DataFrame]] = {}
        current_node_id: Optional[str] = None
        current_task: Optional[Any] = None

        try:
            for node_id in plan.execution_order:
                current_node_id = node_id
                # Verifica cancelamento antes de iniciar cada nó
                token.check_cancelled()

                phys_op = plan.operators[node_id]
                task = execution.tasks.get(node_id) or execution.add_task(node_id)
                current_task = task
                task.status = ExecutionStatus.RUNNING
                task.started_at = datetime.now(timezone.utc)

                op_type = phys_op.operator_type
                cfg = phys_op.config

                # Suporte a Resiliência (Retries) e Throttling (Sleep) (Tópico 6)
                raw_cfg = cfg.get("raw_config") or {}
                max_retries = int(raw_cfg.get("max_retries") or cfg.get("max_retries") or 0)
                retry_interval = float(raw_cfg.get("retry_interval_seconds") or cfg.get("retry_interval_seconds") or 5.0)
                batch_delay = float(raw_cfg.get("batch_delay_seconds") or cfg.get("batch_delay_seconds") or 0.0)

                attempt = 0
                while True:
                    try:
                        token.check_cancelled()
                        if op_type == "scan":
                            self._execute_scan_node(phys_op, cfg, plan, token, task, node_buffers)
                        elif op_type == "filter":
                            self._execute_filter_node(phys_op, cfg, token, task, node_buffers)
                        elif op_type == "project":
                            self._execute_project_node(phys_op, cfg, token, task, node_buffers)
                        elif op_type == "join":
                            self._execute_join_node(phys_op, cfg, token, task, node_buffers)
                        elif op_type == "tmap":
                            self._execute_tmap_node(phys_op, cfg, token, task, node_buffers)
                        elif op_type == "sink":
                            self._execute_sink_node(phys_op, cfg, token, task, node_buffers)
                        elif op_type in ("barrier", "control.sync", "control.barrier"):
                            self._execute_barrier_node(phys_op, cfg, execution, token, task, node_buffers)

                        # Throttling / Sleep intencional entre nós/chunks
                        if batch_delay > 0:
                            time.sleep(batch_delay)

                        break  # Execução bem sucedida deste operador
                    except Exception as node_err:
                        attempt += 1
                        if token.is_cancelled() or attempt > max_retries:
                            raise node_err
                        logger.warning(
                            f"Falha no nó '{node_id}' (tentativa {attempt}/{max_retries}). "
                            f"Aguardando {retry_interval}s antes de tentar novamente. Erro: {node_err}"
                        )
                        time.sleep(retry_interval)

                task.complete(datetime.now(timezone.utc))
                current_task = None

            execution.succeed()

        except DomainError as de:
            now_utc = datetime.now(timezone.utc)
            if de.code == "ERR_EXECUTION_CANCELLED" or token.is_cancelled():
                logger.info(f"Execução '{execution.id}' cancelada com sucesso.")
                if current_task and current_task.status == ExecutionStatus.RUNNING:
                    current_task.status = ExecutionStatus.CANCELLED
                    current_task.finished_at = now_utc
                for remaining_id in plan.execution_order:
                    rem_task = execution.tasks.get(remaining_id)
                    if rem_task and rem_task.status in (ExecutionStatus.CREATED, ExecutionStatus.QUEUED, ExecutionStatus.RUNNING):
                        rem_task.status = ExecutionStatus.CANCELLED
                        rem_task.finished_at = now_utc
                execution.request_cancellation()
                execution.complete_cancellation()
            else:
                sanitized = sanitize_message(de.message)
                logger.error(f"Falha na execução '{execution.id}': {de.message}")
                if current_task and current_task.status == ExecutionStatus.RUNNING:
                    current_task.fail(now_utc, de.code, sanitized)
                for remaining_id in plan.execution_order:
                    if remaining_id != current_node_id:
                        rem_task = execution.tasks.get(remaining_id)
                        if rem_task and rem_task.status in (ExecutionStatus.CREATED, ExecutionStatus.QUEUED):
                            rem_task.status = ExecutionStatus.SKIPPED
                            rem_task.finished_at = now_utc
                execution.fail(de.code, sanitized)
        except Exception as e:
            now_utc = datetime.now(timezone.utc)
            raw_msg = str(e)
            sanitized = sanitize_message(raw_msg)
            logger.exception(f"Erro inesperado na execução '{execution.id}': {raw_msg}")
            if current_task and current_task.status == ExecutionStatus.RUNNING:
                current_task.fail(now_utc, "ERR_EXECUTION_INTERNAL", sanitized)
            for remaining_id in plan.execution_order:
                if remaining_id != current_node_id:
                    rem_task = execution.tasks.get(remaining_id)
                    if rem_task and rem_task.status in (ExecutionStatus.CREATED, ExecutionStatus.QUEUED):
                        rem_task.status = ExecutionStatus.SKIPPED
                        rem_task.finished_at = now_utc
            execution.fail("ERR_EXECUTION_INTERNAL", sanitized)

        return execution

    def _build_connection_from_cfg(self, cfg: Dict[str, Any], connector_type: str) -> Connection:
        conn_details = cfg.get("connection_details") or {}
        raw_cfg = cfg.get("raw_config") or {}

        endpoint = (
            conn_details.get("endpoint")
            or conn_details.get("host")
            or conn_details.get("bootstrapServers")
            or conn_details.get("queueUrl")
            or conn_details.get("topicArn")
            or raw_cfg.get("endpoint")
            or raw_cfg.get("topic")
            or raw_cfg.get("queue_url")
            or raw_cfg.get("topic_arn")
            or "localhost"
        )

        secret = (
            conn_details.get("password")
            or conn_details.get("pwd")
            or conn_details.get("secret")
            or conn_details.get("secretKey")
            or conn_details.get("secret_ref")
            or raw_cfg.get("password")
            or raw_cfg.get("secretKey")
            or "secret://empty"
        )
        if not str(secret).startswith("secret://"):
            secret_key = f"SECRET_{connector_type.upper()}"
            self.secret_resolver.custom_env[secret_key] = str(secret)
            secret_ref = SecretReference(f"secret://env/{secret_key}")
        else:
            secret_ref = SecretReference(str(secret))

        # Filtra chaves confidenciais de options para respeitar validação de segurança da Connection
        merged_options = {**conn_details, **raw_cfg}
        safe_options = {
            k: v for k, v in merged_options.items()
            if k.lower() not in FORBIDDEN_PLAINTEXT_KEYS and k.lower() not in ("secretkey", "accesskey", "secret_key")
        }

        return Connection(
            id=f"conn_{connector_type}",
            project_id="proj_default",
            name=f"Connection {connector_type}",
            connector_type=connector_type,
            endpoint=str(endpoint),
            secret_ref=secret_ref,
            options=safe_options
        )

    def _interpolate_tokens(self, text: str, row_dict: Dict[str, Any], upstream_id: str, is_sql: bool = True) -> str:
        """Substitui referências {{upstream_id.col}}, {{row.col}}, {{col}}, {upstream_id.col}, {row.col}, {col} pelos valores da linha."""
        if not text:
            return ""

        clean_upstream = upstream_id.split(":")[0].split(".")[0].lower() if upstream_id else ""

        # Mapeamentos para resolução insensível a maiúsculas/minúsculas e prefixos de tabela
        exact_map = {k: k for k in row_dict.keys()}
        lower_map = {k.lower(): k for k in row_dict.keys()}
        short_map = {k.split(".")[-1].lower(): k for k in row_dict.keys()}

        def resolve_val(inner_str: str):
            parts = inner_str.split(".", 1)
            if len(parts) == 2:
                prefix, col = parts[0].strip().lower(), parts[1].strip()
                col_lookup = col
            else:
                prefix, col = "", parts[0].strip()
                col_lookup = col

            if col_lookup in exact_map:
                return True, row_dict[exact_map[col_lookup]]
            if col_lookup.lower() in lower_map:
                return True, row_dict[lower_map[col_lookup.lower()]]
            if col_lookup.lower() in short_map:
                return True, row_dict[short_map[col_lookup.lower()]]
            if inner_str.lower() in lower_map:
                return True, row_dict[lower_map[inner_str.lower()]]
            if inner_str.lower() in short_map:
                return True, row_dict[short_map[inner_str.lower()]]

            return False, None

        # Regex flexível que aceita {{...}} ou {...} com ou sem aspas simples circundantes e com espaços opcionais
        token_re = re.compile(
            r"('?)\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}('?)|('?)\{\s*([a-zA-Z0-9_\-\.]+)\s*\}('?)"
        )

        def replace_match(m):
            q1 = m.group(1) or m.group(4) or ""
            inner = m.group(2) or m.group(5) or ""
            q2 = m.group(3) or m.group(6) or ""

            found, val = resolve_val(inner)
            if not found:
                # Mantém o token se não encontrado
                return m.group(0)

            has_quotes = (q1 == "'" and q2 == "'")

            if not is_sql:
                return str(val) if val is not None else ""

            # Formatação SQL de tipos
            if val is None:
                return "NULL"
            elif isinstance(val, bool):
                return "'TRUE'" if val else "'FALSE'"
            elif isinstance(val, (int, float)):
                return str(val) if not has_quotes else f"'{val}'"
            else:
                escaped = str(val).replace("'", "''")
                return f"'{escaped}'"

        res = token_re.sub(replace_match, text)

        # Fallback complementar para tokens legados
        for col, val in row_dict.items():
            if not is_sql:
                quoted_val = str(val) if val is not None else ""
                unquoted_val = str(val) if val is not None else ""
            else:
                if val is None:
                    quoted_val = "NULL"
                    unquoted_val = "NULL"
                elif isinstance(val, bool):
                    quoted_val = "'TRUE'" if val else "'FALSE'"
                    unquoted_val = "TRUE" if val else "FALSE"
                elif isinstance(val, (int, float)):
                    quoted_val = f"'{val}'"
                    unquoted_val = str(val)
                else:
                    escaped = str(val).replace("'", "''")
                    quoted_val = f"'{escaped}'"
                    unquoted_val = f"'{escaped}'"

            patterns = [
                f"{{{{{upstream_id}.{col}}}}}",
                f"{{{{{clean_upstream}.{col}}}}}",
                f"{{{{row.{col}}}}}",
                f"{{{{{col}}}}}",
                f"{{{upstream_id}.{col}}}",
                f"{{{clean_upstream}.{col}}}",
                f"{{row.{col}}}",
                f"{{{col}}}",
            ]

            for pat in patterns:
                if f"'{pat}'" in res:
                    res = res.replace(f"'{pat}'", quoted_val)
                if pat in res:
                    res = res.replace(pat, unquoted_val)

        return res

    def _execute_scan_node(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        fmt = str(cfg.get("format", "csv")).lower()

        # Verifica se é um Scan Iterativo com nós a montante (tFlowToIterate direto)
        if phys_op.input_ids:
            self._execute_iterative_scan(phys_op, cfg, plan, token, task, node_buffers)
            return

        if fmt == "duckdb":
            conn_details = cfg.get("connection_details") or {}
            ref_path = cfg.get("connection_ref") if (cfg.get("connection_ref") and (cfg.get("connection_ref") == ":memory:" or str(cfg.get("connection_ref")).endswith(".duckdb") or str(cfg.get("connection_ref")).endswith(".db"))) else None
            db_path = conn_details.get("database_path") or conn_details.get("database") or cfg.get("database_path") or ref_path or ":memory:"
            query = cfg.get("source") or cfg.get("query") or ""
            fetch_size = int(cfg.get("fetch_size") or plan.default_chunk_size or 10000)
            chunks = self.duckdb_runner.execute_query_chunks_on_database(db_path, query, fetch_size=fetch_size)
            for ch in chunks:
                task.record_progress(rows_in_increment=ch.height, rows_out_increment=ch.height)
            node_buffers[phys_op.id] = chunks
            return

        if fmt == "scylla":
            conn = self._build_connection_from_cfg(cfg, "scylla")
            query = cfg.get("source") or cfg.get("query") or ""
            fetch_size = int(cfg.get("fetch_size") or 5000)
            consistency = cfg.get("consistency_level") or cfg.get("consistencyLevel") or "LOCAL_QUORUM"
            parallel_scans = int(cfg.get("parallel_scans") or 1)
            timeout = int(cfg.get("timeout_seconds") or cfg.get("timeout") or 30)
            df = self.scylla_connector.read_cql(
                conn,
                query=query,
                fetch_size=fetch_size,
                consistency_level=consistency,
                parallel_scans=parallel_scans,
                timeout=timeout
            )
            task.record_progress(rows_in_increment=df.height, rows_out_increment=df.height)
            node_buffers[phys_op.id] = [df]
            return

        if fmt == "kafka":
            conn = self._build_connection_from_cfg(cfg, "kafka")
            topic = cfg.get("source") or cfg.get("topic") or ""
            df = self.kafka_connector.consume_batch(conn, topic=topic)
            task.record_progress(rows_in_increment=df.height, rows_out_increment=df.height)
            node_buffers[phys_op.id] = [df]
            return

        if fmt in ("sqs", "aws_sqs"):
            conn = self._build_connection_from_cfg(cfg, "aws_sqs")
            queue_url = cfg.get("source") or cfg.get("queue_url") or ""
            df = self.aws_messaging_connector.receive_sqs_messages(conn, queue_url=queue_url)
            task.record_progress(rows_in_increment=df.height, rows_out_increment=df.height)
            node_buffers[phys_op.id] = [df]
            return

        conn_details = cfg.get("connection_details") or {}
        is_db = (
            fmt in ("postgres", "postgresql", "oracle", "mysql", "sqlserver", "redshift", "database")
            or "query" in cfg
            or bool(conn_details)
        )

        if is_db:
            self._execute_db_scan(phys_op, cfg, plan, token, task, node_buffers)
        else:
            self._execute_file_scan(phys_op, cfg, plan, token, task, node_buffers)

    def _execute_iterative_scan(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        """Executa leitura parametrizada linha a linha sobre o fluxo do nó a montante (Nested Loop tFlowToIterate)."""
        upstream_id = phys_op.input_ids[0]
        upstream_chunks = self._get_node_chunks(upstream_id, node_buffers)
        if not upstream_chunks:
            node_buffers[phys_op.id] = []
            return

        upstream_df = pl.concat(upstream_chunks)
        fmt = str(cfg.get("format", "postgres")).lower()
        base_query = (cfg.get("source") or cfg.get("query") or "").strip()

        all_results: List[pl.DataFrame] = []
        total_rows = 0

        # Para DuckDB com conexão persistida de alta performance
        if fmt == "duckdb":
            import duckdb
            conn_details = cfg.get("connection_details") or {}
            ref_path = cfg.get("connection_ref") if (cfg.get("connection_ref") and (cfg.get("connection_ref") == ":memory:" or str(cfg.get("connection_ref")).endswith(".duckdb") or str(cfg.get("connection_ref")).endswith(".db"))) else None
            db_path = conn_details.get("database_path") or conn_details.get("database") or cfg.get("database_path") or ref_path or ":memory:"
            duck_conn = duckdb.connect(db_path)
            try:
                for row in upstream_df.iter_rows(named=True):
                    token.check_cancelled()
                    query = self._interpolate_tokens(base_query, row, upstream_id)
                    cur = duck_conn.cursor()
                    cur.execute(query)
                    col_names = [d[0] for d in cur.description] if cur.description else ["result"]
                    batch = cur.fetchall()
                    res_df = batch_to_polars_df(batch, col_names)
                    all_results.append(res_df)
                    total_rows += res_df.height
                    task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)
            finally:
                duck_conn.close()

        # Para Fontes de Arquivo Parametrizadas (CSV, Parquet, JSON)
        elif fmt in ("csv", "parquet", "json", "excel") and cfg.get("path"):
            base_path = cfg.get("path", "")
            for row in upstream_df.iter_rows(named=True):
                token.check_cancelled()
                # Interpola o caminho do arquivo por linha
                interpolated_path = self._interpolate_tokens(base_path, row, upstream_id, is_sql=False).strip("'")
                try:
                    if fmt == "csv":
                        res_df = pl.read_csv(interpolated_path)
                    elif fmt == "parquet":
                        res_df = pl.read_parquet(interpolated_path)
                    elif fmt == "json":
                        res_df = pl.read_ndjson(interpolated_path)
                    else:
                        res_df = pl.read_excel(interpolated_path)
                except Exception as file_err:
                    logger.warning(f"Iterative file scan: pulando '{interpolated_path}' ({file_err})")
                    res_df = pl.DataFrame()

                all_results.append(res_df)
                total_rows += res_df.height
                task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)

        # Para Oracle Database
        elif fmt == "oracle":
            try:
                conn = self.oracle_connector.connect(cfg)
            except Exception as e:
                raise DomainError(f"Falha ao conectar no Oracle para iteração: {sanitize_message(str(e))}", code="ERR_DB_CONNECTION")

            try:
                cur = conn.cursor()
                for row in upstream_df.iter_rows(named=True):
                    token.check_cancelled()
                    query = self._interpolate_tokens(base_query, row, upstream_id)
                    unresolved = re.findall(r"\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}|\{\s*([a-zA-Z0-9_\-\.]+)\s*\}", query)
                    if unresolved:
                        first_missing = unresolved[0][0] or unresolved[0][1]
                        cols_available = list(row.keys())
                        raise DomainError(
                            f"Parâmetro não encontrado no nó a montante: '{{{first_missing}}}'. "
                            f"Colunas disponíveis em '{upstream_id}': {cols_available}",
                            code="ERR_UNRESOLVED_TOKEN"
                        )
                    cur.execute(query)
                    col_names = [desc[0] for desc in cur.description] if cur.description else ["result"]
                    batch = cur.fetchall()
                    res_df = batch_to_polars_df(batch, col_names)
                    all_results.append(res_df)
                    total_rows += res_df.height
                    task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)

                cur.close()
                conn.close()
            except Exception as e:
                try:
                    conn.close()
                except Exception:
                    pass
                raise DomainError(f"Erro durante a iteração de query SQL no Oracle: {sanitize_message(str(e))}", code="ERR_DB_QUERY")

        # Para ScyllaDB / Apache Cassandra NoSQL
        elif fmt in ("scylla", "scylladb", "cassandra"):
            conn = self._build_connection_from_cfg(cfg, "scylla")
            raw_cfg = cfg.get("raw_config") or {}
            fetch_size = int(cfg.get("fetch_size") or raw_cfg.get("fetch_size") or 5000)
            consistency = (
                cfg.get("consistency_level")
                or cfg.get("consistencyLevel")
                or raw_cfg.get("consistency_level")
                or raw_cfg.get("consistencyLevel")
                or "LOCAL_QUORUM"
            )
            timeout = int(cfg.get("timeout_seconds") or cfg.get("timeout") or raw_cfg.get("timeout_seconds") or raw_cfg.get("timeout") or 30)

            hosts, port, keyspace = self.scylla_connector.parse_endpoint(conn)
            if not keyspace and (cfg.get("keyspace") or raw_cfg.get("keyspace")):
                keyspace = cfg.get("keyspace") or raw_cfg.get("keyspace")

            raw_password = self.secret_resolver.resolve(conn.secret_ref)
            user = conn.options.get("user") or conn.options.get("username", "")

            try:
                from cassandra.auth import PlainTextAuthProvider
                from cassandra.query import SimpleStatement
            except ImportError:
                raise DomainError(
                    "Driver 'cassandra-driver' não está instalado no ambiente. Execute 'pip install cassandra-driver'.",
                    code="ERR_DRIVER_MISSING"
                )

            auth_provider = PlainTextAuthProvider(username=user, password=raw_password) if user and raw_password else None
            cluster = None
            session = None
            try:
                cluster = self.scylla_connector._create_cluster(hosts=hosts, port=port, auth_provider=auth_provider, connect_timeout=10)
                session = cluster.connect(keyspace if keyspace else None)
            except Exception as conn_err:
                if cluster:
                    try:
                        cluster.shutdown()
                    except Exception:
                        pass
                err_msg = self.scylla_connector._format_scylla_error(conn_err, hosts, port, keyspace, "conexão ScyllaDB para iteração")
                raise DomainError(f"Falha ao conectar no banco para iteração: {err_msg}", code="ERR_DB_CONNECTION")

            try:
                cql_consistency = self.scylla_connector._map_cql_consistency(consistency)
                for row in upstream_df.iter_rows(named=True):
                    token.check_cancelled()
                    query = self._interpolate_tokens(base_query, row, upstream_id)
                    unresolved = re.findall(r"\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}|\{\s*([a-zA-Z0-9_\-\.]+)\s*\}", query)
                    if unresolved:
                        first_missing = unresolved[0][0] or unresolved[0][1]
                        cols_available = list(row.keys())
                        raise DomainError(
                            f"Parâmetro não encontrado no nó a montante: '{{{first_missing}}}'. "
                            f"Colunas disponíveis em '{upstream_id}': {cols_available}",
                            code="ERR_UNRESOLVED_TOKEN"
                        )
                    stmt = SimpleStatement(query, fetch_size=fetch_size, consistency_level=cql_consistency)
                    rows = session.execute(stmt, timeout=timeout)
                    data = [dict(r._asdict()) for r in rows]
                    res_df = pl.DataFrame(data) if data else pl.DataFrame()
                    all_results.append(res_df)
                    total_rows += res_df.height
                    task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)
            except DomainError:
                raise
            except Exception as query_err:
                err_msg = self.scylla_connector._format_scylla_error(query_err, hosts, port, keyspace, "iteração CQL")
                raise DomainError(f"Erro durante a iteração de query CQL no ScyllaDB: {err_msg}", code="ERR_DB_QUERY")
            finally:
                if cluster:
                    try:
                        cluster.shutdown()
                    except Exception:
                        pass

        # Para Banco de Dados Relacional (PostgreSQL / Relacional)
        else:
            conn_details = cfg.get("connection_details") or {}
            host = conn_details.get("host") or "localhost"
            port = int(conn_details.get("port") or 5432)
            database = conn_details.get("database") or "postgres"
            username = conn_details.get("username") or "postgres"
            password = conn_details.get("password") or ""
            sslmode = conn_details.get("sslMode") or "prefer"

            import psycopg2
            try:
                conn = psycopg2.connect(
                    dbname=database, user=username, password=password,
                    host=host, port=port, sslmode=sslmode, connect_timeout=15
                )
            except Exception as e:
                raise DomainError(f"Falha ao conectar no banco para iteração: {sanitize_message(str(e))}", code="ERR_DB_CONNECTION")

            try:
                cur = conn.cursor()
                try:
                    cur.execute("SET statement_timeout = 0;")
                except Exception:
                    pass
                for row in upstream_df.iter_rows(named=True):
                    token.check_cancelled()
                    query = self._interpolate_tokens(base_query, row, upstream_id)
                    unresolved = re.findall(r"\{\{\s*([a-zA-Z0-9_\-\.]+)\s*\}\}|\{\s*([a-zA-Z0-9_\-\.]+)\s*\}", query)
                    if unresolved:
                        first_missing = unresolved[0][0] or unresolved[0][1]
                        cols_available = list(row.keys())
                        raise DomainError(
                            f"Parâmetro não encontrado no nó a montante: '{{{first_missing}}}'. "
                            f"Colunas disponíveis em '{upstream_id}': {cols_available}",
                            code="ERR_UNRESOLVED_TOKEN"
                        )
                    cur.execute(query)
                    col_names = [desc[0] for desc in cur.description] if cur.description else ["result"]
                    batch = cur.fetchall()
                    res_df = batch_to_polars_df(batch, col_names)
                    all_results.append(res_df)
                    total_rows += res_df.height
                    task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)

                cur.close()
                conn.close()
            except Exception as e:
                if not conn.closed:
                    conn.close()
                raise DomainError(f"Erro durante a iteração de query SQL: {sanitize_message(str(e))}", code="ERR_DB_QUERY")

        if all_results:
            non_empty = [df for df in all_results if df.height > 0]
            if non_empty:
                combined = pl.concat(non_empty, how="diagonal_relaxed")
            else:
                combined = all_results[0]
        else:
            combined = pl.DataFrame()

        if not combined.columns:
            node_schema = cfg.get("schema") or cfg.get("schema_definitions") or []
            if node_schema:
                combined = create_empty_df_from_schema(schema_defs=node_schema)

        node_buffers[phys_op.id] = [combined]
        logger.info(f"Nó Iterativo '{phys_op.id}': {upstream_df.height} iterações executadas com sucesso ({combined.height} registros combinados via Union).")

    def _execute_file_scan(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        source_path = cfg.get("source", "")
        fmt = cfg.get("format", "csv")
        projected = cfg.get("projected_columns")
        pushed_filter = cfg.get("pushed_filter")
        enable_duckdb = cfg.get("enable_duckdb_view", False)

        # Se a opção DuckDB in-memory estiver ativada
        if enable_duckdb:
            custom_query = cfg.get("duckdb_query")
            df = self.duckdb_runner.execute_query_on_file(source_path, format_hint=fmt, custom_query=custom_query)
            task.record_progress(rows_in_increment=df.height, rows_out_increment=df.height)
            node_buffers[phys_op.id] = [df]
            return

        schema_defs = cfg.get("schema_definitions") or (cfg.get("raw_config") or {}).get("schema_definitions") or []
        schema_overrides = None
        if schema_defs and isinstance(schema_defs, list):
            from src.core.application.metadata.schema_inferer import map_type_name_to_polars
            schema_overrides = {}
            for col in schema_defs:
                if isinstance(col, dict) and col.get("name"):
                    schema_overrides[col["name"]] = map_type_name_to_polars(col.get("type", "String"))

        chunks: List[pl.DataFrame] = []
        for chunk in self.file_connector.read_chunks(
            source_path,
            file_format=fmt,
            chunk_size=plan.default_chunk_size,
            columns=projected,
            schema_overrides=schema_overrides
        ):
            token.check_cancelled()

            # Se houver filtro empurrado para a fonte
            if pushed_filter:
                chunk, _ = self.polars_runner.execute_filter(chunk, pushed_filter)

            task.record_progress(rows_in_increment=chunk.height, rows_out_increment=chunk.height)
            chunks.append(chunk)

        node_buffers[phys_op.id] = chunks

    def _execute_db_scan(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        query = (cfg.get("source") or cfg.get("query") or "").strip()
        if not query:
            raise DomainError(f"Nó '{phys_op.id}': Nenhuma consulta SQL configurada.", code="ERR_EMPTY_QUERY")

        fmt = str(cfg.get("format", "postgres")).lower()

        # Oracle Database Scan
        if fmt == "oracle":
            fetch_size = int(cfg.get("fetch_size") or plan.default_chunk_size or 10000)
            pushed_filter = cfg.get("pushed_filter")
            chunks: List[pl.DataFrame] = []

            for chunk_df in self.oracle_connector.execute_query_chunks(cfg, query, fetch_size=fetch_size):
                token.check_cancelled()
                if pushed_filter:
                    chunk_df, _ = self.polars_runner.execute_filter(chunk_df, pushed_filter)
                task.record_progress(
                    rows_in_increment=chunk_df.height,
                    rows_out_increment=chunk_df.height
                )
                chunks.append(chunk_df)

            node_buffers[phys_op.id] = chunks
            return

        # DuckDB Scan
        if fmt == "duckdb":
            raw_cfg = cfg.get("raw_config") or {}
            conn_details = cfg.get("connection_details") or {}
            ref_path = cfg.get("connection_ref") if (cfg.get("connection_ref") and (cfg.get("connection_ref") == ":memory:" or str(cfg.get("connection_ref")).endswith(".duckdb") or str(cfg.get("connection_ref")).endswith(".db"))) else None
            raw_db_path = (
                raw_cfg.get("database_path")
                or raw_cfg.get("database")
                or raw_cfg.get("path")
                or cfg.get("database_path")
                or cfg.get("database")
                or conn_details.get("database_path")
                or conn_details.get("database")
                or ref_path
                or "data/output.duckdb"
            )
            from src.core.application.workspace.workspace_manager import workspace_manager
            db_path = workspace_manager.resolve_duckdb_path(raw_db_path)
            pushed_filter = cfg.get("pushed_filter")

            import duckdb
            duck_conn = duckdb.connect(db_path)
            try:
                res_df = duck_conn.execute(query).pl()
                if pushed_filter:
                    res_df, _ = self.polars_runner.execute_filter(res_df, pushed_filter)
                task.record_progress(rows_in_increment=res_df.height, rows_out_increment=res_df.height)
                node_buffers[phys_op.id] = [res_df]
            finally:
                duck_conn.close()
            return

        conn_details = cfg.get("connection_details") or {}
        host = conn_details.get("host") or "localhost"
        port = int(conn_details.get("port") or 5432)
        database = conn_details.get("database") or "postgres"
        username = conn_details.get("username") or "postgres"
        password = conn_details.get("password") or ""
        sslmode = conn_details.get("sslMode") or conn_details.get("sslmode") or "prefer"

        import psycopg2

        logger.info(f"Conectando ao PostgreSQL {host}:{port}/{database} como '{username}'...")
        try:
            conn = psycopg2.connect(
                dbname=database,
                user=username,
                password=password,
                host=host,
                port=port,
                sslmode=sslmode,
                connect_timeout=15
            )
        except Exception as e:
            raw_err = str(e)
            logger.error(f"Erro de conexão com PostgreSQL: {raw_err}")
            raise DomainError(
                f"Falha ao conectar no banco PostgreSQL ({host}:{port}/{database}): {sanitize_message(raw_err)}",
                code="ERR_DB_CONNECTION"
            )

        try:
            try:
                with conn.cursor() as setup_cur:
                    setup_cur.execute("SET statement_timeout = 0;")
            except Exception:
                pass

            fetch_size = int(cfg.get("fetch_size") or plan.default_chunk_size or 10000)
            clean_id = "".join(c if c.isalnum() or c == "_" else "_" for c in str(phys_op.id))
            cursor_name = f"cur_fetch_{clean_id}_{int(time.time() * 1000)}"
            cur = conn.cursor(name=cursor_name)
            cur.itersize = fetch_size
            cur.execute(query)
            col_names = [desc[0] for desc in cur.description] if cur.description else None
            pushed_filter = cfg.get("pushed_filter")
            chunks: List[pl.DataFrame] = []

            while True:
                token.check_cancelled()
                batch = cur.fetchmany(fetch_size)
                if not batch:
                    break

                if not col_names and cur.description:
                    col_names = [desc[0] for desc in cur.description]
                actual_cols = col_names or (["result"] if not batch else [f"col_{i}" for i in range(len(batch[0]))])

                chunk_df = batch_to_polars_df(batch, actual_cols)

                if pushed_filter:
                    chunk_df, _ = self.polars_runner.execute_filter(chunk_df, pushed_filter)

                task.record_progress(
                    rows_in_increment=chunk_df.height,
                    rows_out_increment=chunk_df.height
                )
                chunks.append(chunk_df)

            if not chunks:
                if not col_names and cur.description:
                    col_names = [desc[0] for desc in cur.description]
                actual_cols = col_names or ["result"]
                empty_df = pl.DataFrame({c: [] for c in actual_cols})
                chunks.append(empty_df)
                task.record_progress(rows_in_increment=0, rows_out_increment=0)

            node_buffers[phys_op.id] = chunks
            cur.close()
            conn.close()
            logger.info(f"Nó '{phys_op.id}': Leitura concluída do banco com sucesso ({sum(c.height for c in chunks)} linhas).")
        except Exception as q_err:
            if not conn.closed:
                conn.close()
            raw_err = str(q_err)
            logger.error(f"Erro na execução da query: {raw_err}")
            raise DomainError(
                f"Erro ao executar query SQL no banco: {sanitize_message(raw_err)}",
                code="ERR_DB_QUERY"
            )

    def _get_node_chunks(self, node_ref: str, node_buffers: Dict[str, List[pl.DataFrame]]) -> List[pl.DataFrame]:
        """Obtém chunks do buffer considerando referências a portas (ex: 'node_id:port_name' ou 'node_id')."""
        if not node_ref:
            return []
        if node_ref in node_buffers:
            return node_buffers[node_ref]
        clean_colon = node_ref.replace(".", ":")
        if clean_colon in node_buffers:
            return node_buffers[clean_colon]
        clean_dot = node_ref.replace(":", ".")
        if clean_dot in node_buffers:
            return node_buffers[clean_dot]
        # Se for apenas o node_id base
        base_id = node_ref.split(":")[0].split(".")[0]
        if base_id in node_buffers:
            return node_buffers[base_id]
        return []

    def _execute_filter_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        input_id = phys_op.input_ids[0]
        input_chunks = self._get_node_chunks(input_id, node_buffers)
        expression = cfg.get("predicate", "")

        output_chunks: List[pl.DataFrame] = []
        for chunk in input_chunks:
            token.check_cancelled()
            accepted, rejected = self.polars_runner.execute_filter(chunk, expression, capture_rejects=True)
            rej_count = rejected.height if rejected is not None else 0

            task.record_progress(
                rows_in_increment=chunk.height,
                rows_out_increment=accepted.height,
                rejected_increment=rej_count
            )
            output_chunks.append(accepted)

        node_buffers[phys_op.id] = output_chunks

    def _execute_project_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        input_id = phys_op.input_ids[0]
        input_chunks = self._get_node_chunks(input_id, node_buffers)
        columns = cfg.get("columns", [])

        output_chunks: List[pl.DataFrame] = []
        for chunk in input_chunks:
            token.check_cancelled()
            projected = self.polars_runner.execute_project(chunk, columns)
            task.record_progress(
                rows_in_increment=chunk.height,
                rows_out_increment=projected.height
            )
            output_chunks.append(projected)

        node_buffers[phys_op.id] = output_chunks

    def _execute_join_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        left_id = phys_op.input_ids[0]
        right_id = phys_op.input_ids[1]

        left_chunks = self._get_node_chunks(left_id, node_buffers)
        right_chunks = self._get_node_chunks(right_id, node_buffers)

        token.check_cancelled()
        left_df = pl.concat(left_chunks) if left_chunks else pl.DataFrame()
        right_df = pl.concat(right_chunks) if right_chunks else pl.DataFrame()

        joined_df = self.duckdb_runner.execute_join(
            left_df=left_df,
            right_df=right_df,
            left_keys=cfg.get("left_keys", []),
            right_keys=cfg.get("right_keys", []),
            join_type=cfg.get("join_type", "inner")
        )

        task.record_progress(
            rows_in_increment=left_df.height + right_df.height,
            rows_out_increment=joined_df.height
        )
        node_buffers[phys_op.id] = [joined_df]

    def _execute_tmap_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        """Executa transformações e mapeamento visual complexo estilo tMap com suporte a match models e múltiplos outputs."""
        input_ids = phys_op.input_ids
        if not input_ids:
            node_buffers[phys_op.id] = []
            return

        main_id = cfg.get("main_input_id") or input_ids[0]
        main_chunks = self._get_node_chunks(main_id, node_buffers)
        main_df = pl.concat(main_chunks) if main_chunks else pl.DataFrame()
        initial_rows = main_df.height

        lookups = cfg.get("lookups", [])
        lookup_dfs: Dict[str, pl.DataFrame] = {}
        for lk in lookups:
            lk_id = lk.get("node_id") or lk.get("id") or ""
            if lk_id:
                lk_chunks = self._get_node_chunks(lk_id, node_buffers)
                lookup_dfs[lk_id] = pl.concat(lk_chunks) if lk_chunks else pl.DataFrame()

        variables = cfg.get("variables", [])
        outputs = cfg.get("outputs", [])

        # Executa transformação avançada com DuckDB
        results = self.duckdb_runner.execute_tmap_transform(
            main_df=main_df,
            lookups=lookups,
            lookup_dfs=lookup_dfs,
            variables=variables,
            outputs=outputs,
            main_alias=cfg.get("main_alias", "row1"),
            main_node_id=main_id
        )

        total_out_rows = sum(df.height for df in results.values())
        task.record_progress(rows_in_increment=initial_rows, rows_out_increment=total_out_rows)

        # Salva as saídas individuais para roteamento multi-porta
        # e salva a primeira/principal saída como buffer padrão do nó
        first_df = pl.DataFrame()
        for out_name, out_df in results.items():
            node_buffers[f"{phys_op.id}:{out_name}"] = [out_df]
            node_buffers[f"{phys_op.id}.{out_name}"] = [out_df]
            if first_df.is_empty():
                first_df = out_df

        # Default fallback
        node_buffers[phys_op.id] = [first_df]

    def _execute_sink_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        if not phys_op.input_ids:
            logger.warning(f"Nó sink '{phys_op.id}' não possui nós conectados como entrada.")
            return

        input_id = phys_op.input_ids[0]
        input_chunks = self._get_node_chunks(input_id, node_buffers)

        # Pass-through: disponibiliza os chunks de entrada no buffer do nó de sink
        # permitindo que nós subsequentes (ex: tMap ou outro Target) continuem o fluxo
        node_buffers[phys_op.id] = input_chunks
        node_buffers[f"{phys_op.id}:main"] = input_chunks
        node_buffers[f"{phys_op.id}.main"] = input_chunks

        # Filtra e projeta as colunas definidas no schema do componente (projeção e tipagem explícitas)
        schema_cols = cfg.get("schema_columns") or []
        schema_defs = cfg.get("schema_definitions") or []
        if not schema_cols and schema_defs:
            schema_cols = [c.get("name") for c in schema_defs if isinstance(c, dict) and c.get("name")]

        if schema_cols or schema_defs:
            if not input_chunks:
                input_chunks = [create_empty_df_from_schema(schema_defs, schema_cols)]
            else:
                filtered_chunks = []
                for chunk in input_chunks:
                    if len(chunk.columns) == 0:
                        filtered_chunks.append(create_empty_df_from_schema(schema_defs, schema_cols))
                    else:
                        available_cols = [c for c in schema_cols if c in chunk.columns]
                        if available_cols:
                            proj_chunk = chunk.select(available_cols)
                        else:
                            proj_chunk = chunk
                        if schema_defs:
                            proj_chunk = cast_df_to_schema(proj_chunk, schema_defs)
                        filtered_chunks.append(proj_chunk)
                input_chunks = filtered_chunks

        # Remove chunks vazios sem colunas para não disparar erro no driver DuckDB
        input_chunks = [ch for ch in input_chunks if len(ch.columns) > 0]
        if not input_chunks:
            logger.info(f"Nó sink '{phys_op.id}': Nenhum registro ou coluna produzido pelos nós upstream.")
            task.record_progress(rows_in_increment=0, rows_out_increment=0)
            return

        fmt = str(cfg.get("format") or "csv").lower()

        # Destino DuckDB
        if fmt == "duckdb":
            raw_cfg = cfg.get("raw_config") or {}
            conn_details = cfg.get("connection_details") or {}
            ref_path = cfg.get("connection_ref") if (cfg.get("connection_ref") and (cfg.get("connection_ref") == ":memory:" or str(cfg.get("connection_ref")).endswith(".duckdb") or str(cfg.get("connection_ref")).endswith(".db"))) else None
            
            # Prioridade explícita para o caminho/nome de arquivo digitado pelo usuário no componente:
            raw_db_path = (
                raw_cfg.get("database_path")
                or raw_cfg.get("database")
                or raw_cfg.get("path")
                or cfg.get("database_path")
                or cfg.get("database")
                or conn_details.get("database_path")
                or conn_details.get("database")
                or ref_path
                or "data/output.duckdb"
            )

            from src.core.application.workspace.workspace_manager import workspace_manager
            db_path = workspace_manager.resolve_duckdb_path(raw_db_path)

            table = (
                (raw_cfg.get("table") or "").strip()
                or (raw_cfg.get("target") or "").strip()
                or (cfg.get("table") or "").strip()
                or (cfg.get("target") or "").strip()
                or "output_table"
            )
            table_act = raw_cfg.get("table_action") or cfg.get("table_action", "none")
            data_act = raw_cfg.get("data_action") or cfg.get("data_action", "insert")
            keys = raw_cfg.get("keys") or cfg.get("keys", [])
            use_batch = bool(raw_cfg.get("use_batch_mode", cfg.get("use_batch_mode", True)))
            batch_sz = int(raw_cfg.get("batch_size") or cfg.get("batch_size") or 10000)

            total = 0
            for idx, chunk in enumerate(input_chunks):
                token.check_cancelled()
                written = self.duckdb_runner.write_to_duckdb(
                    df=chunk,
                    database_path=db_path,
                    table_name=table,
                    table_action=table_act,
                    data_action=data_act,
                    keys=keys,
                    is_first_chunk=(idx == 0),
                    schema_definitions=schema_defs,
                    use_batch_mode=use_batch,
                    batch_size=batch_sz
                )
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó DuckDB sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}' em '{db_path}' (Batch Mode: {use_batch}, Lote: {batch_sz}).")
            return

        # Destino PostgreSQL com Ação de Tabela e Dados
        if fmt in ("postgres", "postgresql", "db"):
            conn_details = cfg.get("connection_details") or {}
            if conn_details or cfg.get("connection_ref"):
                table = (
                    (raw_cfg.get("table") or "").strip()
                    or (raw_cfg.get("target") or "").strip()
                    or (cfg.get("table") or "").strip()
                    or (cfg.get("target") or "").strip()
                    or "output_table"
                )
                table_act = cfg.get("table_action", "none")
                data_act = cfg.get("data_action", "insert")
                keys = cfg.get("keys", [])
                use_batch = bool(cfg.get("use_batch_mode", True))
                batch_sz = int(cfg.get("batch_size") or 10000)

                conn = self._build_connection_from_cfg(cfg, "postgres")
                from src.core.infrastructure.connectors.postgres_connector import PostgresConnector
                pg_conn = PostgresConnector(self.secret_resolver)

                total = 0
                for idx, chunk in enumerate(input_chunks):
                    token.check_cancelled()
                    written = pg_conn.execute_write(
                        connection=conn,
                        table_name=table,
                        df=chunk,
                        table_action=table_act,
                        data_action=data_act,
                        keys=keys,
                        is_first_chunk=(idx == 0),
                        use_batch_mode=use_batch,
                        batch_size=batch_sz
                    )
                    total += written
                    task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
                logger.info(f"Nó PostgreSQL sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}' (Batch Mode: {use_batch}, Lote: {batch_sz}).")
                return

        # Destino Oracle Database
        if fmt == "oracle":
            conn_details = cfg.get("connection_details") or {}
            if conn_details or cfg.get("connection_ref"):
                table = (
                    (raw_cfg.get("table") or "").strip()
                    or (raw_cfg.get("target") or "").strip()
                    or (cfg.get("table") or "").strip()
                    or (cfg.get("target") or "").strip()
                    or "output_table"
                )
                table_act = cfg.get("table_action", "none")
                data_act = cfg.get("data_action", "insert")
                keys = cfg.get("keys", [])
                use_batch = bool(cfg.get("use_batch_mode", True))
                batch_sz = int(cfg.get("batch_size") or 10000)

                total = 0
                for idx, chunk in enumerate(input_chunks):
                    token.check_cancelled()
                    written = self.oracle_connector.execute_write(
                        connection=cfg,
                        table_name=table,
                        df=chunk,
                        table_action=table_act,
                        data_action=data_act,
                        keys=keys,
                        is_first_chunk=(idx == 0),
                        use_batch_mode=use_batch,
                        batch_size=batch_sz
                    )
                    total += written
                    task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
                logger.info(f"Nó Oracle sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}' (Batch Mode: {use_batch}, Lote: {batch_sz}).")
                return

        if fmt == "scylla":
            conn = self._build_connection_from_cfg(cfg, "scylla")
            table = cfg.get("target") or cfg.get("table") or "records"
            write_strategy = cfg.get("write_strategy") or "concurrent"
            concurrency = int(cfg.get("concurrency") or 100)
            batch_size = int(cfg.get("batch_size") or 1000)
            consistency = cfg.get("consistency_level") or cfg.get("consistencyLevel") or "LOCAL_QUORUM"
            table_action = str(cfg.get("table_action") or "append").lower()
            truncate_flag = (table_action == "truncate")
            timeout = int(cfg.get("timeout_seconds") or cfg.get("timeout") or 30)

            total = 0
            for idx, chunk in enumerate(input_chunks):
                should_truncate = truncate_flag and (idx == 0)
                written = self.scylla_connector.write_rows(
                    conn,
                    table=table,
                    df=chunk,
                    write_strategy=write_strategy,
                    concurrency=concurrency,
                    batch_size=batch_size,
                    consistency_level=consistency,
                    truncate=should_truncate,
                    timeout=timeout
                )
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó Scylla sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}' (Estratégia: {write_strategy}, Concorrência: {concurrency}, Batch: {batch_size}).")
            return

        if fmt == "kafka":
            conn = self._build_connection_from_cfg(cfg, "kafka")
            topic = cfg.get("target") or cfg.get("topic") or "output-topic"
            total = 0
            for chunk in input_chunks:
                written = self.kafka_connector.produce_batch(conn, topic=topic, df=chunk)
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó Kafka sink '{phys_op.id}': {total} mensagens produzidas no tópico '{topic}'.")
            return

        if fmt in ("sqs", "aws_sqs"):
            conn = self._build_connection_from_cfg(cfg, "aws_sqs")
            queue_url = cfg.get("target") or cfg.get("queue_url") or ""
            total = 0
            for chunk in input_chunks:
                written = self.aws_messaging_connector.send_sqs_messages(conn, queue_url=queue_url, df=chunk)
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó SQS sink '{phys_op.id}': {total} mensagens enviadas para '{queue_url}'.")
            return

        if fmt in ("sns", "aws_sns"):
            conn = self._build_connection_from_cfg(cfg, "aws_sns")
            topic_arn = cfg.get("target") or cfg.get("topic_arn") or ""
            total = 0
            for chunk in input_chunks:
                written = self.aws_messaging_connector.publish_sns_messages(conn, topic_arn=topic_arn, df=chunk)
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó SNS sink '{phys_op.id}': {total} mensagens publicadas no tópico '{topic_arn}'.")
            return

        target_path = (cfg.get("target") or cfg.get("path") or "").strip().strip('"').strip("'")
        if not target_path:
            raise DomainValidationError(f"Nó '{phys_op.id}': Caminho de destino (path) não informado.")
        if target_path.lower().endswith(".csv"):
            fmt = "csv"
        elif target_path.lower().endswith(".parquet"):
            fmt = "parquet"
        elif target_path.lower().endswith(".json"):
            fmt = "json"

        raw_mode = str(cfg.get("write_mode", "append")).lower()
        initial_write_mode = "replace" if ("replace" in raw_mode or "overwrite" in raw_mode) else "append"

        # Filter out empty / zero-column chunks to avoid schema mismatch on append
        valid_chunks = [c for c in input_chunks if c.height > 0 and c.width > 0]

        total_written = 0
        if not valid_chunks:
            logger.warning(f"Nó sink '{phys_op.id}': Nenhum registro válido para gravar em '{target_path}'.")
            task.record_progress(rows_in_increment=0, rows_out_increment=0)
            return

        for idx, chunk in enumerate(valid_chunks):
            token.check_cancelled()
            # O primeiro chunk respeita o write_mode (replace/append).
            # Chunks subsequentes do mesmo pipeline sempre usam append.
            mode_to_use = initial_write_mode if idx == 0 else "append"

            written = self.file_connector.write_dataframe(
                chunk,
                file_path=target_path,
                file_format=fmt,
                write_mode=mode_to_use
            )
            total_written += written
            task.record_progress(
                rows_in_increment=chunk.height,
                rows_out_increment=written
            )
        logger.info(f"Nó sink '{phys_op.id}': {total_written} linhas gravadas em '{target_path}'.")

    def _execute_barrier_node(
        self,
        phys_op: Any,
        cfg: Dict[str, Any],
        execution: Execution,
        token: CancellationToken,
        task: Any,
        node_buffers: Dict[str, List[pl.DataFrame]]
    ) -> None:
        """Executa um nó de sincronização / semáforo (Sync Barrier / Wait All).

        Garante que todas as ramificações ou nós upstream concluíram com sucesso
        antes de liberar o fluxo para os nós subsequentes.
        """
        token.check_cancelled()
        inputs = phys_op.input_ids
        raw_cfg = cfg.get("raw_config") or {}
        failure_policy = raw_cfg.get("failure_policy") or cfg.get("failure_policy", "fail_fast")

        for inp_id in inputs:
            upstream_task = execution.tasks.get(inp_id)
            if upstream_task:
                if upstream_task.status == ExecutionStatus.FAILED and failure_policy == "fail_fast":
                    raise DomainError(
                        f"Barreira '{phys_op.id}' interrompida: dependência upstream '{inp_id}' falhou.",
                        code="ERR_BARRIER_UPSTREAM_FAILED"
                    )

        # Barreira passa um DataFrame vazio (ou propaga os buffers upstream se houver) para manter integridade
        upstream_chunks = []
        for inp_id in inputs:
            if inp_id in node_buffers and node_buffers[inp_id]:
                upstream_chunks.extend(node_buffers[inp_id])

        node_buffers[phys_op.id] = upstream_chunks if upstream_chunks else [pl.DataFrame()]
        task.record_progress(rows_in_increment=0, rows_out_increment=0)
        logger.info(f"Nó de barreira '{phys_op.id}' sincronizado com sucesso ({len(inputs)} entradas conectadas).")

