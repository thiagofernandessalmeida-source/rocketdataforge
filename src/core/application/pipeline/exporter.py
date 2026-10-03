"""Exportador de Pipelines (PipelineExporter).

Gera a exportação desacoplada de pipeline.yaml (lógica de processamento sem dados visuais)
e layout.json (coordenadas visuais e viewport do canvas React Flow),
assegurando conformidade com os esquemas normativos e o princípio de zero segredos.
"""

from dataclasses import dataclass
import json
import re
from typing import Any, Dict, List, Optional
import yaml

from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.pipeline.version import PipelineVersion
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError

FORBIDDEN_PLAINTEXT_KEYS = {"password", "pwd", "secret", "token", "auth_token", "api_key", "private_key"}


@dataclass(frozen=True)
class ExportedBundle:
    """Pacote contendo o pipeline.yaml e layout.json exportados."""
    pipeline_yaml: str
    layout_json: str
    pipeline_id: str


class PipelineExporter:
    """Exportador desacoplado para arquivos declarativos e de layout."""

    def export(
        self,
        draft_or_version: Any,
        layout: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None
    ) -> ExportedBundle:
        """Exporta um PipelineDraft ou PipelineVersion para o bundle desacoplado."""
        if isinstance(draft_or_version, PipelineDraft):
            return self._export_from_draft(draft_or_version, layout or {}, tags)
        elif isinstance(draft_or_version, PipelineVersion):
            return self._export_from_version(draft_or_version, layout or {}, tags)
        elif isinstance(draft_or_version, dict):
            return self._export_from_dict(draft_or_version, layout or {}, tags)
        else:
            raise DomainValidationError(f"Tipo não suportado para exportação: {type(draft_or_version)}")

    def _export_from_draft(
        self,
        draft: PipelineDraft,
        layout: Dict[str, Any],
        tags: Optional[List[str]] = None
    ) -> ExportedBundle:
        canonical = draft.to_canonical_dict()
        return self._build_bundle(
            pipeline_id=draft.id,
            name=draft.name,
            description=draft.description,
            parameters=draft.parameters,
            spec_nodes=canonical.get("spec", {}).get("nodes", []),
            spec_edges=canonical.get("spec", {}).get("edges", []),
            layout_dict=layout,
            tags=tags
        )

    def _export_from_version(
        self,
        version: PipelineVersion,
        layout: Dict[str, Any],
        tags: Optional[List[str]] = None
    ) -> ExportedBundle:
        imm = version.immutable_definition
        meta = imm.get("metadata", {})
        spec = imm.get("spec", {})
        return self._build_bundle(
            pipeline_id=version.pipeline_id,
            name=meta.get("name", version.pipeline_id),
            description=meta.get("description", ""),
            parameters=spec.get("parameters", {}),
            spec_nodes=spec.get("nodes", []),
            spec_edges=spec.get("edges", []),
            layout_dict=layout,
            tags=tags or meta.get("tags")
        )

    def _export_from_dict(
        self,
        data: Dict[str, Any],
        layout: Dict[str, Any],
        tags: Optional[List[str]] = None
    ) -> ExportedBundle:
        meta = data.get("metadata", {})
        spec = data.get("spec", {})
        return self._build_bundle(
            pipeline_id=meta.get("id", data.get("id", "pipeline")),
            name=meta.get("name", data.get("name", "pipeline")),
            description=meta.get("description", data.get("description", "")),
            parameters=spec.get("parameters", {}),
            spec_nodes=spec.get("nodes", []),
            spec_edges=spec.get("edges", []),
            layout_dict=layout,
            tags=tags or meta.get("tags")
        )

    def _build_bundle(
        self,
        pipeline_id: str,
        name: str,
        description: Optional[str],
        parameters: Any,
        spec_nodes: List[Dict[str, Any]],
        spec_edges: List[Dict[str, Any]],
        layout_dict: Dict[str, Any],
        tags: Optional[List[str]] = None
    ) -> ExportedBundle:
        # Sanitização do ID para conformidade com ^[a-z0-9-]+$
        normalized_id = re.sub(r"[^a-z0-9-]", "-", pipeline_id.lower()).strip("-")
        if not normalized_id:
            normalized_id = "pipeline-1"

        # Valida ausência de segredos nas configurações dos nós
        self._validate_no_plaintext_secrets(spec_nodes)

        # Formata nós para o contrato pipeline.schema.json
        nodes_out = []
        for n in spec_nodes:
            comp = n.get("component", {})
            nodes_out.append({
                "id": n["id"],
                "component": {
                    "type": comp.get("type", "generic"),
                    "version": comp.get("version", "1.0.0")
                },
                "config": n.get("config", {})
            })

        # Formata arestas para o contrato
        edges_out = []
        for e in spec_edges:
            edge_item = {
                "id": e.get("id", f"{e['from']}->{e['to']}"),
                "from": e["from"],
                "to": e["to"]
            }
            edges_out.append(edge_item)

        # 1. Constrói pipeline.yaml
        pipeline_dict: Dict[str, Any] = {
            "schemaVersion": "rdf.pipeline/v1",
            "kind": "Pipeline",
            "metadata": {
                "id": normalized_id,
                "name": name or "Unnamed Pipeline"
            },
            "spec": {
                "nodes": nodes_out,
                "edges": edges_out
            }
        }
        if description:
            pipeline_dict["metadata"]["description"] = description
        if tags:
            pipeline_dict["metadata"]["tags"] = tags

        # Converte parâmetros se existirem
        if isinstance(parameters, list) and parameters:
            pipeline_dict["spec"]["parameters"] = parameters
        elif isinstance(parameters, dict) and parameters:
            param_list = []
            for p_name, p_val in parameters.items():
                param_list.append({
                    "name": p_name,
                    "type": "string" if isinstance(p_val, str) else "int",
                    "default": p_val
                })
            pipeline_dict["spec"]["parameters"] = param_list

        pipeline_yaml_str = yaml.safe_dump(pipeline_dict, sort_keys=False, allow_unicode=True)

        # 2. Constrói layout.json em conformidade com layout.schema.json
        raw_viewport = layout_dict.get("viewport", {})
        viewport = {
            "x": float(raw_viewport.get("x", 0.0)),
            "y": float(raw_viewport.get("y", 0.0)),
            "zoom": float(raw_viewport.get("zoom", 1.0))
        }
        # Zoom constraint: 0.1 <= zoom <= 5.0
        viewport["zoom"] = max(0.1, min(5.0, viewport["zoom"]))

        existing_layout_nodes = {n["id"]: n for n in layout_dict.get("nodes", []) if "id" in n}
        layout_nodes = []

        for idx, n in enumerate(nodes_out):
            nid = n["id"]
            if nid in existing_layout_nodes:
                orig = existing_layout_nodes[nid]
                pos = orig.get("position", {})
                layout_node = {
                    "id": nid,
                    "position": {
                        "x": float(pos.get("x", idx * 250.0)),
                        "y": float(pos.get("y", 100.0))
                    }
                }
                if "width" in orig:
                    layout_node["width"] = float(orig["width"])
                if "height" in orig:
                    layout_node["height"] = float(orig["height"])
                if "selected" in orig:
                    layout_node["selected"] = bool(orig["selected"])
                if "customLabel" in orig:
                    layout_node["customLabel"] = str(orig["customLabel"])
                if "notes" in orig:
                    layout_node["notes"] = str(orig["notes"])
                layout_nodes.append(layout_node)
            else:
                layout_nodes.append({
                    "id": nid,
                    "position": {
                        "x": float(idx * 250.0),
                        "y": 100.0
                    }
                })

        layout_obj: Dict[str, Any] = {
            "schemaVersion": "rdf.layout/v1",
            "kind": "Layout",
            "metadata": {
                "pipelineId": normalized_id
            },
            "viewport": viewport,
            "nodes": layout_nodes
        }

        if "groups" in layout_dict and isinstance(layout_dict["groups"], list):
            layout_obj["groups"] = layout_dict["groups"]

        layout_json_str = json.dumps(layout_obj, indent=2, ensure_ascii=False)

        return ExportedBundle(
            pipeline_yaml=pipeline_yaml_str,
            layout_json=layout_json_str,
            pipeline_id=normalized_id
        )

    def _validate_no_plaintext_secrets(self, nodes: List[Dict[str, Any]]) -> None:
        """Verifica se alguma chave sensível foi definida em texto puro nos nós."""
        for n in nodes:
            cfg = n.get("config", {})
            for k in cfg.keys():
                if k.lower() in FORBIDDEN_PLAINTEXT_KEYS:
                    raise SecurityViolationError(
                        f"Violação de segurança na exportação: nó '{n.get('id')}' contém chave sensível '{k}' em texto puro."
                    )
