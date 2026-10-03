"""Agregado Connection.

Configuração de acesso a fontes e destinos externos.
Garante o princípio inegociável de ZERO SEGREDOS EM TEXTO PURO.
"""

from dataclasses import dataclass, field
import re
from typing import Any, Dict

from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.domain.shared.types import SecretReference

FORBIDDEN_PLAINTEXT_KEYS = {"password", "pwd", "secret", "token", "auth_token", "api_key", "private_key"}


@dataclass
class Connection:
    """Aggregate Root de Conexão com sistemas externos."""
    id: str
    project_id: str
    name: str
    connector_type: str
    endpoint: str
    secret_ref: SecretReference
    options: Dict[str, Any] = field(default_factory=dict)
    is_active: bool = True

    def __post_init__(self) -> None:
        if not self.id or not self.id.strip():
            raise DomainValidationError("Connection id não pode ser vazio")
        if not self.project_id or not self.project_id.strip():
            raise DomainValidationError("Connection project_id não pode ser vazio")
        if not self.name or not self.name.strip():
            raise DomainValidationError("Connection name não pode ser vazio")
        if not self.connector_type or not self.connector_type.strip():
            raise DomainValidationError("Connection connector_type não pode ser vazio")
        if not isinstance(self.secret_ref, SecretReference):
            raise SecurityViolationError("Connection requer uma instância válida de SecretReference")

        self._validate_no_plaintext_secrets()

    def _validate_no_plaintext_secrets(self) -> None:
        """Assegura que nenhuma credencial confidencial foi inserida em options ou endpoint."""
        # 1. Checa chaves proibidas no dicionário de options
        for key in self.options.keys():
            if key.lower() in FORBIDDEN_PLAINTEXT_KEYS:
                raise SecurityViolationError(
                    f"Violação de segurança: chave sensível '{key}' proibida em options. Utilize SecretReference."
                )

        # 2. Checa se o endpoint contém credencial embutida (ex: postgresql://user:pass@host)
        if re.search(r"://[^:]+:[^@]+@", self.endpoint):
            raise SecurityViolationError(
                "Violação de segurança: O endpoint contém usuário e senha embutidos na URL. "
                "Separe o endpoint da credencial e utilize SecretReference."
            )

    def update_options(self, new_options: Dict[str, Any]) -> None:
        """Atualiza options com validação estrita de segredos."""
        self.options = new_options
        self._validate_no_plaintext_secrets()
