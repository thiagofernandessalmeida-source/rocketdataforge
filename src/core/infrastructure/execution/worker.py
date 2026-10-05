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

                elif op_type == "tmap":
                    self._execute_tmap_node(phys_op, cfg, token, task, node_buffers)

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

    def _interpolate_tokens(self, text: str, row_dict: Dict[str, Any], upstream_id: str) -> str:
        """Substitui referências a {upstream_id.col} e {col} pelos valores da linha atual."""
        res = text
        for col, val in row_dict.items():
            formatted_val = f"'{val}'" if isinstance(val, str) else str(val) if val is not None else "NULL"
            res = res.replace(f"{{{upstream_id}.{col}}}", formatted_val)
            res = res.replace(f"{{{col}}}", formatted_val)
        return res

    def _execute_scan_node(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        fmt = str(cfg.get("format", "csv")).lower()

        # Verifica se é um Scan Iterativo com nós a montante
        if phys_op.input_ids:
            self._execute_iterative_scan(phys_op, cfg, plan, token, task, node_buffers)
            return

        if fmt == "duckdb":
            db_path = cfg.get("connection_ref") or cfg.get("database_path") or ":memory:"
            query = cfg.get("source") or cfg.get("query") or ""
            df = self.duckdb_runner.execute_query_on_database(db_path, query)
            task.record_progress(rows_in_increment=df.height, rows_out_increment=df.height)
            node_buffers[phys_op.id] = [df]
            return

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

    def _execute_iterative_scan(
        self, phys_op, cfg, plan, token, task, node_buffers
    ) -> None:
        """Executa leitura parametrizada linha a linha sobre o fluxo do nó a montante (Sem tFlowToIterate)."""
        upstream_id = phys_op.input_ids[0]
        upstream_chunks = node_buffers.get(upstream_id, [])
        if not upstream_chunks:
            node_buffers[phys_op.id] = []
            return

        upstream_df = pl.concat(upstream_chunks)
        fmt = str(cfg.get("format", "postgres")).lower()
        base_query = (cfg.get("source") or cfg.get("query") or "").strip()

        all_results: List[pl.DataFrame] = []
        total_rows = 0

        # Para DuckDB
        if fmt == "duckdb":
            db_path = cfg.get("connection_ref") or cfg.get("database_path") or ":memory:"
            for row in upstream_df.iter_rows(named=True):
                token.check_cancelled()
                query = self._interpolate_tokens(base_query, row, upstream_id)
                res_df = self.duckdb_runner.execute_query_on_database(db_path, query)
                all_results.append(res_df)
                total_rows += res_df.height
                task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)

        # Para Banco de Dados (PostgreSQL / Relacional)
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
                for row in upstream_df.iter_rows(named=True):
                    token.check_cancelled()
                    query = self._interpolate_tokens(base_query, row, upstream_id)
                    cur.execute(query)
                    col_names = [desc[0] for desc in cur.description] if cur.description else ["result"]
                    batch = cur.fetchall()
                    if batch:
                        try:
                            res_df = pl.DataFrame(batch, schema=col_names, orient="row")
                        except Exception:
                            import pandas as pd
                            res_df = pl.from_pandas(pd.DataFrame(batch, columns=col_names))
                    else:
                        res_df = pl.DataFrame({c: [] for c in col_names})

                    all_results.append(res_df)
                    total_rows += res_df.height
                    task.record_progress(rows_in_increment=1, rows_out_increment=res_df.height)

                cur.close()
                conn.close()
            except Exception as e:
                if not conn.closed:
                    conn.close()
                raise DomainError(f"Erro durante a iteração de query SQL: {sanitize_message(str(e))}", code="ERR_DB_QUERY")

        combined = pl.concat(all_results) if all_results else pl.DataFrame()
        node_buffers[phys_op.id] = [combined]
        logger.info(f"Nó Iterativo '{phys_op.id}': {upstream_df.height} iterações concluídas ({combined.height} registros gerados).")

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
            outputs=outputs
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

        # Filtra apenas as colunas definidas no schema do componente (projeção explícita)
        schema_cols = cfg.get("schema_columns") or []
        if schema_cols and input_chunks:
            filtered_chunks = []
            for chunk in input_chunks:
                available_cols = [c for c in schema_cols if c in chunk.columns]
                if available_cols:
                    filtered_chunks.append(chunk.select(available_cols))
                else:
                    filtered_chunks.append(chunk)
            input_chunks = filtered_chunks

        fmt = str(cfg.get("format") or "csv").lower()

        # Destino DuckDB
        if fmt == "duckdb":
            db_path = cfg.get("database_path") or "data/output.duckdb"
            table = cfg.get("table") or cfg.get("target") or "output_table"
            table_act = cfg.get("table_action", "none")
            data_act = cfg.get("data_action", "insert")
            keys = cfg.get("keys", [])

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
                    is_first_chunk=(idx == 0)
                )
                total += written
                task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
            logger.info(f"Nó DuckDB sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}'.")
            return

        # Destino PostgreSQL com Ação de Tabela e Dados
        if fmt in ("postgres", "postgresql", "db"):
            conn_details = cfg.get("connection_details") or {}
            if conn_details or cfg.get("connection_ref"):
                table = cfg.get("table") or cfg.get("target") or "output_table"
                table_act = cfg.get("table_action", "none")
                data_act = cfg.get("data_action", "insert")
                keys = cfg.get("keys", [])

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
                        is_first_chunk=(idx == 0)
                    )
                    total += written
                    task.record_progress(rows_in_increment=chunk.height, rows_out_increment=written)
                logger.info(f"Nó PostgreSQL sink '{phys_op.id}': {total} linhas gravadas na tabela '{table}'.")
                return

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

