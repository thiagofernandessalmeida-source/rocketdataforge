"""Testes unitários dos filtros de Redaction e SecretResolver."""

import pytest
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.security.redaction import redact_dict, sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


def test_sanitize_message_url_password():
    raw = "Conectando em postgresql://admin:super_secret_pwd@10.0.0.1:5432/db"
    sanitized = sanitize_message(raw)
    assert "super_secret_pwd" not in sanitized
    assert "postgresql://admin:***REDACTED***@10.0.0.1:5432/db" in sanitized


def test_sanitize_message_key_value_secrets():
    raw = "Erro de autenticacao com password = 'mypassword' e token=xyz987"
    sanitized = sanitize_message(raw)
    assert "mypassword" not in sanitized
    assert "xyz987" not in sanitized
    assert "password=***REDACTED***" in sanitized or "password =***REDACTED***" in sanitized


def test_redact_dict_recursive():
    payload = {
        "user": "developer",
        "password": "my_clear_password",
        "nested": {
            "token": "secret_bearer_token",
            "url": "postgresql://usr:pwd123@db:5432/analytics"
        },
        "public_info": "ok"
    }

    masked = redact_dict(payload)
    assert masked["user"] == "developer"
    assert masked["password"] == "***REDACTED***"
    assert masked["nested"]["token"] == "***REDACTED***"
    assert "pwd123" not in masked["nested"]["url"]
    assert masked["public_info"] == "ok"


def test_secret_resolver_success():
    custom_env = {"POSTGRES_PROD_PWD": "super_safe_secret_value"}
    resolver = SecretResolver(custom_env=custom_env)

    ref = SecretReference("secret://env/POSTGRES_PROD_PWD")
    val = resolver.resolve(ref)
    assert val == "super_safe_secret_value"


def test_secret_resolver_missing_env():
    resolver = SecretResolver(custom_env={})
    ref = SecretReference("secret://env/NON_EXISTENT_VAR")

    with pytest.raises(SecurityViolationError):
        resolver.resolve(ref)


def test_secret_resolver_unsupported_scheme():
    resolver = SecretResolver()
    ref = SecretReference("secret://vault/kv/my-secret")

    with pytest.raises(SecurityViolationError):
        resolver.resolve(ref)
