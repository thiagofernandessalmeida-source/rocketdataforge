"""Repositório SQLAlchemy para PipelineDraft e PipelineVersion."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.pipeline.edge import Edge
from src.core.domain.pipeline.node import Node
from src.core.domain.pipeline.version import PipelineVersion
from src.core.domain.shared.types import PortId, SemanticVersion
from src.core.infrastructure.persistence.models import (
    PipelineDraftModel,
    PipelineVersionModel,
)


class SqlAlchemyPipelineRepository:
    """Implementação concreta de repositório de pipelines usando SQLAlchemy."""

    def __init__(self, session: Session):
        self.session = session

    def save_draft(
        self,
        draft: PipelineDraft,
        layout: Optional[Dict[str, Any]] = None
    ) -> None:
        """Salva ou atualiza um draft com sua respectiva camada de layout."""
        model = self.session.get(PipelineDraftModel, draft.id)
        canonical_dict = draft.to_canonical_dict()

        if model is None:
            model = PipelineDraftModel(
                id=draft.id,
                project_id=draft.project_id,
                name=draft.name,
                description=draft.description,
                revision=draft.revision,
                definition_json=canonical_dict,
                layout_json=layout or {}
            )
            self.session.add(model)
        else:
            model.name = draft.name
            model.description = draft.description
            model.revision = draft.revision
            model.definition_json = canonical_dict
            if layout is not None:
                model.layout_json = layout

        self.session.flush()

    def get_draft(self, pipeline_id: str) -> Optional[Tuple[PipelineDraft, Dict[str, Any]]]:
        """Recupera um draft e seu layout visual a partir do ID."""
        model = self.session.get(PipelineDraftModel, pipeline_id)
        if model is None:
            return None

        # Reconstrói a entidade de domínio PipelineDraft
        draft = PipelineDraft(
            id=model.id,
            project_id=model.project_id,
            name=model.name,
            description=model.description,
            revision=model.revision
        )

        def_json = model.definition_json or {}
        spec = def_json.get("spec", {})
        draft.parameters = spec.get("parameters", {})

        for n_dict in spec.get("nodes", []):
            node_id = n_dict["id"]
            comp_info = n_dict.get("component", {})
            comp_type = comp_info.get("type", "generic")
            version_str = comp_info.get("version", "1.0.0")
            draft.nodes[node_id] = Node(
                id=node_id,
                component_type=comp_type,
                component_version=SemanticVersion.parse(version_str),
                config=n_dict.get("config", {})
            )

        for e_dict in spec.get("edges", []):
            edge_id = e_dict["id"]
            from_port = PortId.parse(e_dict["from"])
            to_port = PortId.parse(e_dict["to"])
            draft.edges[edge_id] = Edge(id=edge_id, from_port=from_port, to_port=to_port)

        return draft, dict(model.layout_json or {})

    def save_version(self, version: PipelineVersion) -> None:
        """Persiste uma versão imutável publicada."""
        model = self.session.get(PipelineVersionModel, version.definition_hash)
        if model is None:
            model = PipelineVersionModel(
                id=version.definition_hash,
                pipeline_id=version.pipeline_id,
                version_tag=version.version_tag,
                schema_version=version.schema_version,
                definition_hash=version.definition_hash,
                immutable_definition_json=version.immutable_definition,
                published_by=version.published_by,
                published_at=version.published_at
            )
            self.session.add(model)
            self.session.flush()

    def get_version(self, version_id_or_hash: str) -> Optional[PipelineVersion]:
        """Recupera uma versão pelo hash ou ID."""
        model = (
            self.session.query(PipelineVersionModel)
            .filter(
                (PipelineVersionModel.id == version_id_or_hash) |
                (PipelineVersionModel.definition_hash == version_id_or_hash)
            )
            .first()
        )
        if model is None:
            return None

        return PipelineVersion(
            pipeline_id=model.pipeline_id,
            version_tag=model.version_tag,
            schema_version=model.schema_version,
            definition_hash=model.definition_hash,
            immutable_definition=dict(model.immutable_definition_json),
            published_by=model.published_by,
            published_at=model.published_at
        )

    def list_versions(self, pipeline_id: str) -> List[PipelineVersion]:
        """Lista todas as versões publicadas de um pipeline."""
        models = (
            self.session.query(PipelineVersionModel)
            .filter(PipelineVersionModel.pipeline_id == pipeline_id)
            .order_by(PipelineVersionModel.published_at.desc())
            .all()
        )
        return [
            PipelineVersion(
                pipeline_id=m.pipeline_id,
                version_tag=m.version_tag,
                schema_version=m.schema_version,
                definition_hash=m.definition_hash,
                immutable_definition=dict(m.immutable_definition_json),
                published_by=m.published_by,
                published_at=m.published_at
            )
            for m in models
        ]
