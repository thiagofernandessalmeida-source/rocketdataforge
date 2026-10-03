"""Agregado PipelineVersion.

Representação imutável de uma versão publicada de pipeline funcional.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict

from src.core.domain.pipeline.hasher import compute_canonical_hash
from src.core.domain.shared.exceptions import DomainValidationError


@dataclass(frozen=True)
class PipelineVersion:
    """Snapshot imutável e auditável de uma versão funcional de pipeline."""
    pipeline_id: str
    version_tag: str
    schema_version: str
    definition_hash: str
    immutable_definition: Dict[str, Any]
    published_by: str
    published_at: datetime

    def __post_init__(self) -> None:
        if not self.pipeline_id or not self.pipeline_id.strip():
            raise DomainValidationError("PipelineVersion pipeline_id não pode ser vazio")
        if not self.version_tag or not self.version_tag.strip():
            raise DomainValidationError("PipelineVersion version_tag não pode ser vazio")
        if not self.definition_hash or len(self.definition_hash) != 64:
            raise DomainValidationError("PipelineVersion definition_hash deve ser um SHA-256 válido de 64 caracteres")
        if not self.published_by or not self.published_by.strip():
            raise DomainValidationError("PipelineVersion published_by é obrigatório para auditoria")

    @classmethod
    def publish(
        cls,
        pipeline_id: str,
        version_tag: str,
        canonical_definition: Dict[str, Any],
        published_by: str
    ) -> "PipelineVersion":
        """Fábrica para publicar uma versão a partir de um dicionário canônico válido."""
        schema_version = canonical_definition.get("schemaVersion", "rdf.pipeline/v1")
        definition_hash = compute_canonical_hash(canonical_definition)

        return cls(
            pipeline_id=pipeline_id,
            version_tag=version_tag.strip(),
            schema_version=schema_version,
            definition_hash=definition_hash,
            immutable_definition=canonical_definition,
            published_by=published_by.strip(),
            published_at=datetime.now(timezone.utc)
        )
