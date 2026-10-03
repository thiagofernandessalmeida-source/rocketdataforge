"""Armazenamento Local de Artefatos (LocalFileSystemArtifactStore).

Armazena planos físicos compilados, arquivos intermediários e exports com integridade SHA-256.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from typing import Any, Dict, Optional, Tuple

from src.core.domain.shared.exceptions import DomainError, SecurityViolationError


class LocalFileSystemArtifactStore:
    """Implementação da porta de ArtifactStore baseada no sistema de arquivos local."""

    def __init__(self, base_directory: Optional[str] = None):
        self.base_directory = os.path.abspath(base_directory or os.path.join(os.getcwd(), ".rdf", "artifacts"))
        os.makedirs(self.base_directory, exist_ok=True)

    def _resolve_safe_path(self, relative_path: str) -> str:
        """Sanitiza e garante que o arquivo resida dentro do base_directory."""
        clean_path = relative_path.lstrip("/\\")
        abs_path = os.path.abspath(os.path.join(self.base_directory, clean_path))
        if not abs_path.startswith(self.base_directory):
            raise SecurityViolationError("Tentativa de acesso a caminho fora do ArtifactStore.")
        return abs_path

    def compute_checksum(self, content_bytes: bytes) -> str:
        """Calcula o checksum SHA-256 do conteúdo."""
        return hashlib.sha256(content_bytes).hexdigest()

    def store_artifact(
        self,
        artifact_key: str,
        content_bytes: bytes,
        content_type: str = "application/json"
    ) -> Tuple[str, str]:
        """Grava o artefato e seu arquivo de metadados (.meta). Retorna (uri, checksum)."""
        safe_path = self._resolve_safe_path(artifact_key)
        os.makedirs(os.path.dirname(safe_path), exist_ok=True)

        checksum = self.compute_checksum(content_bytes)

        # 1. Grava o binário do artefato
        with open(safe_path, "wb") as f:
            f.write(content_bytes)

        # 2. Grava metadados de auditoria e integridade
        meta_path = f"{safe_path}.meta.json"
        meta_data = {
            "key": artifact_key,
            "checksum": checksum,
            "size_bytes": len(content_bytes),
            "content_type": content_type,
            "stored_at": datetime.now(timezone.utc).isoformat()
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta_data, f, indent=2)

        uri = f"artifact://local/{artifact_key.lstrip('/\\')}"
        return uri, checksum

    def load_artifact(self, artifact_key_or_uri: str) -> bytes:
        """Recupera o conteúdo do artefato validando sua integridade."""
        key = artifact_key_or_uri.replace("artifact://local/", "")
        safe_path = self._resolve_safe_path(key)

        if not os.path.exists(safe_path):
            raise DomainError(f"Artefato não encontrado: '{artifact_key_or_uri}'", code="ERR_ARTIFACT_NOT_FOUND")

        with open(safe_path, "rb") as f:
            content = f.read()

        # Validação de integridade via metadados se existir
        meta_path = f"{safe_path}.meta.json"
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            expected_checksum = meta.get("checksum")
            actual_checksum = self.compute_checksum(content)
            if expected_checksum and actual_checksum != expected_checksum:
                raise DomainError(
                    f"Corrupção detectada no artefato '{key}'. Checksum divergente.",
                    code="ERR_ARTIFACT_CORRUPTED"
                )

        return content

    def has_artifact(self, artifact_key_or_uri: str) -> bool:
        """Verifica existência do artefato."""
        key = artifact_key_or_uri.replace("artifact://local/", "")
        safe_path = self._resolve_safe_path(key)
        return os.path.exists(safe_path)
