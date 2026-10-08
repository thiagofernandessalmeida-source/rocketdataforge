"""Modelos de Domínio para o Motor de Políticas ABAC (Attribute-Based Access Control).

Suporta validação estrita (Strict Mode) para evitar configurações malformadas,
com suporte a Effect (Allow/Deny), Actions, Resources e Conditions.
"""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class EffectEnum(str, Enum):
    """Efeito de uma declaração de política."""
    ALLOW = "Allow"
    DENY = "Deny"


class PolicyStatement(BaseModel):
    """Declaração individual de permissão ou restrição dentro de uma política."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    sid: Optional[str] = Field(
        default=None,
        description="Identificador único amigável do statement (Statement ID)"
    )
    effect: EffectEnum = Field(
        ...,
        description="Efeito da regra: 'Allow' ou 'Deny'"
    )
    actions: List[str] = Field(
        ...,
        min_length=1,
        description="Lista de ações permitidas ou negadas (suporta wildcards ex: 'connector:*', 'pipeline:execute')"
    )
    resources: List[str] = Field(
        ...,
        min_length=1,
        description="Lista de recursos alvos da regra (suporta wildcards ex: 'urn:rdf:connector:*')"
    )
    conditions: Dict[str, Any] = Field(
        default_factory=dict,
        description="Condições e restrições adicionais (ex: max_batch_size, require_job_description)"
    )

    @field_validator("actions", "resources")
    @classmethod
    def validate_non_empty_strings(cls, items: List[str]) -> List[str]:
        for item in items:
            if not item or not isinstance(item, str) or not item.strip():
                raise ValueError("Os itens de 'actions' e 'resources' não podem ser strings vazias.")
        return items


class PolicyDocument(BaseModel):
    """Documento estruturado canônico de Política ABAC."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: str = Field(
        default="2026-10-01",
        description="Versão da especificação da política"
    )
    principal: str = Field(
        ...,
        description="Identidade do usuário ou papel ao qual esta política está vinculada (Identity Binding)"
    )
    hardware_fingerprint: Optional[str] = Field(
        default=None,
        description="Hash de fingerprint da máquina para prevenir cópia de arquivos entre computadores"
    )
    statements: List[PolicyStatement] = Field(
        ...,
        min_length=1,
        description="Conjunto de regras de acesso ABAC"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Metadados descritivos (ex: autor, departamento, data de emissão)"
    )


class EvaluationResult(BaseModel):
    """Resultado da avaliação de uma solicitação de acesso contra políticas."""
    decision: EffectEnum
    allowed: bool
    matched_statement_sid: Optional[str] = None
    reason: str
    evaluated_statements_count: int = 0
