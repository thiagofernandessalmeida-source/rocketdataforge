"""Filtro e Sanitizador de Segurança (Redaction).

Mascara automaticamente senhas, tokens e credenciais confidenciais em strings e dicionários.
"""

import re
from typing import Any, Dict

SENSITIVE_KEY_PATTERNS = {"password", "pwd", "secret", "token", "api_key", "auth_token", "private_key"}

URL_CREDENTIAL_REGEX = re.compile(r"(?i)([a-z0-9+.-]+://[^:]+:)([^@]+)(@)", re.IGNORECASE)
KEY_VALUE_SECRET_REGEX = re.compile(r"(?i)\b(password|secret|token|api_key|pwd)\b\s*([:=])\s*['\"]?([^'\"\s&]+)['\"]?", re.IGNORECASE)


def sanitize_message(raw_text: str) -> str:
    """Substitui credenciais sensíveis em texto por ***REDACTED***."""
    if not raw_text or not isinstance(raw_text, str):
        return raw_text

    # Mascara senhas embutidas em URLs (ex: postgresql://user:pass@host)
    sanitized = URL_CREDENTIAL_REGEX.sub(r"\1***REDACTED***\3", raw_text)

    # Mascara pares chave-valor (ex: password=123 ou "secret": "abc")
    sanitized = KEY_VALUE_SECRET_REGEX.sub(r"\1\2***REDACTED***", sanitized)

    return sanitized


def redact_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Cria uma cópia do dicionário mascarando qualquer chave ou valor confidencial."""
    result: Dict[str, Any] = {}

    for k, v in data.items():
        if k.lower() in SENSITIVE_KEY_PATTERNS:
            result[k] = "***REDACTED***"
        elif isinstance(v, dict):
            result[k] = redact_dict(v)
        elif isinstance(v, str):
            result[k] = sanitize_message(v)
        elif isinstance(v, list):
            result[k] = [
                redact_dict(item) if isinstance(item, dict)
                else (sanitize_message(item) if isinstance(item, str) else item)
                for item in v
            ]
        else:
            result[k] = v

    return result
