"""Testes unitários do conector Oracle Database."""

from unittest.mock import MagicMock, patch
import pytest
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.connectors.oracle_connector import OracleConnector
from src.core.infrastructure.security.secret_resolver import SecretResolver


def test_oracle_params_extraction():
    secret_resolver = SecretResolver(custom_env={"ORACLE_PASS": "secret123"})
    connector = OracleConnector(secret_resolver=secret_resolver)

    conn = Connection(
        id="conn-ora",
        project_id="p1",
        name="Oracle DB",
        connector_type="oracle",
        endpoint="vipo02svchml.natura.com.br:15030/cadwf_qa",
        secret_ref=SecretReference("secret://env/ORACLE_PASS"),
        options={"user": "usr_qa", "service_name": "cadwf_qa"}
    )

    params = connector.get_connection_params(conn)
    assert params["host"] == "vipo02svchml.natura.com.br"
    assert params["port"] == 15030
    assert params["user"] == "usr_qa"
    assert params["password"] == "secret123"
    assert params["service_name"] == "cadwf_qa"


def test_oracle_connect_thin_mode():
    secret_resolver = SecretResolver(custom_env={"ORACLE_PASS": "secret123"})
    connector = OracleConnector(secret_resolver=secret_resolver)

    mock_conn = MagicMock()
    with patch("oracledb.connect", return_value=mock_conn) as mock_connect:
        conn = Connection(
            id="conn-ora",
            project_id="p1",
            name="Oracle DB",
            connector_type="oracle",
            endpoint="vipo02svchml.natura.com.br:15030/cadwf_qa",
            secret_ref=SecretReference("secret://env/ORACLE_PASS"),
            options={"user": "usr_qa", "service_name": "cadwf_qa"}
        )
        res = connector.connect(conn)
        assert res == mock_conn
        assert mock_connect.called


def test_oracle_test_connection_success():
    secret_resolver = SecretResolver(custom_env={"ORACLE_PASS": "secret123"})
    connector = OracleConnector(secret_resolver=secret_resolver)

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = (1,)
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    with patch.object(connector, "connect", return_value=mock_conn):
        conn = Connection(
            id="conn-ora",
            project_id="p1",
            name="Oracle DB",
            connector_type="oracle",
            endpoint="vipo02svchml.natura.com.br:15030/cadwf_qa",
            secret_ref=SecretReference("secret://env/ORACLE_PASS"),
            options={"user": "usr_qa"}
        )
        ok, msg, latency = connector.test_connection(conn)
        assert ok is True
        assert "sucesso" in msg.lower()
        assert latency is not None


def test_oracle_detects_legacy_error_and_gives_clear_message():
    secret_resolver = SecretResolver(custom_env={"ORACLE_PASS": "secret123"})
    connector = OracleConnector(secret_resolver=secret_resolver)

    # Simula erro típico de Thin mode com banco Oracle 11g/10g antigo
    with patch("oracledb.connect", side_effect=Exception("DPY-3010: server verifier not supported")):
        conn = Connection(
            id="conn-ora",
            project_id="p1",
            name="Oracle DB",
            connector_type="oracle",
            endpoint="vipo02svchml.natura.com.br:15030/cadwf_qa",
            secret_ref=SecretReference("secret://env/ORACLE_PASS"),
            options={"user": "usr_qa"}
        )
        with pytest.raises(Exception) as exc_info:
            connector.connect(conn)
        assert "Instant Client" in str(exc_info.value)


def test_oracle_timeout_disabled_by_default_and_custom():
    secret_resolver = SecretResolver(custom_env={"ORACLE_PASS": "secret123"})
    connector = OracleConnector(secret_resolver=secret_resolver)

    # 1. Padrão: timeout é 0 (sem timeout)
    conn_default = Connection(
        id="conn-1", project_id="p1", name="Oracle DB", connector_type="oracle",
        endpoint="localhost:1521/pdb", secret_ref=SecretReference("secret://env/ORACLE_PASS")
    )
    p1 = connector.get_connection_params(conn_default)
    assert p1["timeout"] == 0

    # 2. Timeout explícito "0" ou "none"
    conn_zero = Connection(
        id="conn-2", project_id="p1", name="Oracle DB", connector_type="oracle",
        endpoint="localhost:1521/pdb", secret_ref=SecretReference("secret://env/ORACLE_PASS"),
        options={"timeout": "0"}
    )
    p2 = connector.get_connection_params(conn_zero)
    assert p2["timeout"] == 0

    # 3. Timeout customizado
    conn_custom = Connection(
        id="conn-3", project_id="p1", name="Oracle DB", connector_type="oracle",
        endpoint="localhost:1521/pdb", secret_ref=SecretReference("secret://env/ORACLE_PASS"),
        options={"timeout": 120}
    )
    p3 = connector.get_connection_params(conn_custom)
    assert p3["timeout"] == 120.0


def test_oracle_finds_instant_client_in_subdirectories(tmp_path):
    sub = tmp_path / "instantclient_23_26"
    sub.mkdir(parents=True)
    oci_file = sub / "oci.dll"
    oci_file.write_text("fake oci")

    found = OracleConnector.find_oracle_client_dirs(lib_dir=str(tmp_path))
    assert any(str(sub) in d for d in found)

