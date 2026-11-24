"""Testes de validação estática de compilação para nós Sink / Target (Regra 1: ERR_SINK_KEYS_REQUIRED)."""

import pytest
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion


def test_validator_fails_when_sink_update_without_keys():
    """Garante que o validador em tempo de compilação acusa erro ERR_SINK_KEYS_REQUIRED para update sem chaves."""
    validator = GraphValidator()
    ver = SemanticVersion(1, 0, 0)
    draft = PipelineDraft(id="p1", project_id="pr1", name="Test Sink Keys")

    draft.add_node("src_1", "core.file.source", ver, config={"path": "data.csv"})
    draft.add_node(
        "pg_sink",
        "connector.db.postgresql.output",
        ver,
        config={
            "table": "public.dest",
            "data_action": "update",
            "use_field_options": True,
            "field_options": [
                {"column": "id", "update_key": False, "updatable": True, "insertable": True}
            ]
        }
    )
    draft.connect_ports(PortId("src_1", "main"), PortId("pg_sink", "input"))

    report = validator.validate(draft)

    assert not report.is_valid
    err_codes = [e.code for e in report.errors]
    assert "ERR_SINK_KEYS_REQUIRED" in err_codes
    sink_err = next(e for e in report.errors if e.code == "ERR_SINK_KEYS_REQUIRED")
    assert "pg_sink" in sink_err.message
    assert "Update Key" in sink_err.message


def test_validator_fails_when_sink_delete_without_keys():
    """Garante que o validador acusa erro para delete sem deletion_key."""
    validator = GraphValidator()
    ver = SemanticVersion(1, 0, 0)
    draft = PipelineDraft(id="p2", project_id="pr1", name="Test Delete Keys")

    draft.add_node("src_1", "core.file.source", ver, config={"path": "data.csv"})
    draft.add_node(
        "duck_sink",
        "connector.db.duckdb.output",
        ver,
        config={
            "table": "dest",
            "data_action": "delete",
            "keys": []
        }
    )
    draft.connect_ports(PortId("src_1", "main"), PortId("duck_sink", "input"))

    report = validator.validate(draft)

    assert not report.is_valid
    assert any(e.code == "ERR_SINK_KEYS_REQUIRED" for e in report.errors)


def test_validator_passes_when_sink_has_valid_keys():
    """Garante que a validação passa com sucesso quando chaves estão presentes."""
    validator = GraphValidator()
    ver = SemanticVersion(1, 0, 0)
    draft = PipelineDraft(id="p3", project_id="pr1", name="Test Valid Keys")

    draft.add_node("src_1", "core.file.source", ver, config={"path": "data.csv"})
    draft.add_node(
        "pg_sink",
        "connector.db.postgresql.output",
        ver,
        config={
            "table": "public.dest",
            "data_action": "update",
            "use_field_options": True,
            "field_options": [
                {"column": "id", "update_key": True, "updatable": False, "insertable": True}
            ]
        }
    )
    draft.connect_ports(PortId("src_1", "main"), PortId("pg_sink", "input"))

    report = validator.validate(draft)

    assert report.is_valid
    assert not any(e.code == "ERR_SINK_KEYS_REQUIRED" for e in report.errors)
