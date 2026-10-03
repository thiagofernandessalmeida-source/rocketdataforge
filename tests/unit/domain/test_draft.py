"""Testes unitários do agregado PipelineDraft."""

import pytest
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.domain.shared.types import PortId, SemanticVersion


def test_create_pipeline_draft():
    draft = PipelineDraft(
        id="pipe-01",
        project_id="proj-01",
        name="Pipeline Ingestão Clientes"
    )
    assert draft.id == "pipe-01"
    assert draft.project_id == "proj-01"
    assert draft.name == "Pipeline Ingestão Clientes"
    assert draft.revision == 1
    assert len(draft.nodes) == 0
    assert len(draft.edges) == 0


def test_add_nodes_and_uniqueness():
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="Pipeline Test")
    version = SemanticVersion(1, 0, 0)

    draft.add_node("source", "core.file.source", version, {"path": "data.csv"})
    assert "source" in draft.nodes
    assert draft.revision == 2

    # Nó duplicado deve falhar
    with pytest.raises(DomainValidationError):
        draft.add_node("source", "core.file.source", version, {})


def test_connect_ports_and_cardinality():
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="Pipeline Test")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("source", "core.file.source", ver)
    draft.add_node("filter", "core.filter", ver)
    draft.add_node("target", "core.file.target", ver)

    # Conexão válida: source.main -> filter.input
    edge1 = draft.connect_ports(PortId("source", "main"), PortId("filter", "input"))
    assert edge1.id in draft.edges

    # Outro nó tentando conectar na mesma porta de entrada do filter deve falhar
    with pytest.raises(DomainValidationError):
        draft.connect_ports(PortId("target", "main"), PortId("filter", "input"))


def test_self_connection_fails():
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="Pipeline Test")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("filter", "core.filter", ver)

    with pytest.raises(DomainValidationError):
        draft.connect_ports(PortId("filter", "out"), PortId("filter", "in"))


def test_remove_node_cascades_edges():
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="Pipeline Test")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("source", "core.file.source", ver)
    draft.add_node("filter", "core.filter", ver)
    draft.connect_ports(PortId("source", "main"), PortId("filter", "input"))
    assert len(draft.edges) == 1

    # Ao remover o source, a aresta deve ser removida automaticamente
    draft.remove_node("source")
    assert "source" not in draft.nodes
    assert len(draft.edges) == 0


def test_to_canonical_dict_structure():
    draft = PipelineDraft(id="pipe-01", project_id="proj-01", name="Pipeline Test")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("node_b", "core.filter", ver, {"expr": "x > 10"})
    draft.add_node("node_a", "core.file.source", ver, {"path": "a.csv"})
    draft.connect_ports(PortId("node_a", "main"), PortId("node_b", "input"))

    canonical = draft.to_canonical_dict()
    assert canonical["schemaVersion"] == "rdf.pipeline/v1"
    assert canonical["kind"] == "Pipeline"
    assert canonical["metadata"]["id"] == "pipe-01"

    # Confirma ordenação alfabética determinística dos nós
    node_ids = [n["id"] for n in canonical["spec"]["nodes"]]
    assert node_ids == ["node_a", "node_b"]

    # Garante ausência total de atributos de layout visual (x, y, zoom)
    assert "layout" not in canonical
    assert "viewport" not in canonical
