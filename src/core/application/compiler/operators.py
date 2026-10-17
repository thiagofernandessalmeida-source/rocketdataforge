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

    def to_dict(self) -> Dict[str, Any]:
        """Converte o operador em representação canônica serializável."""
        return {
            "id": self.id,
            "type": self.operator_type,
            "inputs": self.input_ids
        }


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
        return res


@dataclass
class LogicalFilter(LogicalOperator):
    """Operador de filtragem por predicado booleano."""
    operator_type: str = "filter"
    predicate: str = ""

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({"predicate": self.predicate})
        return res


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

