"""Provedores de Armazenamento de Políticas ABAC (Local File e Secrets Manager)."""

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Optional

from src.core.domain.policy.policy_model import PolicyDocument
from src.core.infrastructure.security.policy_crypto import PolicyCryptoService


class PolicyStorageProvider(ABC):
    """Interface abstrata para persistência e recuperação de políticas assinadas."""

    @abstractmethod
    def save_policy(self, principal: str, signed_jws: str) -> None:
        pass

    @abstractmethod
    def load_policy_jws(self, principal: str) -> Optional[str]:
        pass


class LocalFilePolicyStore(PolicyStorageProvider):
    """Armazenamento de políticas em arquivos .jws no sistema de arquivos local."""

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir or os.environ.get("RDF_POLICIES_DIR", "./.policies"))
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _get_path(self, principal: str) -> Path:
        safe_principal = "".join(c for c in principal if c.isalnum() or c in ("-", "_"))
        return self.base_dir / f"policy_{safe_principal}.jws"

    def save_policy(self, principal: str, signed_jws: str) -> None:
        path = self._get_path(principal)
        path.write_text(signed_jws, encoding="utf-8")

    def load_policy_jws(self, principal: str) -> Optional[str]:
        path = self._get_path(principal)
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8").strip()


class MemorySecretManagerPolicyStore(PolicyStorageProvider):
    """Provedor em memória / Mock de Secret Manager (ex: AWS Secrets Manager / Vault)."""

    def __init__(self):
        self._secrets: Dict[str, str] = {}

    def save_policy(self, principal: str, signed_jws: str) -> None:
        self._secrets[f"rdf/policies/{principal}"] = signed_jws

    def load_policy_jws(self, principal: str) -> Optional[str]:
        return self._secrets.get(f"rdf/policies/{principal}")
