"""Resolvedor de Segredos Just-In-Time (SecretResolver).

Resolve referências SecretReference sem persistir credenciais e sem vazar valores em logs.
"""

import logging
import os
from typing import Dict, Optional

from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.domain.shared.types import SecretReference

logger = logging.getLogger(__name__)


class SecretResolver:
    """Serviço de resolução de segredos por variáveis de ambiente ou provider local."""

    def __init__(self, custom_env: Optional[Dict[str, str]] = None):
        self._custom_env = custom_env

    def resolve(self, secret_ref: SecretReference) -> str:
        """Resolve o valor secreto da referência sob demanda."""
        if not isinstance(secret_ref, SecretReference):
            raise SecurityViolationError("Argumento deve ser uma instância de SecretReference.")

        uri = secret_ref.uri
        if uri.startswith("secret://env/"):
            var_name = uri[len("secret://env/"):]
            if not var_name:
                raise SecurityViolationError("Nome da variável de ambiente não informado na SecretReference.")

            # Busca no dicionário customizado ou nas variáveis de ambiente do SO
            val = None
            if self._custom_env is not None:
                val = self._custom_env.get(var_name)
            if val is None:
                val = os.environ.get(var_name)

            if val is None:
                raise SecurityViolationError(
                    f"Variável de ambiente '{var_name}' referenciada por '{uri}' não foi encontrada."
                )

            logger.debug(f"Segredo resolvido com sucesso a partir da variável '{var_name}' (conteúdo omitido).")
            return val

        raise SecurityViolationError(f"Esquema de segredo não suportado: '{uri}'")
