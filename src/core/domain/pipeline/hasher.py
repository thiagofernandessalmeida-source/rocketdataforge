"""Calculador de Hash Criptográfico Determinístico para Pipeline.

Garante que o cálculo do hash da definição funcional seja reproduzível,
independente de ordenação de chaves em dicionários.
"""

import hashlib
import json
from typing import Any, Dict


def compute_canonical_hash(canonical_dict: Dict[str, Any]) -> str:
    """Calcula o SHA-256 determinístico de um dicionário canônico."""
    # Serializa em JSON compacto e com chaves ordenadas
    canonical_json = json.dumps(
        canonical_dict,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
