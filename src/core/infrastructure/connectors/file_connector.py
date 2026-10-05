"""Conector de Arquivos Locais (CSV, JSON, Parquet).

Suporta leitura e escrita em chunks/streaming com validação estrita contra Path Traversal
e tolerância a esquemas heterogêneos e arquivos sujos/malformados.
"""

import os
from pathlib import Path
from typing import Iterator, List, Optional

import polars as pl
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError


class LocalFileConnector:
    """Conector seguro de arquivos com suporte a streaming e particionamento em chunks."""

    def __init__(self, base_directory: Optional[str] = None, allowed_roots: Optional[List[str]] = None):
        self.base_directory = os.path.normcase(os.path.realpath(base_directory or os.getcwd()))
        self.allowed_roots = [self.base_directory]
        if allowed_roots:
            self.allowed_roots.extend([os.path.normcase(os.path.realpath(r)) for r in allowed_roots])
        else:
            import tempfile
            self.allowed_roots.append(os.path.normcase(os.path.realpath(tempfile.gettempdir())))
            parent = os.path.dirname(self.base_directory)
            if parent:
                self.allowed_roots.append(os.path.normcase(os.path.realpath(parent)))
            # Permite diretório do usuário e Downloads
            user_home = os.path.normcase(os.path.realpath(os.path.expanduser("~")))
            self.allowed_roots.append(user_home)
            downloads = os.path.normcase(os.path.realpath(os.path.join(user_home, "Downloads")))
            if downloads not in self.allowed_roots:
                self.allowed_roots.append(downloads)

    def validate_safe_path(self, raw_path: str) -> str:
        """Sanitiza e valida se o caminho não escapa do diretório base (Prevenção de Path Traversal)."""
        if not raw_path or not raw_path.strip():
            raise DomainValidationError("O caminho do arquivo não pode ser vazio.")

        # Remove aspas acidentais no início e no fim
        clean_path = raw_path.strip().strip('"').strip("'")

        # Se for caminho existente direto (absoluto ou relativo)
        if os.path.exists(clean_path):
            resolved_path = os.path.abspath(clean_path)
        elif os.path.isabs(clean_path):
            resolved_path = os.path.abspath(clean_path)
        else:
            # Busca inteligente de candidatos para caminhos relativos
            user_downloads = os.path.join(os.path.expanduser("~"), "Downloads", clean_path)
            candidates = [
                os.path.abspath(os.path.join(self.base_directory, clean_path)),
                os.path.abspath(os.path.join(self.base_directory, "data", clean_path)),
                os.path.abspath(os.path.join(self.base_directory, "data", "samples", clean_path)),
                os.path.abspath(os.path.join(self.base_directory, "output", clean_path)),
                os.path.abspath(user_downloads),
            ]
            resolved_path = candidates[0]
            for c in candidates:
                if os.path.exists(c):
                    resolved_path = c
                    break

        real_resolved = os.path.normcase(os.path.realpath(resolved_path))

        # Confirma se pertence a um dos roots permitidos
        def _is_subpath(path: str, parent_root: str) -> bool:
            try:
                return os.path.commonpath([parent_root, path]) == parent_root
            except ValueError:
                return False

        is_abs = os.path.isabs(clean_path) or (len(clean_path) > 1 and clean_path[1] == ":")
        if not is_abs and not any(_is_subpath(real_resolved, root) for root in self.allowed_roots):
            base_real = os.path.normcase(os.path.realpath(self.base_directory))
            if not _is_subpath(real_resolved, base_real):
                raise SecurityViolationError(
                    f"Acesso negado: Tentativa de path traversal detectada no caminho relativo '{raw_path}'."
                )
        elif is_abs:
            if not any(_is_subpath(real_resolved, root) for root in self.allowed_roots):
                drive, _ = os.path.splitdrive(real_resolved)
                base_drive, _ = os.path.splitdrive(self.base_directory)
                if not (drive and base_drive and drive.lower() == base_drive.lower()):
                    raise SecurityViolationError(
                        f"Acesso negado: O caminho '{raw_path}' está fora do diretório permitido do workspace."
                    )

        return resolved_path

    def read_chunks(
        self,
        file_path: str,
        file_format: str = "csv",
        chunk_size: int = 10000,
        columns: Optional[List[str]] = None,
        schema_overrides: Optional[dict] = None
    ) -> Iterator[pl.DataFrame]:
        """Lê o arquivo em lotes sucessivos de DataFrames Polars com robustez contra erros de parsing e suporte a schema_overrides."""
        safe_path = self.validate_safe_path(file_path)

        if not os.path.exists(safe_path):
            raise DomainValidationError(f"Arquivo não encontrado: '{file_path}' (resolvido como '{safe_path}')")

        fmt = file_format.lower()

        if fmt == "csv":
            try:
                # Inferência completa do schema + tolerância a linhas malformadas + sobreposição de tipos configurados
                lazy_df = pl.scan_csv(
                    safe_path,
                    schema_overrides=schema_overrides,
                    infer_schema_length=None if not schema_overrides else 10000,
                    ignore_errors=True,
                    truncate_ragged_lines=True,
                )
                if columns:
                    available_cols = set(lazy_df.collect_schema().names())
                    selected_cols = [c for c in columns if c in available_cols]
                    if selected_cols:
                        lazy_df = lazy_df.select(selected_cols)
                for batch in lazy_df.collect_batches(chunk_size=chunk_size):
                    yield batch
            except Exception as scan_err:
                # Fallback para DuckDB se o Polars falhar devido a aspas ou codificação
                import duckdb
                conn = duckdb.connect()
                clean_p = safe_path.replace("\\", "/")
                total_rows = conn.execute(
                    f"SELECT count(*) FROM read_csv_auto('{clean_p}', ignore_errors=true)"
                ).fetchone()[0]
                for offset in range(0, total_rows, chunk_size):
                    q = f"SELECT * FROM read_csv_auto('{clean_p}', ignore_errors=true) LIMIT {chunk_size} OFFSET {offset}"
                    chunk_df = conn.execute(q).pl()
                    if schema_overrides:
                        for c_name, target_type in schema_overrides.items():
                            if c_name in chunk_df.columns:
                                try:
                                    chunk_df = chunk_df.with_columns(pl.col(c_name).cast(target_type, strict=False))
                                except Exception:
                                    pass
                    if columns:
                        available_cols = [c for c in columns if c in chunk_df.columns]
                        if available_cols:
                            chunk_df = chunk_df.select(available_cols)
                    if chunk_df.height > 0:
                        yield chunk_df

        elif fmt == "parquet":
            lazy_df = pl.scan_parquet(safe_path)
            if columns:
                available_cols = set(lazy_df.collect_schema().names())
                selected_cols = [c for c in columns if c in available_cols]
                if selected_cols:
                    lazy_df = lazy_df.select(selected_cols)

            total_rows = lazy_df.select(pl.len()).collect().item()
            for offset in range(0, total_rows, chunk_size):
                chunk = lazy_df.slice(offset, chunk_size).collect()
                if chunk.height > 0:
                    yield chunk

        elif fmt == "json":
            df = pl.read_json(safe_path)
            if columns:
                df = df.select([c for c in columns if c in df.columns])
            for offset in range(0, df.height, chunk_size):
                yield df.slice(offset, chunk_size)

        else:
            raise DomainValidationError(f"Formato de arquivo não suportado para leitura: '{file_format}'")

    def write_dataframe(
        self,
        df: pl.DataFrame,
        file_path: str,
        file_format: str = "parquet",
        write_mode: str = "append"
    ) -> int:
        """Grava DataFrame no arquivo especificado."""
        safe_path = self.validate_safe_path(file_path)
        dir_name = os.path.dirname(os.path.abspath(safe_path))
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)

        fmt = file_format.lower()
        file_exists = os.path.exists(safe_path)

        if write_mode == "append" and file_exists:
            # Se o DataFrame de entrada não contiver linhas ou colunas, não modifica o arquivo
            if df.width == 0 or df.height == 0:
                if fmt == "parquet":
                    try:
                        return pl.read_parquet(safe_path).height
                    except Exception:
                        return 0
                return 0

            # Em modo append, combina com dados pré-existentes
            if fmt == "csv":
                with open(safe_path, "a", encoding="utf-8") as f:
                    df.write_csv(f, include_header=False)
                return df.height
            elif fmt == "parquet":
                existing_df = pl.read_parquet(safe_path)
                try:
                    combined = pl.concat([existing_df, df], how="diagonal")
                except Exception:
                    combined = pl.concat([existing_df, df])
                combined.write_parquet(safe_path)
                return df.height

        # Modo replace ou arquivo novo
        if fmt == "parquet":
            df.write_parquet(safe_path)
        elif fmt == "csv":
            df.write_csv(safe_path)
        elif fmt == "json":
            df.write_json(safe_path)
        else:
            raise DomainValidationError(f"Formato de arquivo não suportado para escrita: '{file_format}'")

        return df.height
