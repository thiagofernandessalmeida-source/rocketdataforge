"""Conector de Arquivos Locais (CSV, JSON, Parquet).

Suporta leitura e escrita em chunks/streaming com validação estrita contra Path Traversal.
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

    def validate_safe_path(self, raw_path: str) -> str:
        """Sanitiza e valida se o caminho não escapa do diretório base (Prevenção de Path Traversal)."""
        if not raw_path or not raw_path.strip():
            raise DomainValidationError("O caminho do arquivo não pode ser vazio.")

        # Remove aspas acidentais no início e no fim
        clean_path = raw_path.strip().strip('"').strip("'")

        # Normaliza caminho absoluto
        if os.path.isabs(clean_path):
            resolved_path = os.path.abspath(clean_path)
        else:
            resolved_path = os.path.abspath(os.path.join(self.base_directory, clean_path))

        real_resolved = os.path.normcase(os.path.realpath(resolved_path))

        # Confirma que pertence a um dos roots permitidos
        def _is_subpath(path: str, parent_root: str) -> bool:
            try:
                return os.path.commonpath([parent_root, path]) == parent_root
            except ValueError:
                return False

        is_abs = os.path.isabs(clean_path) or (len(clean_path) > 1 and clean_path[1] == ":")
        if not is_abs:
            base_real = os.path.normcase(os.path.realpath(self.base_directory))
            if not _is_subpath(real_resolved, base_real):
                raise SecurityViolationError(
                    f"Acesso negado: Tentativa de path traversal detectada no caminho relativo '{raw_path}'."
                )
        else:
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
        columns: Optional[List[str]] = None
    ) -> Iterator[pl.DataFrame]:
        """Lê o arquivo em lotes sucessivos de DataFrames Polars."""
        safe_path = self.validate_safe_path(file_path)

        if not os.path.exists(safe_path):
            raise DomainValidationError(f"Arquivo não encontrado: '{file_path}'")

        fmt = file_format.lower()

        if fmt == "csv":
            lazy_df = pl.scan_csv(safe_path)
            if columns:
                available_cols = set(lazy_df.collect_schema().names())
                selected_cols = [c for c in columns if c in available_cols]
                if selected_cols:
                    lazy_df = lazy_df.select(selected_cols)
            for batch in lazy_df.collect_batches(chunk_size=chunk_size):
                yield batch

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
        os.makedirs(os.path.dirname(safe_path), exist_ok=True)

        fmt = file_format.lower()
        file_exists = os.path.exists(safe_path)

        if write_mode == "append" and file_exists:
            # Em modo append, combina com dados pré-existentes
            if fmt == "csv":
                with open(safe_path, "a", encoding="utf-8") as f:
                    df.write_csv(f, include_header=False)
                return df.height
            elif fmt == "parquet":
                existing_df = pl.read_parquet(safe_path)
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
