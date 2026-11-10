"""Serviço de Inferência de Schema (SchemaInferer).

Inspeciona fontes de dados e arquivos tabulares por amostragem,
convertendo os tipos físicos nativos para os tipos canônicos de LogicalDataType.
"""

from dataclasses import dataclass, field
import logging
import os
from typing import Any, Dict, List, Optional

import polars as pl
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InferredField:
    """Campo individual inferido de um dataset."""
    name: str
    logical_type: LogicalDataType
    physical_type: str
    nullable: bool = True
    description: Optional[str] = None
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    is_primary_key: bool = False
    origin: List[str] = field(default_factory=list)
    computed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "logical_type": self.logical_type.value,
            "physical_type": self.physical_type,
            "nullable": self.nullable,
            "description": self.description,
            "length": self.length,
            "precision": self.precision,
            "scale": self.scale,
            "is_primary_key": self.is_primary_key,
            "origin": self.origin,
            "computed": self.computed,
        }


@dataclass
class InferredSchema:
    """Esquema estrutural inferido de uma fonte ou arquivo."""
    dataset_name: str
    fields: List[InferredField] = field(default_factory=list)
    inference_source: str = "database"
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "fields": [f.to_dict() for f in self.fields],
            "inference_source": self.inference_source,
            "warnings": self.warnings
        }


def map_polars_type_to_logical(pl_type: pl.DataType) -> LogicalDataType:
    """Converte tipos nativos do Polars para LogicalDataType canônico."""
    if pl_type in {pl.Int8, pl.Int16}:
        return LogicalDataType.INT16
    if pl_type == pl.Int32:
        return LogicalDataType.INT32
    if pl_type in {pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64}:
        return LogicalDataType.INT64
    if pl_type == pl.Float32:
        return LogicalDataType.FLOAT32
    if pl_type == pl.Float64:
        return LogicalDataType.FLOAT64
    if pl_type == pl.Boolean:
        return LogicalDataType.BOOLEAN
    if pl_type == pl.String:
        return LogicalDataType.STRING
    if pl_type == pl.Binary:
        return LogicalDataType.BINARY
    if pl_type == pl.Date:
        return LogicalDataType.DATE
    if pl_type in {pl.Time}:
        return LogicalDataType.TIME
    if isinstance(pl_type, pl.Datetime):
        return LogicalDataType.TIMESTAMP_TZ if pl_type.time_zone else LogicalDataType.TIMESTAMP
    if isinstance(pl_type, pl.List):
        return LogicalDataType.ARRAY
    if isinstance(pl_type, pl.Struct):
        return LogicalDataType.STRUCT
    if pl_type == pl.Decimal:
        return LogicalDataType.DECIMAL

def map_type_name_to_polars(type_str: str) -> pl.DataType:
    """Converte nome de tipo (ex: 'String', 'Integer', 'Double') para pl.DataType correspondente."""
    t = (type_str or "string").lower().strip()
    if t in ("string", "text", "varchar", "char", "unknown"):
        return pl.String
    elif t in ("integer", "int", "int32"):
        return pl.Int32
    elif t in ("long", "int64", "bigint"):
        return pl.Int64
    elif t in ("int16", "short", "smallint"):
        return pl.Int16
    elif t in ("float", "float32", "real"):
        return pl.Float32
    elif t in ("double", "float64"):
        return pl.Float64
    elif t in ("decimal", "numeric"):
        return pl.Decimal
    elif t in ("boolean", "bool"):
        return pl.Boolean
    elif t in ("date",):
        return pl.Date
    elif t in ("datetime", "timestamp", "time"):
        return pl.Datetime
    elif t in ("bytes", "binary"):
        return pl.Binary
    elif t in ("json", "object", "array"):
        return pl.String
    return pl.String


POSTGRES_OID_TO_LOGICAL: Dict[int, tuple[LogicalDataType, str]] = {
    16: (LogicalDataType.BOOLEAN, "boolean"),
    17: (LogicalDataType.BINARY, "bytea"),
    20: (LogicalDataType.INT64, "bigint"),
    21: (LogicalDataType.INT16, "smallint"),
    23: (LogicalDataType.INT32, "integer"),
    25: (LogicalDataType.STRING, "text"),
    114: (LogicalDataType.JSON, "json"),
    700: (LogicalDataType.FLOAT32, "real"),
    701: (LogicalDataType.FLOAT64, "double precision"),
    1042: (LogicalDataType.STRING, "character"),
    1043: (LogicalDataType.STRING, "varchar"),
    1082: (LogicalDataType.DATE, "date"),
    1083: (LogicalDataType.TIME, "time"),
    1114: (LogicalDataType.TIMESTAMP, "timestamp"),
    1184: (LogicalDataType.TIMESTAMP_TZ, "timestamptz"),
    1266: (LogicalDataType.TIME, "timetz"),
    1700: (LogicalDataType.DECIMAL, "numeric"),
    2950: (LogicalDataType.STRING, "uuid"),
    3802: (LogicalDataType.JSON, "jsonb"),
    # Arrays
    1000: (LogicalDataType.ARRAY, "boolean[]"),
    1005: (LogicalDataType.ARRAY, "smallint[]"),
    1007: (LogicalDataType.ARRAY, "integer[]"),
    1016: (LogicalDataType.ARRAY, "bigint[]"),
    1009: (LogicalDataType.ARRAY, "text[]"),
    1014: (LogicalDataType.ARRAY, "character[]"),
    1015: (LogicalDataType.ARRAY, "varchar[]"),
    199: (LogicalDataType.ARRAY, "json[]"),
    3807: (LogicalDataType.ARRAY, "jsonb[]"),
    2951: (LogicalDataType.ARRAY, "uuid[]"),
    1021: (LogicalDataType.ARRAY, "real[]"),
    1022: (LogicalDataType.ARRAY, "double precision[]"),
    1231: (LogicalDataType.ARRAY, "numeric[]"),
    1182: (LogicalDataType.ARRAY, "date[]"),
    1115: (LogicalDataType.ARRAY, "timestamp[]"),
    1185: (LogicalDataType.ARRAY, "timestamptz[]"),
}


def map_postgres_type_to_logical(type_ref: Any) -> tuple[LogicalDataType, str]:
    """Mapeia OID ou nome textual do Postgres (format_type) para LogicalDataType e physical_type legível."""
    if isinstance(type_ref, int) or (isinstance(type_ref, str) and type_ref.isdigit()):
        oid = int(type_ref)
        if oid in POSTGRES_OID_TO_LOGICAL:
            return POSTGRES_OID_TO_LOGICAL[oid]
        return LogicalDataType.STRING, f"oid_{oid}"

    t_str = str(type_ref or "").lower().strip()
    if t_str.endswith("[]"):
        return LogicalDataType.ARRAY, t_str

    if t_str in ("int2", "smallint", "smallserial"):
        return LogicalDataType.INT16, "smallint"
    if t_str in ("int4", "integer", "int", "serial"):
        return LogicalDataType.INT32, "integer"
    if t_str in ("int8", "bigint", "bigserial"):
        return LogicalDataType.INT64, "bigint"
    if t_str in ("float4", "real"):
        return LogicalDataType.FLOAT32, "real"
    if t_str in ("float8", "double precision", "double"):
        return LogicalDataType.FLOAT64, "double precision"
    if "numeric" in t_str or "decimal" in t_str:
        return LogicalDataType.DECIMAL, t_str
    if t_str in ("bool", "boolean"):
        return LogicalDataType.BOOLEAN, "boolean"
    if t_str in ("date",):
        return LogicalDataType.DATE, "date"
    if t_str in ("time", "time without time zone"):
        return LogicalDataType.TIME, "time"
    if t_str in ("timetz", "time with time zone"):
        return LogicalDataType.TIME, "timetz"
    if t_str in ("timestamp", "timestamp without time zone"):
        return LogicalDataType.TIMESTAMP, "timestamp"
    if t_str in ("timestamptz", "timestamp with time zone"):
        return LogicalDataType.TIMESTAMP_TZ, "timestamptz"
    if t_str == "uuid":
        return LogicalDataType.STRING, "uuid"
    if t_str in ("json", "jsonb"):
        return LogicalDataType.JSON, t_str
    if t_str == "bytea":
        return LogicalDataType.BINARY, "bytea"
    if any(t_str.startswith(p) for p in ("varchar", "character varying", "char", "character", "text", "citext")):
        return LogicalDataType.STRING, t_str

    return LogicalDataType.STRING, t_str


class SchemaInferer:
    """Serviço para inspeção e inferência de esquemas estruturais."""

    def infer_from_file(self, file_path: str, format_hint: Optional[str] = None, sample_size: int = 1000) -> InferredSchema:
        """Infere schema a partir de arquivo local (CSV, Parquet, JSON) ou texto em memória com detecção robusta."""
        import io
        import duckdb

        raw = file_path.strip().strip('"').strip("'")
        if not raw:
            raise DomainValidationError("O caminho do arquivo não pode ser vazio.")

        # Se o conteúdo contiver quebras de linha ou for texto CSV/JSON direto
        if "\n" in raw or ("," in raw and not raw.endswith(".csv") and not raw.endswith(".txt") and not os.path.sep in raw and "/" not in raw):
            try:
                # Tenta parsear como CSV em memória via DuckDB
                conn = duckdb.connect(":memory:")
                conn.execute("CREATE TABLE _raw_sample AS SELECT * FROM read_csv_auto(?, sample_size=100);", [raw])
                df_desc = conn.execute("DESCRIBE _raw_sample;").pl()
                fields = []
                for row in df_desc.iter_rows(named=True):
                    col_name = row.get("column_name") or row.get("Field") or "col"
                    col_type = str(row.get("column_type") or row.get("Type") or "VARCHAR").upper()
                    logical = LogicalDataType.STRING
                    if "INT" in col_type:
                        logical = LogicalDataType.INT64 if ("BIG" in col_type or "8" in col_type) else LogicalDataType.INT32
                    elif "FLOAT" in col_type or "DOUBLE" in col_type or "REAL" in col_type:
                        logical = LogicalDataType.FLOAT64
                    elif "DECIMAL" in col_type or "NUMERIC" in col_type:
                        logical = LogicalDataType.DECIMAL
                    elif "BOOL" in col_type:
                        logical = LogicalDataType.BOOLEAN
                    elif "DATE" in col_type:
                        logical = LogicalDataType.DATE
                    elif "TIME" in col_type:
                        logical = LogicalDataType.TIMESTAMP

                    fields.append(InferredField(
                        name=col_name,
                        logical_type=logical,
                        physical_type=col_type,
                        nullable=True
                    ))
                return InferredSchema(dataset_name="in_memory_csv", fields=fields)
            except Exception:
                pass

        # Resolução inteligente de caminho do arquivo
        resolved_path = raw
        if not os.path.exists(resolved_path):
            user_downloads = os.path.join(os.path.expanduser("~"), "Downloads", raw)
            candidates = [
                os.path.join("data", raw),
                os.path.join("data", "samples", raw),
                os.path.join("output", raw),
                os.path.abspath(raw),
                os.path.join(os.getcwd(), raw),
                os.path.join(os.getcwd(), "data", raw),
                user_downloads,
            ]
            for c in candidates:
                if os.path.exists(c):
                    resolved_path = c
                    break

        if not os.path.exists(resolved_path):
            raise DomainValidationError(
                f"Arquivo não encontrado: '{raw}'. "
                f"Verifique o caminho (ex: 'data/users.csv' ou 'data/samples/customers.csv') ou informe o caminho absoluto."
            )

        fmt = (format_hint or os.path.splitext(resolved_path)[1].lstrip(".")).lower()
        dataset_name = os.path.splitext(os.path.basename(resolved_path))[0]

        # Tenta inferência com DuckDB (detecção automática de delimitador, encoding e formato)
        try:
            conn = duckdb.connect(":memory:")
            clean_p = resolved_path.replace("\\", "/")
            if fmt == "parquet" or clean_p.endswith(".parquet"):
                query = f"DESCRIBE SELECT * FROM read_parquet('{clean_p}') LIMIT {sample_size};"
            elif fmt == "json" or clean_p.endswith(".json") or clean_p.endswith(".jsonl") or clean_p.endswith(".ndjson"):
                query = f"DESCRIBE SELECT * FROM read_json_auto('{clean_p}') LIMIT {sample_size};"
            else:
                query = f"DESCRIBE SELECT * FROM read_csv_auto('{clean_p}', sample_size={sample_size});"

            df_desc = conn.execute(query).pl()
            fields = []
            for row in df_desc.iter_rows(named=True):
                col_name = str(row.get("column_name") or row.get("Field") or "col")
                col_type = str(row.get("column_type") or row.get("Type") or "VARCHAR").upper()
                logical = LogicalDataType.STRING
                if "INT" in col_type:
                    logical = LogicalDataType.INT64 if ("BIG" in col_type or "8" in col_type) else LogicalDataType.INT32
                elif "FLOAT" in col_type or "DOUBLE" in col_type or "REAL" in col_type:
                    logical = LogicalDataType.FLOAT64
                elif "DECIMAL" in col_type or "NUMERIC" in col_type:
                    logical = LogicalDataType.DECIMAL
                elif "BOOL" in col_type:
                    logical = LogicalDataType.BOOLEAN
                elif "DATE" in col_type:
                    logical = LogicalDataType.DATE
                elif "TIME" in col_type:
                    logical = LogicalDataType.TIMESTAMP

                fields.append(InferredField(
                    name=col_name,
                    logical_type=logical,
                    physical_type=col_type,
                    nullable=True
                ))

            if fields:
                return InferredSchema(dataset_name=dataset_name, fields=fields)
        except Exception:
            pass  # Fallback para Polars

        # Fallback Polars
        try:
            if fmt == "csv":
                df = pl.read_csv(resolved_path, n_rows=sample_size, ignore_errors=True, try_parse_dates=True)
            elif fmt == "parquet":
                df = pl.read_parquet(resolved_path, n_rows=sample_size)
            elif fmt == "json":
                df = pl.read_json(resolved_path)
                if df.height > sample_size:
                    df = df.head(sample_size)
            else:
                raise DomainValidationError(f"Formato não suportado para inferência de schema: '{fmt}'")

            fields: List[InferredField] = []
            for col_name, col_type in df.schema.items():
                logical = map_polars_type_to_logical(col_type)
                fields.append(InferredField(
                    name=col_name,
                    logical_type=logical,
                    physical_type=str(col_type),
                    nullable=True
                ))
            return InferredSchema(dataset_name=dataset_name, fields=fields)
        except Exception as e:
            raise DomainValidationError(f"Falha ao ler amostra do arquivo '{resolved_path}': {str(e)}")

    def infer_from_sql_query(
        self,
        query: str,
        connection_details: Optional[Dict[str, Any]] = None,
        dataset_name: str = "sql_query"
    ) -> InferredSchema:
        """Infere schema executando inspeção de metadados em query SQL real."""
        import re
        import duckdb

        # Substitui tokens {node_id.col} por NULL para permitir inspeção sem erro de tipo (ex: WHERE text_col = NULL)
        sanitized_query = re.sub(r"\{[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_]+\}", "NULL", query)
        sanitized_query = re.sub(r"\{[a-zA-Z0-9_]+\}", "NULL", sanitized_query)

        # Se for ScyllaDB / Cassandra
        is_scylla = (
            connection_details
            and (
                str(connection_details.get("type", "")).lower() in ("scylla", "scylladb", "cassandra")
                or int(connection_details.get("port") or 0) == 9042
            )
        )
        if is_scylla:
            try:
                from src.core.infrastructure.connectors.scylla_connector import ScyllaConnector
                from src.core.domain.metadata.connection import Connection, FORBIDDEN_PLAINTEXT_KEYS
                from src.core.domain.shared.types import SecretReference
                from src.core.infrastructure.security.secret_resolver import SecretResolver

                resolver = SecretResolver()
                raw_pwd = connection_details.get("password") or connection_details.get("pwd") or ""
                if raw_pwd:
                    resolver.custom_env["SCYLLA_TEMP_SECRET"] = str(raw_pwd)
                    s_ref = SecretReference("secret://env/SCYLLA_TEMP_SECRET")
                else:
                    s_ref = SecretReference("secret://empty")

                endpoint = connection_details.get("host") or "localhost"
                safe_options = {
                    k: v for k, v in connection_details.items()
                    if k.lower() not in FORBIDDEN_PLAINTEXT_KEYS and k.lower() not in ("secretkey", "accesskey", "secret_key")
                }
                conn_obj = Connection(
                    id="conn_scylla_infer",
                    project_id="proj_default",
                    name="Scylla Infer",
                    connector_type="scylla",
                    endpoint=str(endpoint),
                    secret_ref=s_ref,
                    options=safe_options
                )
                scylla = ScyllaConnector(resolver)
                fields = scylla.infer_schema(conn_obj, sanitized_query)
                if fields:
                    return InferredSchema(dataset_name=dataset_name, fields=fields)
            except Exception as scylla_err:
                logger.warning(f"Inferência ScyllaDB falhou: {scylla_err}")
                raise scylla_err

        # Se for Oracle
        is_oracle = (
            connection_details
            and (
                str(connection_details.get("type", "")).lower() == "oracle"
                or bool(connection_details.get("serviceName"))
                or bool(connection_details.get("sid"))
                or int(connection_details.get("port") or 0) in (1521, 15030)
            )
        )
        if is_oracle:
            try:
                from src.core.infrastructure.connectors.oracle_connector import OracleConnector
                ora_conn = OracleConnector()
                conn = ora_conn.connect(connection_details)
                cur = conn.cursor()
                cur.execute(f"SELECT * FROM ({sanitized_query}) WHERE 1=0")
                fields: List[InferredField] = []
                if cur.description:
                    for desc in cur.description:
                        col_name = desc[0]
                        type_code = str(desc[1]).upper()
                        logical = LogicalDataType.STRING
                        if "NUMBER" in type_code or "INT" in type_code:
                            logical = LogicalDataType.INT64 if (desc[5] == 0) else LogicalDataType.FLOAT64
                        elif "DATE" in type_code:
                            logical = LogicalDataType.DATE
                        elif "TIMESTAMP" in type_code:
                            logical = LogicalDataType.TIMESTAMP
                        fields.append(InferredField(
                            name=col_name,
                            logical_type=logical,
                            physical_type=type_code,
                            nullable=True
                        ))
                cur.close()
                conn.close()
                if fields:
                    return InferredSchema(dataset_name=dataset_name, fields=fields)
            except Exception:
                pass

        # Se houver dados de conexão PostgreSQL
        is_postgres = (
            connection_details
            and (
                str(connection_details.get("type", "")).lower() in ("postgres", "postgresql")
                or connection_details.get("host")
                or connection_details.get("database")
            )
        )
        if is_postgres:
            from src.core.infrastructure.security.redaction import sanitize_message
            from src.core.infrastructure.security.secret_resolver import SecretResolver
            from src.core.domain.shared.types import SecretReference

            resolver = SecretResolver()
            raw_pwd = connection_details.get("password") or connection_details.get("pwd") or ""
            if isinstance(raw_pwd, str) and (raw_pwd.startswith("secret://") or raw_pwd.startswith("env://")):
                password = resolver.resolve(SecretReference(raw_pwd))
            elif raw_pwd:
                password = str(raw_pwd)
            else:
                password = ""

            try:
                import psycopg2
                host = connection_details.get("host") or "localhost"
                port = int(connection_details.get("port") or 5432)
                database = connection_details.get("database") or "postgres"
                username = connection_details.get("username") or "postgres"
                sslmode = connection_details.get("sslMode") or connection_details.get("sslmode") or "prefer"

                conn = psycopg2.connect(
                    dbname=database, user=username, password=password,
                    host=host, port=port, sslmode=sslmode, connect_timeout=5
                )
                cur = conn.cursor()
                fields: List[InferredField] = []

                # Camada A2: CREATE TEMP VIEW com ROLLBACK para tipos exatos e format_type
                from src.core.application.metadata.catalog_provider import parse_format_type
                from src.core.infrastructure.connectors.postgres_catalog_provider import PostgresCatalogProvider
                catalog_prov = PostgresCatalogProvider()

                a2_success = False
                try:
                    cur.execute("BEGIN READ WRITE;")
                    cur.execute("SET LOCAL statement_timeout = '10s';")
                    cur.execute(f"CREATE TEMP VIEW _rdf_infer AS {sanitized_query};")
                    cur.execute("""
                        SELECT a.attname,
                               format_type(a.atttypid, a.atttypmod) AS data_type
                        FROM pg_attribute a
                        WHERE a.attrelid = '_rdf_infer'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                        ORDER BY a.attnum;
                    """)
                    rows = cur.fetchall()
                    cur.execute("ROLLBACK;")
                    if isinstance(rows, list) and rows and isinstance(rows[0], (tuple, list)):
                        for row in rows:
                            col_name, data_type = row[0], str(row[1])
                            length, precision, scale = parse_format_type(data_type)
                            logical = catalog_prov.resolve_type(data_type)
                            fields.append(InferredField(
                                name=col_name,
                                logical_type=logical,
                                physical_type=data_type,
                                nullable=True,
                                length=length,
                                precision=precision,
                                scale=scale,
                            ))
                        a2_success = True
                except Exception as a2_err:
                    try:
                        cur.execute("ROLLBACK;")
                    except Exception:
                        pass
                    logger.debug(f"Camada A2 (temp view) falhou, tentando fallback A1 (LIMIT 0): {a2_err}")

                # Fallback para Camada A1 (LIMIT 0) se A2 não obteve sucesso
                if not a2_success:
                    cur.execute("BEGIN READ ONLY;")
                    cur.execute("SET LOCAL statement_timeout = '10s';")
                    cur.execute(f"SELECT * FROM ({sanitized_query}) AS _subq_infer LIMIT 0;")
                    if cur.description:
                        for desc in cur.description:
                            col_name = desc[0]
                            type_code = desc[1]
                            logical, physical = map_postgres_type_to_logical(type_code)
                            fields.append(InferredField(
                                name=col_name,
                                logical_type=logical,
                                physical_type=physical,
                                nullable=True
                            ))
                    try:
                        cur.execute("ROLLBACK;")
                    except Exception:
                        pass

                cur.close()
                conn.close()
                if fields:
                    # Camada B: Enriquece campos com análise de linhagem semântica e catálogo
                    from src.core.application.metadata.sql_lineage import SqlLineageAnalyzer

                    warnings: List[str] = []
                    inference_source = "database"
                    try:
                        analyzer = SqlLineageAnalyzer(catalog_provider=catalog_prov, dialect="postgres")
                        lineage_res = analyzer.analyze_lineage(sanitized_query, validate_tables_exist=False)
                        if lineage_res.warnings:
                            warnings.extend(lineage_res.warnings)

                        enriched_fields: List[InferredField] = []
                        for f in fields:
                            lin = lineage_res.columns.get(f.name)
                            if lin:
                                enriched_fields.append(InferredField(
                                    name=f.name,
                                    logical_type=f.logical_type,
                                    physical_type=f.physical_type,
                                    nullable=lin.nullable,
                                    description=lin.comment or f.description,
                                    length=f.length if f.length is not None else lin.length,
                                    precision=f.precision if f.precision is not None else lin.precision,
                                    scale=f.scale if f.scale is not None else lin.scale,
                                    is_primary_key=lin.is_primary_key,
                                    origin=lin.origin,
                                    computed=lin.computed,
                                ))
                            else:
                                enriched_fields.append(f)
                        fields = enriched_fields
                        if not warnings:
                            inference_source = "database+lineage"
                    except Exception as b_err:
                        logger.debug(f"Falha ao executar Camada B (linhagem): {b_err}")
                        warnings.append("lineage_unavailable")

                    return InferredSchema(
                        dataset_name=dataset_name,
                        fields=fields,
                        inference_source=inference_source,
                        warnings=warnings,
                    )
            except Exception as e:
                clean_err = sanitize_message(str(e))
                logger.error(f"Erro na execução da consulta PostgreSQL: {clean_err}")
                raise DomainValidationError(f"Erro na consulta SQL no PostgreSQL: {clean_err}")

        # Fallback para motor analítico DuckDB
        try:
            conn = duckdb.connect(":memory:")
            # Tenta DESCRIBE
            df_desc = conn.execute(f"DESCRIBE ({sanitized_query})").pl()
            fields = []
            for row in df_desc.iter_rows(named=True):
                col_name = row.get("column_name") or row.get("Field") or "col"
                col_type = str(row.get("column_type") or row.get("Type") or "VARCHAR").upper()
                logical = LogicalDataType.STRING
                if "INT" in col_type:
                    logical = LogicalDataType.INT64 if ("BIG" in col_type or "8" in col_type) else LogicalDataType.INT32
                elif "FLOAT" in col_type or "DOUBLE" in col_type or "REAL" in col_type:
                    logical = LogicalDataType.FLOAT64
                elif "DECIMAL" in col_type or "NUMERIC" in col_type:
                    logical = LogicalDataType.DECIMAL
                elif "BOOL" in col_type:
                    logical = LogicalDataType.BOOLEAN
                elif "DATE" in col_type:
                    logical = LogicalDataType.DATE
                elif "TIME" in col_type:
                    logical = LogicalDataType.TIMESTAMP

                fields.append(InferredField(
                    name=col_name,
                    logical_type=logical,
                    physical_type=col_type,
                    nullable=True
                ))
            return InferredSchema(dataset_name=dataset_name, fields=fields, inference_source="database", warnings=[])
        except Exception as duck_err:
            logger.debug(f"Inferência DuckDB em memória falhou: {duck_err}")

        # Tentativa Camada C (offline / estática com sqlglot)
        try:
            from src.core.application.metadata.sql_lineage import SqlLineageAnalyzer
            analyzer = SqlLineageAnalyzer(dialect="postgres")
            static_schema = analyzer.infer_offline(sanitized_query, dataset_name=dataset_name)
            if static_schema.fields:
                return static_schema
        except DomainValidationError:
            raise
        except Exception as static_err:
            logger.debug(f"Inferência estática Camada C falhou: {static_err}")

        raise DomainValidationError("Não foi possível inferir o schema para a query SQL informada.")

    def infer_from_path_or_query(
        self,
        path_or_query: str,
        connector_type: str = "file",
        connection_details: Optional[Dict[str, Any]] = None,
        sample_size: int = 1000
    ) -> InferredSchema:
        """Roteia inteligentemente entre arquivo local e consulta SQL."""
        raw = path_or_query.strip()
        is_sql = (
            raw.upper().startswith("SELECT")
            or " FROM " in raw.upper()
            or "connector.db" in connector_type
            or connector_type in ("postgres", "postgresql", "oracle", "mysql", "duckdb")
        )

        if is_sql:
            return self.infer_from_sql_query(raw, connection_details=connection_details)
        else:
            return self.infer_from_file(raw, sample_size=sample_size)

    def infer_from_columns(self, dataset_name: str, column_types: Dict[str, str]) -> InferredSchema:
        """Cria um schema a partir de mapeamento explícito de colunas."""
        fields: List[InferredField] = []
        for col_name, raw_type in column_types.items():
            logical = LogicalDataType(raw_type) if raw_type in LogicalDataType._value2member_map_ else LogicalDataType.STRING
            fields.append(InferredField(
                name=col_name,
                logical_type=logical,
                physical_type=raw_type,
                nullable=True
            ))
        return InferredSchema(dataset_name=dataset_name, fields=fields)

