"""Catálogo e Mecanismo de Mascaramento de Dados / PII / LGPD (Spec 006 - Fase 2).

Fornece regras declarativas para anonimização e ofuscação de dados sensíveis:
- MASK_HASH: Hashing irreversível SHA-256 com salt.
- MASK_EMAIL: Ocultação da parte local de e-mails mantendo inicial e domínio.
- MASK_CPF_CNPJ: Mascaramento de blocos intermediários de documentos brasileiros.
- MASK_NULL: Redação total para nulo.
- MASK_REDACT: Substituição por marcador fixo [REDACTED].
"""

from dataclasses import dataclass
from enum import Enum
import hashlib
import re
from typing import Any, Dict, List, Optional
import polars as pl


class MaskingType(str, Enum):
    HASH = "MASK_HASH"
    EMAIL = "MASK_EMAIL"
    CPF_CNPJ = "MASK_CPF_CNPJ"
    NULL = "MASK_NULL"
    REDACT = "MASK_REDACT"
    RANDOM_STRING = "MASK_RANDOM_STRING"
    NOISE = "MASK_NOISE"

    @classmethod
    def from_str(cls, val: str) -> "MaskingType":
        normalized = (val or "").upper().strip()
        for member in cls:
            if member.value == normalized or member.name == normalized:
                return member
        return cls.REDACT


@dataclass
class MaskingRule:
    column_name: str
    masking_type: MaskingType | str
    salt: Optional[str] = None
    custom_value: Optional[str] = None

    def __post_init__(self):
        if isinstance(self.masking_type, str):
            self.masking_type = MaskingType.from_str(self.masking_type)


MASKING_CATALOG: Dict[str, Dict[str, Any]] = {
    MaskingType.HASH.value: {
        "label": "Hash SHA-256 (com Salt)",
        "description": "Calcula hash criptográfico irreversível e determinístico.",
        "has_salt": True,
        "example": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    MaskingType.EMAIL.value: {
        "label": "E-mail Parcial",
        "description": "Preserva a primeira letra e o domínio completo.",
        "has_salt": False,
        "example": "j***@empresa.com"
    },
    MaskingType.CPF_CNPJ.value: {
        "label": "CPF / CNPJ",
        "description": "Mascara os dígitos centrais mantendo raiz e final.",
        "has_salt": False,
        "example": "123.***.***-00"
    },
    MaskingType.NULL.value: {
        "label": "Definir como Nulo",
        "description": "Substitui todos os valores da coluna por NULL.",
        "has_salt": False,
        "example": "NULL"
    },
    MaskingType.REDACT.value: {
        "label": "Redigir ([REDACTED])",
        "description": "Substitui os valores por texto de redação padrão.",
        "has_salt": False,
        "example": "[REDACTED]"
    },
}


def mask_value(value: Any, rule: MaskingRule) -> Any:
    """Aplica a regra de mascaramento em um valor escalar único em memória."""
    if value is None:
        return None

    mtype = rule.masking_type
    if isinstance(mtype, str):
        mtype = MaskingType.from_str(mtype)

    if mtype == MaskingType.NULL:
        return None

    if mtype in (MaskingType.REDACT, MaskingType.RANDOM_STRING, MaskingType.NOISE):
        return rule.custom_value or "[REDACTED]"

    val_str = str(value)

    if mtype == MaskingType.HASH:
        salt = rule.salt or ""
        payload = (val_str + salt).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    if mtype == MaskingType.EMAIL:
        cleaned = val_str.strip()
        if "@" in cleaned and cleaned.index("@") >= 1:
            local, domain = cleaned.split("@", 1)
            initial = local[0]
            return f"{initial}***@{domain}"
        return "***"

    if mtype == MaskingType.CPF_CNPJ:
        digits = re.sub(r"\D", "", val_str)
        if len(digits) == 11:
            return f"{digits[:3]}.***.***-{digits[-2:]}"
        elif len(digits) == 14:
            return f"{digits[:2]}.***.***/****-{digits[-2:]}"
        elif len(digits) >= 4:
            return f"{digits[:2]}***{digits[-2:]}"
        return "***"

    return rule.custom_value or "[REDACTED]"


def get_sql_masking_expression(column_name: str, rule: MaskingRule) -> str:
    """Gera a expressão SQL DuckDB equivalente para aplicar mascaramento nativo."""
    mtype = rule.masking_type
    if isinstance(mtype, str):
        mtype = MaskingType.from_str(mtype)

    col = column_name.replace('"', '""')

    if mtype == MaskingType.NULL:
        return "NULL"

    if mtype in (MaskingType.REDACT, MaskingType.RANDOM_STRING, MaskingType.NOISE):
        redact_val = (rule.custom_value or "[REDACTED]").replace("'", "''")
        return f"CASE WHEN \"{col}\" IS NULL THEN NULL ELSE '{redact_val}' END"

    if mtype == MaskingType.HASH:
        salt_val = (rule.salt or "").replace("'", "''")
        return f"CASE WHEN \"{col}\" IS NULL THEN NULL ELSE sha256(concat(CAST(\"{col}\" AS VARCHAR), '{salt_val}')) END"

    if mtype == MaskingType.EMAIL:
        return (
            f"CASE "
            f"WHEN \"{col}\" IS NULL THEN NULL "
            f"WHEN position('@' in CAST(\"{col}\" AS VARCHAR)) > 1 "
            f"THEN concat(substr(CAST(\"{col}\" AS VARCHAR), 1, 1), '***@', split_part(CAST(\"{col}\" AS VARCHAR), '@', 2)) "
            f"ELSE '***' END"
        )

    if mtype == MaskingType.CPF_CNPJ:
        # Limpa dígitos e aplica máscara
        cleaned = f"regexp_replace(CAST(\"{col}\" AS VARCHAR), '[^0-9]', '', 'g')"
        return (
            f"CASE "
            f"WHEN \"{col}\" IS NULL THEN NULL "
            f"WHEN length({cleaned}) = 11 "
            f"THEN concat(substr({cleaned}, 1, 3), '.***.***-', substr({cleaned}, 10, 2)) "
            f"WHEN length({cleaned}) = 14 "
            f"THEN concat(substr({cleaned}, 1, 2), '.***.***/****-', substr({cleaned}, 13, 2)) "
            f"ELSE '***' END"
        )

    return f"CASE WHEN \"{col}\" IS NULL THEN NULL ELSE '[REDACTED]' END"


def build_masked_projection_sql(columns: List[str], rules: List[MaskingRule]) -> str:
    """Constrói a cláusula SELECT com expressões de mascaramento nativas para DuckDB."""
    rule_map = {r.column_name: r for r in rules}
    select_items = []
    for col in columns:
        if col in rule_map:
            sql_expr = get_sql_masking_expression(col, rule_map[col])
            select_items.append(f'{sql_expr} AS "{col}"')
        else:
            select_items.append(f'"{col}"')
    return ", ".join(select_items) if select_items else "*"


def extract_masking_rules(config: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extrai regras de mascaramento a partir de configurações de nó, schemas ou dicionários explícitos."""
    if not config or not isinstance(config, dict):
        return []

    rules: List[Dict[str, Any]] = []
    seen_cols = set()

    # 1. Regras explícitas em config["masking_rules"]
    explicit_rules = config.get("masking_rules") or []
    if isinstance(explicit_rules, list):
        for r in explicit_rules:
            if isinstance(r, dict):
                col = r.get("column_name") or r.get("column") or r.get("name")
                m_type = r.get("masking_type") or r.get("type")
                if col and m_type and col not in seen_cols:
                    rules.append({
                        "column_name": str(col),
                        "masking_type": str(m_type),
                        "salt": r.get("salt") or r.get("masking_salt"),
                        "custom_value": r.get("custom_value")
                    })
                    seen_cols.add(col)
            elif isinstance(r, MaskingRule):
                if r.column_name not in seen_cols:
                    rules.append({
                        "column_name": r.column_name,
                        "masking_type": str(r.masking_type.value if hasattr(r.masking_type, "value") else r.masking_type),
                        "salt": r.salt,
                        "custom_value": r.custom_value
                    })
                    seen_cols.add(r.column_name)

    # 2. Definições no schema / schema_definitions
    schema = config.get("schema") or config.get("schema_definitions") or []
    if isinstance(schema, list):
        for col_def in schema:
            if isinstance(col_def, dict):
                col_name = col_def.get("name") or col_def.get("column")
                m_type = col_def.get("masking") or col_def.get("masking_type")
                if col_name and m_type and str(m_type).upper() not in ("NONE", "") and col_name not in seen_cols:
                    rules.append({
                        "column_name": str(col_name),
                        "masking_type": str(m_type),
                        "salt": col_def.get("masking_salt") or col_def.get("salt"),
                        "custom_value": col_def.get("custom_value")
                    })
                    seen_cols.add(col_name)

    # 3. Mapeamento simples em config["pii_mask"] ou config["masking"]
    pii_map = config.get("pii_mask") or {}
    if isinstance(pii_map, dict):
        for col_name, m_type in pii_map.items():
            if col_name not in seen_cols and m_type and str(m_type).upper() not in ("NONE", ""):
                rules.append({
                    "column_name": str(col_name),
                    "masking_type": str(m_type),
                    "salt": config.get("masking_salt") or config.get("salt"),
                    "custom_value": None
                })
                seen_cols.add(col_name)

    return rules


class DataMasker:
    """Serviço de aplicação de políticas de mascaramento de dados em lotes."""

    @staticmethod
    def apply_masking(df: pl.DataFrame, rules: List[MaskingRule]) -> pl.DataFrame:
        """Aplica regras de anonimização em um DataFrame Polars."""
        if not rules or df.height == 0:
            return df

        cols_to_mask = {r.column_name: r for r in rules if r.column_name in df.columns}
        if not cols_to_mask:
            return df

        exprs = []
        for col_name, rule in cols_to_mask.items():
            # Cria função de mapeamento
            fn = lambda val, r=rule: mask_value(val, r)
            exprs.append(
                pl.col(col_name).map_elements(fn, return_dtype=pl.Utf8).alias(col_name)
            )

        return df.with_columns(exprs)

