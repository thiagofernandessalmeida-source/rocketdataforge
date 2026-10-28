"""Operadores Algébricos do Plano Lógico (Logical Operators).

Representam a semântica canônica das transformações independente de tecnologia de execução.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class LogicalOperator:
    """Classe base para operadores da álgebra relacional do plano lógico."""
    id: str
    operator_type: str = "operator"
    input_ids: List[str] = field(default_factory=list)

    @property
    def config(self) -> Dict[str, Any]:
        """Acesso unificado a raw_config se presente."""
        return getattr(self, "raw_config", None) or {}

    def to_dict(self) -> Dict[str, Any]:
        """Converte o operador em representação canônica serializável."""
        res = {
            "id": self.id,
            "type": self.operator_type,
            "inputs": self.input_ids
        }
        raw_cfg = getattr(self, "raw_config", None)
        if raw_cfg:
            res["raw_config"] = raw_cfg
            if "masking_rules" in raw_cfg:
                res["masking_rules"] = raw_cfg["masking_rules"]
        return res


@dataclass
class LogicalScan(LogicalOperator):
    """Operador de leitura de fonte de dados com suporte a iteração parametrizada e DuckDB."""
    operator_type: str = "scan"
    connection_ref: str = ""
    source_path_or_query: str = ""
    format: str = "custom"  # "postgres", "csv", "parquet", "json", "duckdb"
    projected_columns: Optional[List[str]] = None
    pushed_filter: Optional[str] = None
    connection_details: Optional[Dict[str, Any]] = None
    raw_config: Optional[Dict[str, Any]] = None
    is_iterative: bool = False
    parameter_tokens: List[Dict[str, str]] = field(default_factory=list)
    schema_definitions: Optional[List[Dict[str, Any]]] = None
    enable_duckdb_view: bool = False
    duckdb_query: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "connection_ref": self.connection_ref,
            "source": self.source_path_or_query,
            "format": self.format,
            "schema_definitions": self.schema_definitions,
            "projected_columns": self.projected_columns,
            "pushed_filter": self.pushed_filter,
            "connection_details": self.connection_details,
            "raw_config": self.raw_config,
            "is_iterative": self.is_iterative,
            "parameter_tokens": self.parameter_tokens,
            "enable_duckdb_view": self.enable_duckdb_view,
            "duckdb_query": self.duckdb_query
        })
        if self.raw_config and "masking_rules" in self.raw_config:
            res["masking_rules"] = self.raw_config["masking_rules"]
        return res



from src.core.domain.shared.exceptions import DomainValidationError


def _format_sql_value(val: Any) -> str:
    """Formata valor primitivo para literal SQL compatível com DuckDB."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)):
        return str(val)
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"


@dataclass
class FilterCondition:
    """Condição individual de filtro declarativo (RF-03)."""
    column: str
    operator: str  # ==, !=, >, <, >=, <=, LIKE, NOT LIKE, IN, NOT IN, IS NULL, IS NOT NULL
    value: Any = None

    def to_sql(self) -> str:
        col = f'"{self.column}"'
        op_norm = str(self.operator).strip().upper()

        if op_norm in ("IS NULL", "IS_NULL"):
            return f"{col} IS NULL"
        if op_norm in ("IS NOT NULL", "IS_NOT_NULL"):
            return f"{col} IS NOT NULL"

        if op_norm in ("IN", "NOT IN"):
            vals = self.value
            if isinstance(vals, (list, tuple, set)):
                items = ", ".join(_format_sql_value(v) for v in vals)
            else:
                items = str(vals).strip("()[]")
            return f"{col} {op_norm} ({items})"

        val_sql = _format_sql_value(self.value)
        if op_norm in ("==", "="):
            return f"{col} = {val_sql}"
        if op_norm in ("!=", "<>"):
            return f"{col} != {val_sql}"
        if op_norm in (">", "<", ">=", "<="):
            return f"{col} {op_norm} {val_sql}"
        if op_norm in ("LIKE", "NOT LIKE"):
            return f"{col} {op_norm} {val_sql}"

        return f"{col} {self.operator} {val_sql}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "column": self.column,
            "operator": self.operator,
            "value": self.value
        }


@dataclass
class FilterOperator(LogicalOperator):
    """Operador de filtragem declarativa tFilterRow (RF-03)."""
    operator_type: str = "filter"
    conditions: List[FilterCondition] = field(default_factory=list)
    logical_operator: str = "AND"  # "AND" ou "OR"
    predicate: str = ""  # compatibilidade com expressões livres legadas

    def to_sql(self, table_name: str, port: str = "output") -> str:
        """Gera consulta SQL para porta output (aceitos) ou reject (rejeitados)."""
        cond_sqls = [c.to_sql() if hasattr(c, "to_sql") else str(c) for c in self.conditions]
        if not cond_sqls:
            if self.predicate:
                cond_expr = self.predicate
            else:
                if port == "reject":
                    return f"SELECT * FROM {table_name} WHERE 1 = 0"
                return f"SELECT * FROM {table_name}"
        else:
            log_op = f" {self.logical_operator.strip().upper()} "
            cond_expr = log_op.join(cond_sqls)

        if port == "reject":
            return f"SELECT * FROM {table_name} WHERE NOT ({cond_expr})"
        return f"SELECT * FROM {table_name} WHERE ({cond_expr})"

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "conditions": [c.to_dict() if hasattr(c, "to_dict") else c for c in self.conditions],
            "logical_operator": self.logical_operator,
            "predicate": self.predicate
        })
        return res


# Alias para retrocompatibilidade
LogicalFilter = FilterOperator


@dataclass
class AggregateField:
    """Campo de agregação declarativa tAggregateRow (RF-04)."""
    column: str
    function: str  # COUNT, COUNT_DISTINCT, SUM, AVG, MIN, MAX, FIRST, LAST, STRING_AGG
    alias: Optional[str] = None
    delimiter: str = ", "

    def get_alias(self) -> str:
        if self.alias:
            return self.alias
        fn_name = self.function.lower()
        col_clean = self.column.replace("*", "all")
        return f"{fn_name}_{col_clean}"

    def to_sql(self) -> str:
        fn_upper = self.function.strip().upper()
        alias_name = self.get_alias()
        col_expr = "*" if self.column.strip() == "*" else f'"{self.column}"'

        if fn_upper == "COUNT_DISTINCT":
            return f'COUNT(DISTINCT "{self.column}") AS "{alias_name}"'
        if fn_upper == "STRING_AGG":
            delim_escaped = self.delimiter.replace("'", "''")
            return f"STRING_AGG(\"{self.column}\", '{delim_escaped}') AS \"{alias_name}\""
        if fn_upper in ("COUNT", "SUM", "AVG", "MIN", "MAX", "FIRST", "LAST"):
            return f'{fn_upper}({col_expr}) AS "{alias_name}"'

        return f'{fn_upper}({col_expr}) AS "{alias_name}"'

    def to_dict(self) -> Dict[str, Any]:
        return {
            "column": self.column,
            "function": self.function,
            "alias": self.get_alias(),
            "delimiter": self.delimiter
        }


@dataclass
class AggregateOperator(LogicalOperator):
    """Operador de agregação declarativa tAggregateRow (RF-04)."""
    operator_type: str = "aggregate"
    group_by: List[str] = field(default_factory=list)
    aggregations: List[AggregateField] = field(default_factory=list)

    def __post_init__(self):
        # Validação de aliases duplicados e conflitos com group_by (RF-04.3)
        seen_aliases = set()
        group_set = set(self.group_by)

        for agg in self.aggregations:
            al = agg.get_alias() if hasattr(agg, "get_alias") else agg.alias
            if al in group_set:
                raise DomainValidationError(
                    f"Conflito de nomenclatura no AggregateOperator: alias '{al}' colide com coluna de agrupamento (GROUP BY)."
                )
            if al in seen_aliases:
                raise DomainValidationError(
                    f"Conflito de nomenclatura no AggregateOperator: alias duplicado '{al}' detectado em múltiplas agregações."
                )
            seen_aliases.add(al)

    def to_sql(self, table_name: str) -> str:
        select_parts = [f'"{col}"' for col in self.group_by]
        for agg in self.aggregations:
            select_parts.append(agg.to_sql())

        select_clause = ", ".join(select_parts) if select_parts else "*"
        sql = f"SELECT {select_clause} FROM {table_name}"

        if self.group_by:
            group_clause = ", ".join(f'"{col}"' for col in self.group_by)
            sql = f"{sql} GROUP BY {group_clause}"

        return sql

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "group_by": self.group_by,
            "aggregations": [a.to_dict() if hasattr(a, "to_dict") else a for a in self.aggregations]
        })
        return res


LogicalAggregate = AggregateOperator


@dataclass
class LogicalProject(LogicalOperator):
    """Operador de projeção e renomeação de colunas."""
    operator_type: str = "project"
    columns: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({"columns": self.columns})
        return res


@dataclass
class LogicalJoin(LogicalOperator):
    """Operador de junção relacional entre dois fluxos de dados."""
    operator_type: str = "join"
    join_type: str = "inner"  # "inner", "left", "right", "full"
    left_keys: List[str] = field(default_factory=list)
    right_keys: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "join_type": self.join_type,
            "left_keys": self.left_keys,
            "right_keys": self.right_keys
        })
        return res


@dataclass
class LogicalTMap(LogicalOperator):
    """Operador de transformação visual tMap (lookups múltiplos, variáveis e roteamento de saídas)."""
    operator_type: str = "tmap"
    main_input_id: str = ""
    main_alias: str = "main"
    lookups: List[Dict[str, Any]] = field(default_factory=list)
    variables: List[Dict[str, Any]] = field(default_factory=list)
    outputs: List[Dict[str, Any]] = field(default_factory=list)
    raw_config: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "main_input_id": self.main_input_id,
            "main_alias": self.main_alias,
            "lookups": self.lookups,
            "variables": self.variables,
            "outputs": self.outputs,
            "raw_config": self.raw_config
        })
        if self.raw_config and "masking_rules" in self.raw_config:
            res["masking_rules"] = self.raw_config["masking_rules"]
        return res


@dataclass
class LogicalSink(LogicalOperator):
    """Operador de gravação em destino final com suporte a Ação de Tabela e Dados."""
    operator_type: str = "sink"
    target_ref: str = ""
    format: str = "custom"
    write_mode: str = "append"  # legado / compatibilidade
    table_action: str = "none"  # "none", "drop_create", "create_if_not_exists", "drop_if_exists_create", "truncate", "delete_all"
    data_action: str = "insert"  # "insert", "update", "upsert", "update_or_insert", "delete"
    keys: List[str] = field(default_factory=list)
    connection_details: Optional[Dict[str, Any]] = None
    raw_config: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        tbl_ref = self.target_ref or (self.raw_config or {}).get("table") or (self.raw_config or {}).get("target") or ""
        res.update({
            "target": tbl_ref,
            "format": self.format,
            "write_mode": self.write_mode,
            "table_action": self.table_action,
            "data_action": self.data_action,
            "keys": self.keys,
            "connection_details": self.connection_details,
            "raw_config": self.raw_config,
            "database_path": (self.raw_config or {}).get("database_path") or (self.raw_config or {}).get("database")
        })
        if self.raw_config and "masking_rules" in self.raw_config:
            res["masking_rules"] = self.raw_config["masking_rules"]
        return res



@dataclass
class LogicalBarrier(LogicalOperator):
    """Operador de sincronização / semáforo (Sync Barrier - Wait All)."""
    operator_type: str = "barrier"
    mode: str = "wait_all"
    timeout_seconds: int = 0
    failure_policy: str = "fail_fast"

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "mode": self.mode,
            "timeout_seconds": self.timeout_seconds,
            "failure_policy": self.failure_policy
        })
        return res

