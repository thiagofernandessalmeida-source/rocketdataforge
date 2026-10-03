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
    """Operador de leitura de fonte de dados."""
    operator_type: str = "scan"
    connection_ref: str = ""
    source_path_or_query: str = ""
    format: str = "custom"  # "postgres", "csv", "parquet", "json"
    projected_columns: Optional[List[str]] = None
    pushed_filter: Optional[str] = None
    connection_details: Optional[Dict[str, Any]] = None
    raw_config: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "connection_ref": self.connection_ref,
            "source": self.source_path_or_query,
            "format": self.format,
            "projected_columns": self.projected_columns,
            "pushed_filter": self.pushed_filter,
            "connection_details": self.connection_details,
            "raw_config": self.raw_config
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
class LogicalSink(LogicalOperator):
    """Operador de gravação em destino final."""
    operator_type: str = "sink"
    target_ref: str = ""
    format: str = "custom"
    write_mode: str = "append"  # "append", "replace"
    connection_details: Optional[Dict[str, Any]] = None
    raw_config: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        res = super().to_dict()
        res.update({
            "target": self.target_ref,
            "format": self.format,
            "write_mode": self.write_mode,
            "connection_details": self.connection_details,
            "raw_config": self.raw_config
        })
        return res
