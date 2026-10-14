"""Conector Oracle Database (Source & Target).

Gerencia conexões nativas com Oracle Database via python-oracledb, suportando
tanto o modo leve (Thin mode - sem Instant Client) quanto o modo completo
(Thick mode - com Oracle Instant Client para bancos legados 11g/10g ou criptografia de rede).
"""

import os
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import polars as pl
from src.core.domain.metadata.connection import Connection
from src.core.domain.shared.exceptions import DomainError, DomainValidationError
from src.core.infrastructure.security.redaction import sanitize_message
from src.core.infrastructure.security.secret_resolver import SecretResolver


class OracleConnector:
    """Conector para Oracle Database com suporte a Thin e Thick Mode."""

    _thick_mode_initialized = False

    def __init__(self, secret_resolver: Optional[SecretResolver] = None):
        self.secret_resolver = secret_resolver or SecretResolver()

    @classmethod
    def find_oracle_client_dirs(cls, lib_dir: Optional[str] = None) -> List[str]:
        """Localiza diretórios contendo o Oracle Instant Client (oci.dll ou libclntsh.so)."""
        candidates: List[str] = []
        if lib_dir and os.path.isdir(lib_dir):
            candidates.append(lib_dir)

        env_vars = ["ORACLE_HOME", "INSTANT_CLIENT_DIR", "OCI_LIB_DIR", "ORACLE_CLIENT_LIB"]
        for env_var in env_vars:
            val = os.environ.get(env_var)
            if val and os.path.isdir(val):
                candidates.append(val)

        base_search_paths = [
            r"C:\oracle",
            r"C:\instantclient",
            r"C:\app",
            r"C:\Program Files\Oracle",
            "/opt/oracle",
            "/usr/lib/oracle",
        ]

        found_dirs: List[str] = []

        def check_dir(d: str) -> bool:
            if not os.path.isdir(d):
                return False
            # No Windows procura oci.dll
            if os.name == "nt":
                return os.path.isfile(os.path.join(d, "oci.dll"))
            # No Linux/Unix procura libclntsh.so
            try:
                return any(fname.startswith("libclntsh.so") for fname in os.listdir(d))
            except Exception:
                return False

        # Busca recursiva (até 4 níveis) nos candidatos e pastas padrão
        all_bases = list(candidates)
        for b in base_search_paths:
            if b not in all_bases:
                all_bases.append(b)

        for base in all_bases:
            if not os.path.isdir(base):
                continue
            if check_dir(base) and base not in found_dirs:
                found_dirs.append(base)
            try:
                for root, dirs, files in os.walk(base):
                    depth = root.count(os.sep) - base.count(os.sep)
                    if depth > 4:
                        dirs.clear()
                        continue
                    if check_dir(root) and root not in found_dirs:
                        found_dirs.append(root)
            except Exception:
                continue

        # Prioriza Instant Client 19c (LTS com suporte retroativo para 11g/10g) sobre versões 21c e 23ai
        found_dirs.sort(key=lambda d: (0 if "19" in os.path.basename(d).lower() else 1, d))
        return found_dirs

    @classmethod
    def try_init_oracle_client(cls, lib_dir: Optional[str] = None) -> bool:
        """Tenta inicializar o Thick Mode com o Oracle Instant Client."""
        if cls._thick_mode_initialized:
            return True

        import oracledb

        if not oracledb.is_thin_mode():
            cls._thick_mode_initialized = True
            return True

        candidates = cls.find_oracle_client_dirs(lib_dir)
        for path in candidates:
            try:
                oracledb.init_oracle_client(lib_dir=path)
                cls._thick_mode_initialized = True
                return True
            except Exception:
                continue

        # Tenta sem argumentos (usando bibliotecas já presentes no PATH)
        try:
            oracledb.init_oracle_client()
            cls._thick_mode_initialized = True
            return True
        except Exception:
            return False

    def get_connection_params(self, conn_or_cfg: Any) -> Dict[str, Any]:
        """Extrai parâmetros de conexão padronizados a partir de Connection ou dicionário."""
        raw_timeout = None
        if isinstance(conn_or_cfg, Connection):
            endpoint = conn_or_cfg.endpoint.strip()
            port = 1521
            if "/" in endpoint:
                host_port, dbname = endpoint.split("/", 1)
            else:
                host_port, dbname = endpoint, ""

            if ":" in host_port:
                host, port_str = host_port.split(":", 1)
                port = int(port_str)
            else:
                host = host_port

            user = conn_or_cfg.options.get("user") or conn_or_cfg.options.get("username") or ""
            password = self.secret_resolver.resolve(conn_or_cfg.secret_ref)
            service_name = conn_or_cfg.options.get("service_name") or conn_or_cfg.options.get("serviceName") or dbname
            sid = conn_or_cfg.options.get("sid")
            instant_client_dir = conn_or_cfg.options.get("instant_client_dir") or conn_or_cfg.options.get("instantClientDir")
            raw_timeout = (
                conn_or_cfg.options.get("timeout")
                or conn_or_cfg.options.get("connect_timeout")
                or conn_or_cfg.options.get("tcp_connect_timeout")
            )
        elif isinstance(conn_or_cfg, dict):
            details = conn_or_cfg.get("connection_details") or conn_or_cfg
            host = details.get("host") or "localhost"
            port = int(details.get("port") or 1521)
            user = str(details.get("username") or details.get("user") or "").strip()
            password = str(details.get("password") or "")
            service_name = details.get("serviceName") or details.get("service_name") or details.get("database") or ""
            sid = details.get("sid")
            instant_client_dir = details.get("instantClientDir") or details.get("instant_client_dir")
            raw_timeout = (
                details.get("timeout")
                or details.get("connect_timeout")
                or details.get("tcp_connect_timeout")
                or conn_or_cfg.get("timeout")
                or conn_or_cfg.get("connect_timeout")
            )
        else:
            raise DomainValidationError("Objeto de conexão inválido para Oracle.")

        # Parsing de timeout: 0 significa desativar timeout (conforme solicitado pelo usuário)
        timeout = 0
        if raw_timeout is not None:
            raw_str = str(raw_timeout).strip().lower()
            if raw_str in ("0", "none", "disable", "disabled", "desativado", "false", ""):
                timeout = 0
            else:
                try:
                    parsed = float(raw_str)
                    timeout = parsed if parsed > 0 else 0
                except ValueError:
                    timeout = 0

        return {
            "host": host,
            "port": port,
            "user": user,
            "password": password,
            "service_name": service_name,
            "sid": sid,
            "instant_client_dir": instant_client_dir,
            "timeout": timeout,
        }

    def connect(self, conn_or_cfg: Any) -> Any:
        """Abre conexão com o Oracle Database com suporte a Thick Mode e timeout configurável."""
        import oracledb

        # Desabilita fetch de LOB como objeto: converte CLOB para string e BLOB para bytes automaticamente
        oracledb.defaults.fetch_lobs = False

        params = self.get_connection_params(conn_or_cfg)
        host = params["host"]
        port = params["port"]
        user = params["user"]
        password = params["password"]
        service_name = params["service_name"]
        sid = params["sid"]
        instant_client_dir = params["instant_client_dir"]
        timeout = params.get("timeout", 0)

        # Sempre tenta inicializar Thick mode antes de conectar se bibliotecas estiverem disponíveis
        self.try_init_oracle_client(instant_client_dir)

        # Prepara argumentos de conexão e timeout
        connect_kwargs: Dict[str, Any] = {
            "user": user,
            "password": password,
        }

        # Tratamento de timeout:
        # Se timeout for 0 (solicitado pelo usuário):
        # - Em Thick mode: não passamos tcp_connect_timeout restritivo (ou tcp_connect_timeout=0 para desligar)
        # - Em Thin mode: passamos 600.0s para evitar o bug de socket não-bloqueante no Windows (WinError 10035) e garantir tempo de sobra
        if not oracledb.is_thin_mode():
            if timeout > 0:
                connect_kwargs["tcp_connect_timeout"] = timeout
        else:
            connect_kwargs["tcp_connect_timeout"] = timeout if timeout > 0 else 600.0

        # Monta estratégia de conexão (service_name prioritário se presente, com fallback para sid)
        dsn_attempts: List[Tuple[str, str]] = []
        if service_name:
            dsn_attempts.append(("service_name", oracledb.makedsn(host, port, service_name=service_name)))
            if not sid:
                dsn_attempts.append(("sid", oracledb.makedsn(host, port, sid=service_name)))
        elif sid:
            dsn_attempts.append(("sid", oracledb.makedsn(host, port, sid=sid)))
        else:
            dsn_attempts.append(("endpoint", f"{host}:{port}"))

        last_error = None
        for attempt_type, dsn in dsn_attempts:
            try:
                return oracledb.connect(dsn=dsn, **connect_kwargs)
            except Exception as e:
                last_error = e
                raw_err = str(e)

                # Se falhou e ainda está em Thin mode, tenta inicializar Thick mode e retentar
                if not self._thick_mode_initialized:
                    initialized = self.try_init_oracle_client(instant_client_dir)
                    if initialized:
                        try:
                            thick_kwargs = {"user": user, "password": password}
                            if timeout > 0:
                                thick_kwargs["tcp_connect_timeout"] = timeout
                            return oracledb.connect(dsn=dsn, **thick_kwargs)
                        except Exception as thick_err:
                            last_error = thick_err
                            raw_err = str(thick_err)

                # Se o erro for de serviço não reconhecido (ORA-12514 / ORA-12505), prossegue para a próxima tentativa
                if any(code in raw_err for code in ["ORA-12514", "ORA-12505"]):
                    continue

                # Se o erro for de autenticação (ORA-01017) ou já atingiu o banco, para por aqui
                if "ORA-01017" in raw_err:
                    break

        # Se todas as tentativas falharam
        raw_msg = str(last_error) if last_error else "Falha desconhecida"

        # Detecta necessidade do Thick Mode se o banco legado exigir
        needs_thick = any(code in raw_msg for code in [
            "DPY-3010", "DPY-3015", "DPY-3001", "ORA-28040",
            "password verifier", "network session", "encryption"
        ])

        if needs_thick:
            raise DomainError(
                f"O banco Oracle ({host}:{port}) é uma versão legada (ex: 11g) ou requer criptografia avançada ({sanitize_message(raw_msg)}). "
                f"Para conectar neste banco antigo, é necessário o Oracle Instant Client (64-bit para Windows). "
                f"Baixe o Instant Client Basic, descompacte em uma pasta (ex: C:\\oracle\\instantclient) e informe na conexão.",
                code="ERR_ORACLE_CLIENT_REQUIRED"
            )

        if "ORA-01017" in raw_msg:
            client_v = None
            try:
                if not oracledb.is_thin_mode():
                    client_v = oracledb.clientversion()
            except Exception:
                pass

            hint = ""
            if client_v and client_v[0] >= 21:
                ver_str = ".".join(map(str, client_v[:4]))
                hint = (
                    f" ATENÇÃO: O Oracle Instant Client em uso é a versão {ver_str} (23ai). "
                    f"A Oracle removeu nas versões 21c e 23ai o suporte aos verificadores de autenticação legados (10G/11G verifiers) de bancos antigos (Oracle 11g/10g/12.1). "
                    f"Mesmo com usuário e senha corretos, o banco antigo rejeita a autenticação com ORA-01017! "
                    f"Para bancos legados, é OBRIGATÓRIO utilizar o Oracle Instant Client 19c (19.x) Basic 64-bit (versão LTS com suporte a Oracle 11g/12c)."
                )

            raise DomainError(
                f"Falha ao autenticar no Oracle Database ({host}:{port}): {sanitize_message(raw_msg)}.{hint}",
                code="ERR_ORACLE_AUTH"
            )

        raise DomainError(
            f"Falha ao conectar no Oracle Database ({host}:{port}): {sanitize_message(raw_msg)}",
            code="ERR_ORACLE_CONNECTION"
        )

    def test_connection(self, connection: Connection) -> Tuple[bool, str, Optional[int]]:
        """Testa conectividade com o Oracle Database executando 'SELECT 1 FROM DUAL'."""
        start_time = time.time()
        try:
            conn = self.connect(connection)
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM DUAL")
                cur.fetchone()
            conn.close()
            latency = int((time.time() - start_time) * 1000)
            mode = "Thick (Instant Client)" if self._thick_mode_initialized else "Thin (Nativo)"
            return True, f"Conexão Oracle estabelecida com sucesso via modo {mode}.", latency
        except Exception as e:
            return False, f"Falha na conexão Oracle: {sanitize_message(str(e))}", None

    def execute_query(self, conn_or_cfg: Any, query: str) -> Any:
        """Executa consulta SQL retornando o cursor."""
        conn = self.connect(conn_or_cfg)
        cur = conn.cursor()
        cur.execute(query)
        return cur

    def execute_query_chunks(self, conn_or_cfg: Any, query: str, fetch_size: int = 10000):
        """Executa consulta em streaming (Fetch Size) gerando Polars DataFrames."""
        from src.core.infrastructure.engines.polars_runner import batch_to_polars_df

        conn = self.connect(conn_or_cfg)
        try:
            cur = conn.cursor()
            cur.arraysize = fetch_size
            cur.execute(query)
            col_names = [desc[0] for desc in cur.description] if cur.description else None

            while True:
                batch = cur.fetchmany(fetch_size)
                if not batch:
                    break

                actual_cols = col_names or [f"col_{i}" for i in range(len(batch[0]))]
                chunk_df = batch_to_polars_df(batch, actual_cols)
                yield chunk_df

            cur.close()
            conn.close()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            raise

    def execute_write(
        self,
        connection: Any,
        table_name: str,
        df: pl.DataFrame,
        table_action: str = "none",
        data_action: str = "insert",
        keys: Optional[List[str]] = None,
        is_first_chunk: bool = True,
        use_batch_mode: bool = True,
        batch_size: int = 10000
    ) -> int:
        """Grava dados no Oracle Database (INSERT, UPDATE, UPSERT / MERGE)."""
        if df.height == 0:
            return 0

        conn = self.connect(connection)
        keys = keys or []
        columns = df.columns

        try:
            with conn.cursor() as cur:
                # ─── Ação de Tabela (no primeiro lote) ───
                if is_first_chunk:
                    if table_action == "truncate":
                        try:
                            cur.execute(f"TRUNCATE TABLE {table_name}")
                        except Exception:
                            pass
                    elif table_action == "drop_create":
                        try:
                            cur.execute(f"DROP TABLE {table_name} PURGE")
                        except Exception:
                            pass
                        # Cria tabela com tipos derivados
                        col_defs = []
                        for col, dtype in zip(df.columns, df.dtypes):
                            ora_type = "VARCHAR2(4000)"
                            if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64):
                                ora_type = "NUMBER"
                            elif dtype in (pl.Float32, pl.Float64):
                                ora_type = "NUMBER"
                            elif dtype == pl.Boolean:
                                ora_type = "NUMBER(1)"
                            elif dtype in (pl.Date, pl.Datetime):
                                ora_type = "TIMESTAMP"
                            col_defs.append(f'"{col}" {ora_type}')

                        create_sql = f'CREATE TABLE {table_name} ({", ".join(col_defs)})'
                        cur.execute(create_sql)

                # ─── Ação de Dados ───
                # Converte dataframe para lista de tuplas com None para valores nulos
                rows = df.to_numpy().tolist() if hasattr(df, "to_numpy") else [tuple(r) for r in df.iter_rows()]

                if data_action == "insert":
                    cols_str = ", ".join([f'"{c}"' for c in columns])
                    binds_str = ", ".join([f":{i+1}" for i in range(len(columns))])
                    sql = f'INSERT INTO {table_name} ({cols_str}) VALUES ({binds_str})'

                    if use_batch_mode and rows:
                        cur.executemany(sql, rows)
                    else:
                        for row in rows:
                            cur.execute(sql, row)

                elif data_action == "upsert" and keys:
                    # MERGE INTO table USING DUAL ON ...
                    on_clause = " AND ".join([f'tgt."{k}" = src."{k}"' for k in keys])
                    update_cols = [c for c in columns if c not in keys]
                    update_set = ", ".join([f'tgt."{c}" = src."{c}"' for c in update_cols])
                    insert_cols = ", ".join([f'"{c}"' for c in columns])
                    insert_vals = ", ".join([f'src."{c}"' for c in columns])

                    select_src = ", ".join([f":{i+1} AS \"{c}\"" for i, c in enumerate(columns)])
                    merge_sql = f"""
                    MERGE INTO {table_name} tgt
                    USING (SELECT {select_src} FROM DUAL) src
                    ON ({on_clause})
                    """
                    if update_cols:
                        merge_sql += f" WHEN MATCHED THEN UPDATE SET {update_set}"
                    merge_sql += f" WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals})"

                    for row in rows:
                        cur.execute(merge_sql, row)

                else:
                    # Fallback insert
                    cols_str = ", ".join([f'"{c}"' for c in columns])
                    binds_str = ", ".join([f":{i+1}" for i in range(len(columns))])
                    sql = f'INSERT INTO {table_name} ({cols_str}) VALUES ({binds_str})'
                    for row in rows:
                        cur.execute(sql, row)

            conn.commit()
            conn.close()
            return df.height
        except Exception:
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
            raise
