import threading
import time
from unittest.mock import MagicMock, patch
import pytest

from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.types import SecretReference
from src.core.infrastructure.security.secret_resolver import SecretResolver
from src.core.infrastructure.connectors.pool_manager import ConnectionPoolManager


@pytest.fixture(autouse=True)
def reset_pool_manager():
    """Garante isolamento resetando o singleton do pool manager antes e depois de cada teste."""
    ConnectionPoolManager.reset_instance()
    yield
    ConnectionPoolManager.reset_instance()


def create_sample_postgres_connection(conn_id="pg-1", endpoint="localhost:5432/testdb", secret_key="PG_PASS"):
    return Connection(
        id=conn_id,
        project_id="proj-1",
        name=f"Connection {conn_id}",
        connector_type="postgres",
        endpoint=endpoint,
        secret_ref=SecretReference(uri=f"secret://env/{secret_key}"),
        options={"user": "postgres", "ssl_mode": "disable"}
    )


def create_sample_scylla_connection(conn_id="scylla-1", endpoint="localhost:9042", secret_key="SCYLLA_PASS"):
    return Connection(
        id=conn_id,
        project_id="proj-1",
        name=f"Connection {conn_id}",
        connector_type="scylla",
        endpoint=endpoint,
        secret_ref=SecretReference(uri=f"secret://env/{secret_key}"),
        options={"user": "cassandra", "keyspace": "my_keyspace"}
    )


def test_pool_manager_is_singleton():
    """T-2.1: ConnectionPoolManager deve ser um singleton."""
    resolver = SecretResolver()
    m1 = ConnectionPoolManager.get_instance(secret_resolver=resolver)
    m2 = ConnectionPoolManager.get_instance(secret_resolver=resolver)
    assert m1 is m2


def test_postgres_pool_reuses_connection_via_context_manager():
    """T-2.1: Deve reaproveitar conexão devolvida ao pool através do context manager."""
    resolver = SecretResolver(custom_env={"PG_PASS": "s3cr3t"})
    manager = ConnectionPoolManager.get_instance(secret_resolver=resolver)
    conn_def = create_sample_postgres_connection()

    # Mock do objeto de conexão físico retornado pelo driver
    mock_conn = MagicMock()
    mock_conn.closed = False

    with patch.object(manager, "_create_raw_postgres_connection", return_value=mock_conn) as mock_create:
        # Primeira aquisição
        with manager.get_postgres_connection(conn_def) as c1:
            assert c1 is mock_conn

        # Segunda aquisição com mesma definição de conexão: deve reutilizar sem criar nova conexão física
        with manager.get_postgres_connection(conn_def) as c2:
            assert c2 is mock_conn

        # _create_raw_postgres_connection deve ter sido chamada apenas 1 vez devido ao pooling
        assert mock_create.call_count == 1


def test_postgres_pool_concurrency_and_exhaustion_timeout():
    """T-2.1: Concorrência com pool limitado e lançamento de timeout sob esgotamento."""
    resolver = SecretResolver(custom_env={"PG_PASS": "s3cr3t"})
    manager = ConnectionPoolManager.get_instance(secret_resolver=resolver)
    conn_def = create_sample_postgres_connection()

    # Pool de tamanho máximo 2
    manager.set_pool_limits(min_size=1, max_size=2)

    def make_conn():
        m = MagicMock()
        m.closed = False
        return m

    with patch.object(manager, "_create_raw_postgres_connection", side_effect=[make_conn(), make_conn()]):
        # Ocupa as 2 conexões disponíveis
        ctx1 = manager.get_postgres_connection(conn_def, timeout=0.1)
        c1 = ctx1.__enter__()
        ctx2 = manager.get_postgres_connection(conn_def, timeout=0.1)
        c2 = ctx2.__enter__()

        # Tentativa de adquirir 3ª conexão deve falhar com TimeoutError
        with pytest.raises(TimeoutError) as exc_info:
            with manager.get_postgres_connection(conn_def, timeout=0.1):
                pass
        assert "timeout" in str(exc_info.value).lower()

        # Libera c1
        ctx1.__exit__(None, None, None)

        # Agora a 3ª tentativa deve ter sucesso reutilizando c1
        with manager.get_postgres_connection(conn_def, timeout=0.5) as c3:
            assert c3 is c1

        ctx2.__exit__(None, None, None)


def test_scylla_session_caching_and_reuse():
    """T-2.1: Deve manter cache de Cluster/Session ativas para ScyllaDB/Cassandra."""
    resolver = SecretResolver(custom_env={"SCYLLA_PASS": "cassandra_secret"})
    manager = ConnectionPoolManager.get_instance(secret_resolver=resolver)
    conn_def = create_sample_scylla_connection()

    mock_session = MagicMock()
    mock_cluster = MagicMock()
    mock_cluster.connect.return_value = mock_session

    with patch.object(manager, "_create_raw_scylla_cluster", return_value=mock_cluster) as mock_create:
        s1 = manager.get_scylla_session(conn_def)
        s2 = manager.get_scylla_session(conn_def)

        assert s1 is mock_session
        assert s2 is mock_session
        # Apenas 1 cluster deve ser criado e conectado
        assert mock_create.call_count == 1
        assert mock_cluster.connect.call_count == 1


def test_pool_manager_close_all_cleans_resources():
    """T-2.1: close_all() deve encerrar pools do Postgres e sessões do Scylla."""
    resolver = SecretResolver(custom_env={"PG_PASS": "pass", "SCYLLA_PASS": "pass"})
    manager = ConnectionPoolManager.get_instance(secret_resolver=resolver)

    pg_def = create_sample_postgres_connection()
    scylla_def = create_sample_scylla_connection()

    mock_pg_conn = MagicMock()
    mock_pg_conn.closed = False

    mock_scylla_cluster = MagicMock()
    mock_scylla_session = MagicMock()
    mock_scylla_cluster.connect.return_value = mock_scylla_session

    with patch.object(manager, "_create_raw_postgres_connection", return_value=mock_pg_conn), \
         patch.object(manager, "_create_raw_scylla_cluster", return_value=mock_scylla_cluster):
        with manager.get_postgres_connection(pg_def):
            pass
        manager.get_scylla_session(scylla_def)

        manager.close_all()
        assert mock_pg_conn.close.called
        assert mock_scylla_cluster.shutdown.called


def test_postgres_connector_uses_pool_manager(monkeypatch):
    """T-2.3: PostgresConnector deve utilizar ConnectionPoolManager para gerenciar conexões."""
    from src.core.infrastructure.connectors.postgres_connector import PostgresConnector
    import polars as pl

    resolver = SecretResolver(custom_env={"PG_PASS": "pwd"})
    mock_pool_manager = MagicMock()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_pool_manager.get_postgres_connection.return_value.__enter__.return_value = mock_conn

    connector = PostgresConnector(secret_resolver=resolver, pool_manager=mock_pool_manager)
    conn_def = create_sample_postgres_connection()

    # 1. test_connection
    success, msg, latency = connector.test_connection(conn_def)
    assert success is True
    assert mock_pool_manager.get_postgres_connection.called

    # 2. execute_write
    df = pl.DataFrame({"id": [1, 2], "val": ["a", "b"]})
    written = connector.execute_write(conn_def, "my_table", df)
    assert written == 2
    assert mock_pool_manager.get_postgres_connection.call_count >= 2


def test_scylla_connector_uses_pool_manager(monkeypatch):
    """T-2.3: ScyllaConnector deve utilizar ConnectionPoolManager para reutilização de sessões."""
    from src.core.infrastructure.connectors.scylla_connector import ScyllaConnector

    resolver = SecretResolver(custom_env={"SCYLLA_PASS": "pwd"})
    mock_pool_manager = MagicMock()
    mock_session = MagicMock()
    mock_pool_manager.get_scylla_session.return_value = mock_session

    connector = ScyllaConnector(secret_resolver=resolver, pool_manager=mock_pool_manager)
    conn_def = create_sample_scylla_connection()

    # 1. test_connection
    # Mock do socket para não falhar no check de porta
    with patch("socket.create_connection"):
        success, msg, latency = connector.test_connection(conn_def)
        assert success is True
        assert mock_pool_manager.get_scylla_session.called

    # 2. infer_schema
    fields = connector.infer_schema(conn_def, "users")
    assert mock_pool_manager.get_scylla_session.call_count >= 2

