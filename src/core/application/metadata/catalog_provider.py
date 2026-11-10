"""Contratos e DTOs para Provedores de Catálogo (Porta de Metadados).

Define a porta CatalogProvider, o DTO CatalogColumn e funções de parsing de tipos de catálogo.
Adere ao princípio de Domínio Puro (Constituição 2.4).
"""

from dataclasses import dataclass
import re
from typing import Optional, Protocol, Tuple

from src.core.domain.shared.types import LogicalDataType


@dataclass(frozen=True)
class CatalogColumn:
    """Informações estruturais e semânticas de uma coluna no catálogo do banco."""
    name: str
    data_type: str  # ex.: "numeric(12,2)", "character varying(50)"
    nullable: bool
    is_primary_key: bool
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    comment: Optional[str] = None


class CatalogProvider(Protocol):
    """Porta para introspecção de catálogo de banco de dados."""

    def get_table_columns(
        self,
        catalog: Optional[str],
        schema: Optional[str],
        table: str,
    ) -> list[CatalogColumn]:
        """Recupera colunas de uma tabela/view específica no catálogo."""
        ...

    def resolve_type(self, catalog_type: str) -> LogicalDataType:
        """Resolve o tipo do catálogo para LogicalDataType canônico."""
        ...


_VARCHAR_RE = re.compile(
    r"^(?:character\s+varying|varchar|character|char|bpchar)\s*\(\s*(\d+)\s*\)",
    re.IGNORECASE,
)
_NUMERIC_RE = re.compile(
    r"^(?:numeric|decimal)\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\)",
    re.IGNORECASE,
)


def parse_format_type(data_type: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """Extrai (length, precision, scale) de uma string format_type do catálogo.

    Exemplos:
      "character varying(50)" -> (50, None, None)
      "numeric(12,2)"         -> (None, 12, 2)
      "numeric(10)"           -> (None, 10, None)
      "integer"               -> (None, None, None)
    """
    if not data_type:
        return None, None, None

    dt = data_type.strip()

    m_varchar = _VARCHAR_RE.match(dt)
    if m_varchar:
        return int(m_varchar.group(1)), None, None

    m_num = _NUMERIC_RE.match(dt)
    if m_num:
        prec = int(m_num.group(1))
        scale = int(m_num.group(2)) if m_num.group(2) is not None else None
        return None, prec, scale

    return None, None, None
