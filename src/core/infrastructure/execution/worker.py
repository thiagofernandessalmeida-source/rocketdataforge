"""Executor Assíncrono Local (ExecutionWorker).

Orquestra a passagem de dados entre operadores do plano físico,
coleta métricas atômicas e verifica periodicamente o token de cancelamento cooperativo.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional

import polars as pl
from src.core.application.compiler.physical_planner import PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.shared.exceptions import DomainError
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.connectors.file_connector import LocalFileConnector
from src.core.infrastructure.connectors.scylla_connector import ScyllaConnector
from src.core.infrastructure.connectors.kafka_connector import KafkaConnector
from src.core.infrastructure.connectors.aws_messaging_connector import AwsMessagingConnector
from src.core.infrastructure.engines.duckdb_runner import DuckDBRunner
from src.core.infrastructure.engines.polars_runner import PolarsRunner
from src.core.infrastructure.execution.cancellation import CancellationToken
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver

logger = logging.getLogger(__name__)


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

        try:
            for node_id in plan.execution_order:
                # Verifica cancelamento antes de iniciar cada nó
                token.check_cancelled()

                phys_op = plan.operators[node_id]
                task = execution.tasks.get(node_id) or execution.add_task(node_id)
                task.status = ExecutionStatus.RUNNING
                task.started_at = datetime.now(timezone.utc)

                op_type = phys_op.operator_type
                cfg = phys_op.config

                if op_type == "scan":
                    self._execute_scan_node(phys_op, cfg, plan, token, task, node_buffers)

                elif op_type == "filter":
                    self._execute_filter_node(phys_op, cfg, token, task, node_buffers)

                elif op_type == "project":
                    self._execute_project_node(phys_op, cfg, token, task, node_buffers)

                elif op_type == "join":
                    self._execute_join_node(phys_op, cfg, token, task, node_buffers)

                elif op_type == "sink":
                    self._execute_sink_node(phys_op, cfg, token, task, node_buffers)

                task.complete(datetime.now(timezone.utc))

            execution.succeed()

        except DomainError as de:
            if de.code == "ERR_EXECUTION_CANCELLED" or token.is_cancelled():
                logger.info(f"Execução '{execution.id}' cancelada com sucesso.")
                execution.request_cancellation()
                execution.complete_cancellation()
            else:
                logger.error(f"Falha na execução '{execution.id}': {de.message}")
                execution.fail(de.code, sanitize_message(de.message))
        except Exception as e:
            raw_msg = str(e)
            logger.exception(f"Erro inesperado na execução '{execution.id}': {raw_msg}")
            execution.fail("ERR_EXECUTION_INTERNAL", sanitize_message(raw_msg))

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

        secret = conn_details.get("password") or conn_details.get("secretKey") or conn_details.get("secret_ref") or "secret://empty"
        if not str(secret).startswith("secret://"):
            secret_key = f"SECRET_{connector_type.upper()}"
            self.secret_resolver.custom_env[secret_key] = str(secret)
            secret_ref = SecretReference(f"secret://env/{secret_key}")
        else:
            secret_ref = SecretReference(str(secret))

        return Connection(
            id=f"conn_{connector_type}",
            project_id="proj_default",
            name=f"Connection {connector_type}",
            connector_type=connector_type,
            endpoint=str(endpoint),
            secret_ref=secret_ref,
            options={**conn_details, **raw_cfg}
        )

    def _execute_scan_node(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        fmt = str(cfg.get("format", "csv")).lower()

        if fmt == "scylla":
            conn = self._build_connection_from_cfg(cfg, "scylla")
            query = cfg.get("source") or cfg.get("query") or ""
            df = self.scylla_connector.read_cql(conn, query=query)
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

    def _execute_file_scan(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        source_path = cfg.get("source", "")
        fmt = cfg.get("format", "csv")
        projected = cfg.get("projected_columns")
        pushed_filter = cfg.get("pushed_filter")

        chunks: List[pl.DataFrame] = []
        for chunk in self.file_connector.read_chunks(
            source_path,
            file_format=fmt,
            chunk_size=plan.default_chunk_size,
            columns=projected
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

        conn_details = cfg.get("connection_details") or {}
        host = conn_details.get("host") or "localhost"
        port = int(conn_details.get("port") or 5432)
        database = conn_details.get("database") or "postgres"
        username = conn_details.get("username") or "postgres"
        password = conn_details.get("password") or ""
        sslmode = conn_details.get("sslMode") or "prefer"

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
            cur = conn.cursor()
            cur.execute(query)
            col_names = [desc[0] for desc in cur.description] if cur.description else ["result"]
            pushed_filter = cfg.get("pushed_filter")
            chunk_size = plan.default_chunk_size or 10000
            chunks: List[pl.DataFrame] = []

            while True:
                token.check_cancelled()
                batch = cur.fetchmany(chunk_size)
                if not batch:
                    break

                try:
                    chunk_df = pl.DataFrame(batch, schema=col_names, orient="row")
                except Exception:
                    import pandas as pd
                    pdf = pd.DataFrame(batch, columns=col_names)
                    chunk_df = pl.from_pandas(pdf)

                if pushed_filter:
                    chunk_df, _ = self.polars_runner.execute_filter(chunk_df, pushed_filter)

                task.record_progress(
                    rows_in_increment=chunk_df.height,
                    rows_out_increment=chunk_df.height
                )
                chunks.append(chunk_df)

            if not chunks:
                empty_df = pl.DataFrame({c: [] for c in col_names})
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

    def _execute_filter_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        input_id = phys_op.input_ids[0]
        input_chunks = node_buffers.get(input_id, [])
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
        input_chunks = node_buffers.get(input_id, [])
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

        left_chunks = node_buffers.get(left_id, [])
        right_chunks = node_buffers.get(right_id, [])

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

    def _execute_sink_node(
        self, phys_op, cfg, token, task, node_buffers
    ) -> None:
        if not phys_op.input_ids:
            logger.warning(f"Nó sink '{phys_op.id}' não possui nós conectados como entrada.")
            return

        input_id = phys_op.input_ids[0]
        input_chunks = node_buffers.get(input_id, [])

        fmt = str(cfg.get("format") or "csv").lower()

        if fmt == "scylla":
            conn = self._build_connection_from_cfg(cfg, "scylla")
            table = cfg.get("target") or cfg.get("table") or "records"
            total = 0
            for chunk in input_chunks:
                written = self.scylla_connector.write_rows(conn, table=table, df=chunk)
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó Scylla sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}'.")
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

        total_written = 0
        if not input_chunks:
            # Garante gravação mesmo se o buffer for vazio
            dummy_empty = pl.DataFrame()
            written = self.file_connector.write_dataframe(
                dummy_empty,
                file_path=target_path,
                file_format=fmt,
                write_mode=initial_write_mode
            )
            task.record_progress(rows_in_increment=0, rows_out_increment=written)
            return

        for idx, chunk in enumerate(input_chunks):
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
