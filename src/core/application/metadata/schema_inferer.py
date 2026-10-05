"""Serviço de Inferência de Schema (SchemaInferer).

Inspeciona fontes de dados e arquivos tabulares por amostragem,
convertendo os tipos físicos nativos para os tipos canônicos de LogicalDataType.
"""

from dataclasses import dataclass, field
import os
from typing import Any, Dict, List, Optional

import polars as pl
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import LogicalDataType


@dataclass(frozen=True)
class InferredField:
    """Campo individual inferido de um dataset."""
    name: str
    logical_type: LogicalDataType
    physical_type: str
    nullable: bool = True
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "logical_type": self.logical_type.value,
            "physical_type": self.physical_type,
            "nullable": self.nullable,
            "description": self.description
        }


@dataclass
class InferredSchema:
    """Esquema estrutural inferido de uma fonte ou arquivo."""
    dataset_name: str
    fields: List[InferredField] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_name": self.dataset_name,
            "fields": [f.to_dict() for f in self.fields]
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

        # Substitui tokens {node_id.col} por literais dummy para permitir inspeção sem erro de sintaxe
        sanitized_query = re.sub(r"\{[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_]+\}", "1", query)
        sanitized_query = re.sub(r"\{[a-zA-Z0-9_]+\}", "1", sanitized_query)

        # Se houver dados de conexão PostgreSQL
        if connection_details and (connection_details.get("host") or connection_details.get("database")):
            try:
                import psycopg2
                host = connection_details.get("host") or "localhost"
                port = int(connection_details.get("port") or 5432)
                database = connection_details.get("database") or "postgres"
                username = connection_details.get("username") or "postgres"
                password = connection_details.get("password") or ""
                sslmode = connection_details.get("sslMode") or "prefer"

                conn = psycopg2.connect(
                    dbname=database, user=username, password=password,
                    host=host, port=port, sslmode=sslmode, connect_timeout=5
                )
                cur = conn.cursor()
                # Executa com LIMIT 0 para inspecionar cursor.description
                cur.execute(f"SELECT * FROM ({sanitized_query}) AS _subq_infer LIMIT 0;")
                fields: List[InferredField] = []
                if cur.description:
                    for desc in cur.description:
                        col_name = desc[0]
                        # Type code mapping simples
                        type_code = desc[1]
                        logical = LogicalDataType.STRING
                        if type_code in (20, 21, 23):  # int8, int2, int4
                            logical = LogicalDataType.INT32 if type_code != 20 else LogicalDataType.INT64
                        elif type_code in (700, 701, 1700):  # float4, float8, numeric
                            logical = LogicalDataType.FLOAT64 if type_code != 1700 else LogicalDataType.DECIMAL
                        elif type_code in (16,):  # bool
                            logical = LogicalDataType.BOOLEAN
                        elif type_code in (1082,):  # date
                            logical = LogicalDataType.DATE
                        elif type_code in (1114, 1184):  # timestamp, timestamptz
                            logical = LogicalDataType.TIMESTAMP
                        fields.append(InferredField(
                            name=col_name,
                            logical_type=logical,
                            physical_type=str(type_code),
                            nullable=True
                        ))
                cur.close()
                conn.close()
                if fields:
                    return InferredSchema(dataset_name=dataset_name, fields=fields)
            except Exception:
                pass  # Fallback para DuckDB

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
            return InferredSchema(dataset_name=dataset_name, fields=fields)
        except Exception:
            # Fallback sintático simples se a query não puder ser executada em banco vazio
            clean = re.sub(r"--.*$", "", sanitized_query, flags=re.MULTILINE)
            m = re.search(r"SELECT\s+(.*?)\s+FROM", clean, re.IGNORECASE | re.DOTALL)
            if m:
                select_clause = m.group(1).strip()
                if select_clause != "*":
                    cols = [c.strip().split()[-1].strip('"').strip("'").split(".")[-1] for c in select_clause.split(",") if c.strip()]
                    fields = [
                        InferredField(name=c, logical_type=LogicalDataType.STRING, physical_type="VARCHAR", nullable=True)
                        for c in cols
                    ]
                    return InferredSchema(dataset_name=dataset_name, fields=fields)

        raise DomainValidationError(f"Não foi possível inferir o schema para a query SQL informada.")

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

