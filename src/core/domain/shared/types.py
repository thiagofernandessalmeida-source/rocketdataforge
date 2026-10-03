"""Tipos canônicos e Value Objects compartilhados do RocketDataForge.

Este módulo é estritamente puro (apenas biblioteca padrão Python).
"""

from dataclasses import dataclass
from enum import Enum
import re
from typing import Optional

from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError


class LogicalDataType(str, Enum):
    """Tipos de dados lógicos canônicos do sistema."""
    BOOLEAN = "boolean"
    INT16 = "int16"
    INT32 = "int32"
    INT64 = "int64"
    FLOAT32 = "float32"
    FLOAT64 = "float64"
    DECIMAL = "decimal"
    STRING = "string"
    BINARY = "binary"
    DATE = "date"
    TIME = "time"
    TIMESTAMP = "timestamp"
    TIMESTAMP_TZ = "timestamp_tz"
    JSON = "json"
    ARRAY = "array"
    STRUCT = "struct"
    UNKNOWN = "unknown"


class PortDirection(str, Enum):
    """Direção da porta do componente."""
    INPUT = "input"
    OUTPUT = "output"


class PortType(str, Enum):
    """Tipo semântico da porta."""
    DATASET = "dataset"
    CONTROL = "control"
    REJECT = "reject"


class FailureAction(str, Enum):
    """Ação a ser executada mediante falha ou rejeição."""
    ACCEPT = "accept"
    REJECT = "reject"
    WARN = "warn"
    FAIL = "fail"


@dataclass(frozen=True)
class SemanticVersion:
    """Representação imutável de versão semântica (major.minor.patch)."""
    major: int
    minor: int
    patch: int

    def __post_init__(self) -> None:
        if self.major < 0 or self.minor < 0 or self.patch < 0:
            raise DomainValidationError("Componentes da versão semântica devem ser inteiros não-negativos")

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

    @classmethod
    def parse(cls, version_str: str) -> "SemanticVersion":
        pattern = r"^(\d+)\.(\d+)\.(\d+)$"
        match = re.match(pattern, version_str.strip())
        if not match:
            raise DomainValidationError(f"Formato de versão semântica inválido: '{version_str}'. Esperado: X.Y.Z")
        return cls(
            major=int(match.group(1)),
            minor=int(match.group(2)),
            patch=int(match.group(3))
        )


@dataclass(frozen=True)
class SecretReference:
    """Referência lógica a um segredo. Nunca armazena o valor em claro."""
    uri: str

    def __post_init__(self) -> None:
        if not self.uri or not isinstance(self.uri, str):
            raise SecurityViolationError("SecretReference não pode ser vazia")
        if not self.uri.startswith("secret://"):
            raise SecurityViolationError(
                f"SecretReference inválida: '{self.uri}'. Deve obrigatoriamente iniciar com 'secret://'"
            )
        # Rejeita caracteres que indiquem tentativa de embutir senhas diretamente
        if re.search(r"\s", self.uri):
            raise SecurityViolationError("SecretReference não pode conter espaços em branco")


@dataclass(frozen=True)
class PortId:
    """Identificador canônico de uma porta de nó."""
    node_id: str
    port_name: str

    def __post_init__(self) -> None:
        if not self.node_id or not self.node_id.strip():
            raise DomainValidationError("PortId requer um node_id válido")
        if not self.port_name or not self.port_name.strip():
            raise DomainValidationError("PortId requer um port_name válido")

    def __str__(self) -> str:
        return f"{self.node_id}.{self.port_name}"

    @classmethod
    def parse(cls, qualified_port: str) -> "PortId":
        parts = qualified_port.split(".", 1)
        if len(parts) != 2:
            raise DomainValidationError(
                f"Formato de porta inválido: '{qualified_port}'. Esperado: 'node_id.port_name'"
            )
        return cls(node_id=parts[0].strip(), port_name=parts[1].strip())
