"""Módulo de Interpolação de Variáveis de Contexto (TASK-1).

Suporta sintaxes {{context.X}} e ${X} em configurações de componentes,
com formatação segura para consultas SQL (escapando aspas, números sem aspas,
nulos como NULL), texto simples nos demais campos, validação estrita de
variáveis ausentes e mascaramento de segredos.
"""

import copy
import re
from typing import Any, Dict, List, Optional, Set

from src.core.domain.shared.exceptions import DomainValidationError

# Padrões de variáveis: {{context.NOME}} e ${NOME}
CONTEXT_VAR_REGEX = re.compile(
    r"\{\{\s*context\.([a-zA-Z0-9_]+)\s*\}\}|\$\{\s*([a-zA-Z0-9_]+)\s*\}"
)

# Campos conhecidos por armazenarem consultas SQL
SQL_FIELD_NAMES = frozenset({
    "query",
    "duckdb_query",
    "custom_query",
    "sql",
    "filter_expression",
})


def _format_sql_value(val: Any) -> str:
    """Formata um valor de variável de contexto para interpolação SQL segura."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    # String ou outro objeto: escapa apóstrofes para evitar quebra de literais SQL
    return str(val).replace("'", "''")


def _format_text_value(val: Any) -> str:
    """Formata um valor de variável para campos de texto simples."""
    if val is None:
        return ""
    return str(val)


def interpolate_string(
    text: str,
    context_variables: Dict[str, Any],
    is_sql: bool = False
) -> str:
    """Interpola todas as ocorrências de {{context.X}} e ${X} em uma string.
    
    Lança DomainValidationError se alguma variável não existir no mapa.
    """
    if not text or not isinstance(text, str):
        return text

    def _replacer(match: re.Match) -> str:
        var_name = match.group(1) or match.group(2)
        if var_name not in context_variables:
            available = sorted(list(context_variables.keys()))
            raise DomainValidationError(
                f"Variável de contexto '{var_name}' não encontrada. "
                f"Variáveis disponíveis: {available if available else 'nenhuma'}"
            )
        raw_val = context_variables[var_name]
        if is_sql:
            return _format_sql_value(raw_val)
        return _format_text_value(raw_val)

    return CONTEXT_VAR_REGEX.sub(_replacer, text)


def interpolate_context_variables(
    config: Any,
    context_variables: Optional[Dict[str, Any]] = None,
    is_sql: bool = False
) -> Any:
    """Percorre recursivamente a configuração de um nó e interpola variáveis.
    
    Opera estritamente sobre uma cópia profunda (deep copy) da configuração original.
    """
    if context_variables is None:
        context_variables = {}

    copied = copy.deepcopy(config)

    def _traverse(item: Any, sql_context: bool) -> Any:
        if isinstance(item, dict):
            return {
                k: _traverse(v, sql_context or (k.lower() in SQL_FIELD_NAMES))
                for k, v in item.items()
            }
        elif isinstance(item, list):
            return [_traverse(elem, sql_context) for elem in item]
        elif isinstance(item, str):
            return interpolate_string(item, context_variables, is_sql=sql_context)
        return item

    return _traverse(copied, is_sql)


def mask_secrets(text: str, secret_values: List[str]) -> str:
    """Substitui ocorrências de segredos por '***' para evitar vazamento em logs."""
    if not text or not secret_values:
        return text

    # Ordena por tamanho decrescente para substituir segredos mais longos primeiro
    valid_secrets = [s for s in secret_values if s and isinstance(s, str) and len(s) > 0]
    sorted_secrets = sorted(set(valid_secrets), key=len, reverse=True)

    result = str(text)
    for secret in sorted_secrets:
        result = result.replace(secret, "***")

    return result
