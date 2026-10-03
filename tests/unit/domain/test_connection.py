"""Testes unitários do agregado Connection e regras de segurança de segredos."""

import pytest
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.domain.shared.types import SecretReference


def test_create_valid_connection():
    secret_ref = SecretReference("secret://env/POSTGRES_PWD")
    conn = Connection(
        id="conn-01",
        project_id="proj-01",
        name="Postgres Data Warehouse",
        connector_type="postgres",
        endpoint="dw.internal.corp:5432/analytics",
        secret_ref=secret_ref,
        options={"ssl_mode": "require", "timeout_seconds": 30}
    )
    assert conn.id == "conn-01"
    assert conn.secret_ref.uri == "secret://env/POSTGRES_PWD"
    assert conn.is_active is True


def test_reject_forbidden_plaintext_keys_in_options():
    secret_ref = SecretReference("secret://env/POSTGRES_PWD")

    for forbidden_key in ["password", "Password", "SECRET", "api_key", "token"]:
        with pytest.raises(SecurityViolationError):
            Connection(
                id="conn-01",
                project_id="proj-01",
                name="Postgres Conn",
                connector_type="postgres",
                endpoint="dw.internal.corp:5432/analytics",
                secret_ref=secret_ref,
                options={forbidden_key: "plaintext_secret_value"}
            )


def test_reject_embedded_credentials_in_endpoint():
    secret_ref = SecretReference("secret://env/POSTGRES_PWD")

    with pytest.raises(SecurityViolationError):
        Connection(
            id="conn-01",
            project_id="proj-01",
            name="Postgres Conn",
            connector_type="postgres",
            endpoint="postgresql://admin:mypassword123@dw.internal.corp:5432/analytics",
            secret_ref=secret_ref
        )


def test_update_options_validates_security():
    secret_ref = SecretReference("secret://env/POSTGRES_PWD")
    conn = Connection(
        id="conn-01",
        project_id="proj-01",
        name="Postgres Conn",
        connector_type="postgres",
        endpoint="dw.internal.corp:5432/analytics",
        secret_ref=secret_ref
    )

    with pytest.raises(SecurityViolationError):
        conn.update_options({"pwd": "another_password"})
