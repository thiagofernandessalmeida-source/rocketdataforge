"""Testes unitários do agregado PipelineVersion e cálculo determinístico de hash."""

from dataclasses import FrozenInstanceError
import pytest
from src.core.domain.pipeline.hasher import compute_canonical_hash
from src.core.domain.pipeline.version import PipelineVersion


def test_deterministic_hash_independent_of_key_order():
    dict1 = {
        "b": 2,
        "a": 1,
        "nested": {"z": "last", "m": "middle"}
    }
    dict2 = {
        "a": 1,
        "nested": {"m": "middle", "z": "last"},
        "b": 2
    }

    hash1 = compute_canonical_hash(dict1)
    hash2 = compute_canonical_hash(dict2)

    assert hash1 == hash2
    assert len(hash1) == 64


def test_publish_pipeline_version_success():
    canonical_def = {
        "schemaVersion": "rdf.pipeline/v1",
        "kind": "Pipeline",
        "metadata": {"id": "p1", "name": "Test"},
        "spec": {"nodes": [], "edges": []}
    }

    version = PipelineVersion.publish(
        pipeline_id="p1",
        version_tag="1.0.0",
        canonical_definition=canonical_def,
        published_by="engineer@rocketdataforge.org"
    )

    assert version.pipeline_id == "p1"
    assert version.version_tag == "1.0.0"
    assert version.schema_version == "rdf.pipeline/v1"
    assert len(version.definition_hash) == 64
    assert version.published_by == "engineer@rocketdataforge.org"
    assert version.published_at is not None


def test_pipeline_version_immutability():
    canonical_def = {"spec": {}}
    version = PipelineVersion.publish("p1", "1.0.0", canonical_def, "user")

    # Tentativa de modificar atributos deve falhar por ser frozen dataclass
    with pytest.raises((FrozenInstanceError, AttributeError)):
        version.version_tag = "2.0.0"  # type: ignore
