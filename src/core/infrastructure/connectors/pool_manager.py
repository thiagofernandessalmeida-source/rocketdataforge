"""Gerenciador Unificado de Pools de Conexão (ConnectionPoolManager).

Provê pooling thread-safe e reutilização de conexões físicas para PostgreSQL
e sessões ativas com ScyllaDB/Apache Cassandra, com controle estrito de timeout,
context managers de ciclo de vida e resolução segura de credenciais via SecretResolver.
"""

from contextlib import contextmanager
import logging
import queue
import threading
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import quote_plus

from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.infrastructure.security.secret_resolver import SecretResolver

logger = logging.getLogger(__name__)


class PostgresConnectionPool:
    """Pool thread-safe de conexões PostgreSQL com fila delimitada e timeout estrito."""

    def __init__(
        self,
        factory_fn: Any,
        min_size: int = 1,
        max_size: int = 10,
        default_timeout: float = 10.0
    ):
        self.factory_fn = factory_fn
        self.min_size = min_size
        self.max_size = max_size
        self.default_timeout = default_timeout
        self._pool_queue: queue.Queue[Any] = queue.Queue(maxsize=max_size)
        self._total_created = 0
        self._lock = threading.RLock()
        self._is_closed = False

    def acquire(self, timeout: Optional[float] = None) -> Any:
        """Adquire uma conexão do pool ou cria uma nova se abaixo de max_size."""
        wait_time = self.default_timeout if timeout is None else timeout
        start = time.time()

        with self._lock:
            if self._is_closed:
                raise RuntimeError("Tentativa de adquirir conexão de um pool fechado.")

            # 1. Tenta reaproveitar conexão já livre na fila
            while not self._pool_queue.empty():
                try:
                    conn = self._pool_queue.get_nowait()
                    if not getattr(conn, "closed", False):
                        return conn
                    # Conexão estava fechada: descarta e decrementa
                    self._total_created = max(0, self._total_created - 1)
                except queue.Empty:
                    break

            # 2. Se não há conexão livre e podemos criar nova sem exceder max_size
            if self._total_created < self.max_size:
                conn = self.factory_fn()
                self._total_created += 1
                return conn

        # 3. Pool esgotado: bloqueia na fila até timeout
        elapsed = time.time() - start
        remaining_timeout = max(0.001, wait_time - elapsed)

        try:
            conn = self._pool_queue.get(block=True, timeout=remaining_timeout)
            if getattr(conn, "closed", False):
                with self._lock:
                    self._total_created = max(0, self._total_created - 1)
                return self.acquire(timeout=max(0.001, wait_time - (time.time() - start)))
            return conn
        except queue.Empty:
            raise TimeoutError(
                f"Timeout de {wait_time}s excedido aguardando conexão PostgreSQL disponível no pool "
                f"(capacidade máxima={self.max_size}, ocupadas={self._total_created})."
            )

    def release(self, conn: Any) -> None:
        """Devolve uma conexão ao pool."""
        with self._lock:
            if self._is_closed or getattr(conn, "closed", False):
                try:
                    conn.close()
                except Exception:
                    pass
                self._total_created = max(0, self._total_created - 1)
                return

            try:
                self._pool_queue.put_nowait(conn)
            except queue.Full:
                try:
                    conn.close()
                except Exception:
                    pass
                self._total_created = max(0, self._total_created - 1)

    def close_all(self) -> None:
        """Encerra todas as conexões do pool."""
        with self._lock:
            self._is_closed = True
            while not self._pool_queue.empty():
                try:
                    conn = self._pool_queue.get_nowait()
                    conn.close()
                except Exception:
                    pass
            self._total_created = 0


class ConnectionPoolManager:
    """Gerenciador singleton de pools de conexão para bancos relacionais e NoSQL."""

    _instance: Optional["ConnectionPoolManager"] = None
    _instance_lock = threading.RLock()

    def __init__(self, secret_resolver: Optional[SecretResolver] = None):
        self.secret_resolver = secret_resolver or SecretResolver()
        self._min_size = 1
        self._max_size = 10
        self._default_timeout = 10.0
        self._postgres_pools: Dict[str, PostgresConnectionPool] = {}
        self._scylla_sessions: Dict[str, Tuple[Any, Any]] = {}
        self._lock = threading.RLock()

    @classmethod
    def get_instance(cls, secret_resolver: Optional[SecretResolver] = None) -> "ConnectionPoolManager":
        """Recupera ou instancia a referência única do ConnectionPoolManager."""
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls(secret_resolver=secret_resolver)
            elif secret_resolver is not None:
                cls._instance.secret_resolver = secret_resolver
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Encerra recursos e reseta o singleton para testes unitários isolados."""
        with cls._instance_lock:
            if cls._instance is not None:
                cls._instance.close_all()
                cls._instance = None

    def set_pool_limits(self, min_size: int = 1, max_size: int = 10, default_timeout: float = 10.0) -> None:
        """Configura os limites padrão de capacidade e timeout dos pools."""
        with self._lock:
            self._min_size = min_size
            self._max_size = max_size
            self._default_timeout = default_timeout

    def _build_postgres_dsn(self, connection: Connection) -> str:
        """Constrói DSN libpq resolvendo credenciais exclusivamente pelo SecretResolver."""
        raw_password = self.secret_resolver.resolve(connection.secret_ref)
        safe_password = quote_plus(raw_password)

        endpoint = connection.endpoint.strip()
        port = 5432
        if "/" in endpoint:
            host_port, dbname = endpoint.split("/", 1)
        else:
            host_port, dbname = endpoint, "postgres"

        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str)
        else:
            host = host_port

        user = connection.options.get("user", "postgres")
        sslmode = connection.options.get("ssl_mode", "prefer")

        return (
            f"dbname='{dbname}' "
            f"user='{user}' "
            f"host='{host}' "
            f"port='{port}' "
            f"password='{safe_password}' "
            f"sslmode='{sslmode}'"
        )

    def _create_raw_postgres_connection(self, connection: Connection) -> Any:
        """Cria conexão física direta com o PostgreSQL (usando psycopg2)."""
        import psycopg2
        dsn = self._build_postgres_dsn(connection)
        return psycopg2.connect(dsn, connect_timeout=int(self._default_timeout))

    def _get_or_create_postgres_pool(self, connection: Connection) -> PostgresConnectionPool:
        """Obtém ou instancia o pool dedicado para a conexão especificada."""
        pool_key = f"{connection.id}:{connection.endpoint}:{connection.options.get('user', '')}"
        with self._lock:
            if pool_key not in self._postgres_pools:
                def factory():
                    return self._create_raw_postgres_connection(connection)

                self._postgres_pools[pool_key] = PostgresConnectionPool(
                    factory_fn=factory,
                    min_size=self._min_size,
                    max_size=self._max_size,
                    default_timeout=self._default_timeout
                )
            return self._postgres_pools[pool_key]

    @contextmanager
    def get_postgres_connection(self, connection: Connection, timeout: Optional[float] = None) -> Iterator[Any]:
        """Context manager para aquisição e liberação segura de conexão do pool PostgreSQL."""
        pool = self._get_or_create_postgres_pool(connection)
        conn = pool.acquire(timeout=timeout)
        try:
            yield conn
        finally:
            pool.release(conn)

    def _create_raw_scylla_cluster(
        self,
        hosts: List[str],
        port: int,
        auth_provider: Any = None,
        connect_timeout: int = 10
    ) -> Any:
        """Instancia objeto Cluster para ScyllaDB/Cassandra com suporte a asyncio."""
        from cassandra.cluster import Cluster
        import sys

        cluster_kwargs: Dict[str, Any] = {
            "contact_points": hosts,
            "port": port,
            "auth_provider": auth_provider,
            "connect_timeout": connect_timeout,
        }

        if sys.platform == "win32" or sys.version_info >= (3, 12):
            try:
                from cassandra.io.asyncioreactor import AsyncioConnection
                cluster_kwargs["connection_class"] = AsyncioConnection
            except Exception:
                pass

        return Cluster(**cluster_kwargs)

    @staticmethod
    def _parse_scylla_endpoint(connection: Connection) -> Tuple[List[str], int, str]:
        """Extrai hosts, porta e keyspace do endpoint de forma resiliente."""
        endpoint = connection.endpoint.strip()
        keyspace = connection.options.get("keyspace", "")
        port = int(connection.options.get("port", 9042))

        if "/" in endpoint:
            hosts_part, keyspace_part = endpoint.split("/", 1)
            if not keyspace:
                keyspace = keyspace_part
        else:
            hosts_part = endpoint

        if ":" in hosts_part:
            host_str, port_str = hosts_part.rsplit(":", 1)
            try:
                port = int(port_str)
            except ValueError:
                host_str = hosts_part
        else:
            host_str = hosts_part

        hosts = [h.strip() for h in host_str.split(",") if h.strip()]
        if not hosts:
            hosts = ["localhost"]

        return hosts, port, keyspace

    def get_scylla_session(self, connection: Connection, connect_timeout: int = 10) -> Any:
        """Retorna uma sessão ativa e reutilizável para ScyllaDB/Cassandra gerenciada em cache."""
        hosts, port, keyspace = self._parse_scylla_endpoint(connection)
        session_key = f"{connection.id}:{','.join(hosts)}:{port}:{keyspace}"

        with self._lock:
            if session_key in self._scylla_sessions:
                cluster, session = self._scylla_sessions[session_key]
                is_shutdown = getattr(session, "is_shutdown", False)
                if is_shutdown is not True:
                    return session

            # Resolução de credenciais
            raw_password = self.secret_resolver.resolve(connection.secret_ref)
            user = connection.options.get("user") or connection.options.get("username", "")
            auth_provider = None
            if user and raw_password:
                from cassandra.auth import PlainTextAuthProvider
                auth_provider = PlainTextAuthProvider(username=user, password=raw_password)

            cluster = self._create_raw_scylla_cluster(
                hosts=hosts,
                port=port,
                auth_provider=auth_provider,
                connect_timeout=connect_timeout
            )
            session = cluster.connect(keyspace) if keyspace else cluster.connect()
            self._scylla_sessions[session_key] = (cluster, session)
            return session

    def close_all(self) -> None:
        """Fecha todos os pools de conexão e sessões NoSQL ativas."""
        with self._lock:
            for pool in self._postgres_pools.values():
                try:
                    pool.close_all()
                except Exception:
                    pass
            self._postgres_pools.clear()

            for cluster, session in self._scylla_sessions.values():
                try:
                    if hasattr(session, "shutdown"):
                        session.shutdown()
                    if hasattr(cluster, "shutdown"):
                        cluster.shutdown()
                except Exception:
                    pass
            self._scylla_sessions.clear()
