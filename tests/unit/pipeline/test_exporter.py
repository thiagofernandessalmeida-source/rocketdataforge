"""Testes unitários para o PipelineExporter (TASK-024)."""

import json
import os
import jsonschema
import pytest
import yaml

from src.core.application.pipeline.exporter import PipelineExporter
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.domain.shared.types import PortId, SemanticVersion

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "../../../specs/001-vertical-slice/contracts")
PIPELINE_SCHEMA_PATH = os.path.abspath(os.path.join(SCHEMA_DIR, "pipeline.schema.json"))
LAYOUT_SCHEMA_PATH = os.path.abspath(os.path.join(SCHEMA_DIR, "layout.schema.json"))


@pytest.fixture
def schemas():
    with open(PIPELINE_SCHEMA_PATH, "r", encoding="utf-8") as f:
        pipeline_schema = json.load(f)
    with open(LAYOUT_SCHEMA_PATH, "r", encoding="utf-8") as f:
        layout_schema = json.load(f)
    return pipeline_schema, layout_schema


def test_exporter_generates_valid_bundle_against_schemas(schemas):
    pipeline_schema, layout_schema = schemas

    draft = PipelineDraft(id="etl-sales-v1", project_id="proj-100", name="ETL Sales")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src_csv", "core.file.source", ver, {"path": "data/sales.csv", "format": "csv"})
    draft.add_node("sink_pq", "core.file.target", ver, {"path": "out/sales.parquet", "format": "parquet"})
    draft.connect_ports(PortId("src_csv", "main"), PortId("sink_pq", "input"))

    layout = {
        "viewport": {"x": 10.0, "y": 20.0, "zoom": 1.5},
        "nodes": [
            {"id": "src_csv", "position": {"x": 50.0, "y": 100.0}, "customLabel": "Fonte CSV"},
            {"id": "sink_pq", "position": {"x": 300.0, "y": 100.0}}
        ]
    }

    exporter = PipelineExporter()
    bundle = exporter.export(draft, layout)

    assert bundle.pipeline_id == "etl-sales-v1"
    assert "schemaVersion: rdf.pipeline/v1" in bundle.pipeline_yaml
    assert "schemaVersion\": \"rdf.layout/v1" in bundle.layout_json

    # 1. Valida pipeline.yaml contra pipeline.schema.json
    parsed_yaml = yaml.safe_load(bundle.pipeline_yaml)
    jsonschema.validate(instance=parsed_yaml, schema=pipeline_schema)

    # 2. Valida layout.json contra layout.schema.json
    parsed_layout = json.loads(bundle.layout_json)
    jsonschema.validate(instance=parsed_layout, schema=layout_schema)


def test_exporter_rejects_plaintext_secret_in_node_config():
    draft = PipelineDraft(id="insecure-pipe", project_id="proj-100", name="Insecure")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("db_src", "core.database.source", ver, {
        "query": "SELECT 1",
        "password": "plain_text_password_leaked!"
    })

    exporter = PipelineExporter()
    with pytest.raises(SecurityViolationError, match="Violação de segurança na exportação"):
        exporter.export(draft, {})


def test_exporter_clamps_zoom_and_provides_defaults(schemas):
    pipeline_schema, layout_schema = schemas

    draft = PipelineDraft(id="default-layout", project_id="proj-100", name="Default Layout")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("node_a", "core.filter", ver, {"predicate": "x > 10"})

    # Viewport sem zoom e zoom fora dos limites (ex: 15.0)
    layout = {"viewport": {"x": 0.0, "y": 0.0, "zoom": 15.0}}

    exporter = PipelineExporter()
    bundle = exporter.export(draft, layout)

    parsed_layout = json.loads(bundle.layout_json)
    # Deve ter sido limitado em 5.0 (máximo permitido)
    assert parsed_layout["viewport"]["zoom"] == 5.0
    assert len(parsed_layout["nodes"]) == 1
    assert parsed_layout["nodes"][0]["id"] == "node_a"

    jsonschema.validate(instance=parsed_layout, schema=layout_schema)
