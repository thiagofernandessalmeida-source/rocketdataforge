"""Identificadores de domínio (ULID).

Gera e valida identificadores lexicograficamente ordenáveis sem dependências externas.
"""

from dataclasses import dataclass
import os
import re
import time

from src.core.domain.shared.exceptions import DomainValidationError

# Crockford's Base32 Alphabet
CROCKFORD_32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_REGEX = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$", re.IGNORECASE)


def generate_ulid() -> str:
    """Gera uma string de 26 caracteres no padrão ULID."""
    # 48-bit timestamp em milissegundos
    timestamp_ms = int(time.time() * 1000)
    time_chars = [""] * 10
    for i in range(9, -1, -1):
        time_chars[i] = CROCKFORD_32[timestamp_ms % 32]
        timestamp_ms //= 32

    # 80-bit randomness (16 caracteres)
    random_bytes = os.urandom(10)
    rand_int = int.from_bytes(random_bytes, byteorder="big")
    rand_chars = [""] * 16
    for i in range(15, -1, -1):
        rand_chars[i] = CROCKFORD_32[rand_int % 32]
        rand_int //= 32

    return "".join(time_chars) + "".join(rand_chars)


@dataclass(frozen=True)
class EntityId:
    """Value Object representando um identificador único de entidade (ULID)."""
    value: str

    def __post_init__(self) -> None:
        val = self.value.strip().upper()
        if not ULID_REGEX.match(val):
            raise DomainValidationError(
                f"Identificador inválido: '{self.value}'. Deve ser um ULID canônico de 26 caracteres."
            )
        # Normaliza para maiúsculas
        object.__setattr__(self, "value", val)

    def __str__(self) -> str:
        return self.value

    @classmethod
    def generate(cls) -> "EntityId":
        """Cria uma nova instância com ULID gerado monotonicamente."""
        return cls(value=generate_ulid())
