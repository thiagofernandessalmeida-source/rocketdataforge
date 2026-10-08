"""Testes unitários do GraphValidator."""

import pytest
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion


def test_validate_empty_pipeline():
    draft = PipelineDraft(id="p1", project_id="pr1", name="Empty")
    validator = GraphValidator()
    report = validator.validate(draft)

    assert not report.is_valid
    assert any(err.code == "ERR_EMPTY_PIPELINE" for err in report.errors)


def test_validate_acyclic_dag_ordering():
    draft = PipelineDraft(id="p1", project_id="pr1", name="Linear ETL")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("source", "core.file.source", ver)
    draft.add_node("filter", "core.filter", ver)
    draft.add_node("target", "core.file.target", ver)

    draft.connect_ports(PortId("source", "main"), PortId("filter", "input"))
    draft.connect_ports(PortId("filter", "main"), PortId("target", "input"))

    validator = GraphValidator()
    report = validator.validate(draft)

    assert report.is_valid
    assert len(report.errors) == 0
    assert report.topological_order == ["source", "filter", "target"]


def test_detect_cycle_and_reject():
    draft = PipelineDraft(id="p1", project_id="pr1", name="Cyclic Pipeline")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("node_a", "core.filter", ver)
    draft.add_node("node_b", "core.filter", ver)
    draft.add_node("node_c", "core.filter", ver)

    draft.connect_ports(PortId("node_a", "main"), PortId("node_b", "input"))
    draft.connect_ports(PortId("node_b", "main"), PortId("node_c", "input"))

    # Força a criação de ciclo inserindo manualmente a aresta de retorno C -> A
    from src.core.domain.pipeline.edge import Edge
    cycle_edge = Edge.create(PortId("node_c", "main"), PortId("node_a", "input"))
    draft.edges[cycle_edge.id] = cycle_edge

    validator = GraphValidator()
    report = validator.validate(draft)

    assert not report.is_valid
    assert any(err.code == "ERR_CYCLIC_DEPENDENCY" for err in report.errors)


def test_branching_and_joining_dag():
    draft = PipelineDraft(id="p1", project_id="pr1", name="Branching Pipeline")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src_customers", "core.file.source", ver)
    draft.add_node("src_orders", "core.file.source", ver)
    draft.add_node("join_node", "core.join", ver)
    draft.add_node("sink_dw", "core.database.target", ver)

    draft.connect_ports(PortId("src_customers", "main"), PortId("join_node", "left"))
    draft.connect_ports(PortId("src_orders", "main"), PortId("join_node", "right"))
    draft.connect_ports(PortId("join_node", "main"), PortId("sink_dw", "input"))

    validator = GraphValidator()
    report = validator.validate(draft)

    assert report.is_valid
    assert "sink_dw" == report.topological_order[-1]
    assert report.topological_order.index("join_node") > report.topological_order.index("src_customers")
    assert report.topological_order.index("join_node") > report.topological_order.index("src_orders")


def test_validate_component_hard_constraints():
    """Valida se ultrapassar o limite embutido (ex: max_batch_size) em componente derivado gera erro."""
    draft = PipelineDraft(id="p1", project_id="pr1", name="Custom Component Pipeline")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src", "core.file.source", ver)
    # mysql_agreements possui hard constraint max_batch_size = 1000
    draft.add_node("custom_sink", "connector.custom.mysql_agreements", ver, config={"batch_size": 2500, "table_name": "agreements", "connection_ref": "c1"})
    draft.connect_ports(PortId("src", "main"), PortId("custom_sink", "input"))

    validator = GraphValidator()
    report = validator.validate(draft)

    assert not report.is_valid
    assert any(err.code == "ERR_COMPONENT_CONSTRAINT_VIOLATION" for err in report.errors)
    err = next(e for e in report.errors if e.code == "ERR_COMPONENT_CONSTRAINT_VIOLATION")
    assert "excede o limite máximo permitido de 1000" in err.message


def test_validate_policy_mandatory_documentation_and_authorization():
    """Valida aplicação de regras ABAC na validação do pipeline (require_job_description, require_cell_description, forbidden connector)."""
    from src.core.domain.policy.policy_model import EffectEnum, PolicyDocument, PolicyStatement

    policy = PolicyDocument(
        principal="analyst_user",
        statements=[
            PolicyStatement(
                sid="EnforceDocumentation",
                effect=EffectEnum.ALLOW,
                actions=["connector:use", "pipeline:execute"],
                resources=["urn:rdf:connector:core.file.*"],
                conditions={"require_job_description": True, "require_cell_description": True}
            )
        ]
    )

    draft = PipelineDraft(
        id="p1",
        project_id="pr1",
        name="Doc Pipeline",
        description="",  # Vazio propositalmente para disparar violação
        cells=[{"id": "cell1", "description": ""}]
    )
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("src", "core.file.source", ver)
    # Scylla não está na lista de recursos autorizados (somente core.file.*)
    draft.add_node("sink_db", "connector.nosql.scylla.target", ver)
    draft.connect_ports(PortId("src", "main"), PortId("sink_db", "input"))

    validator = GraphValidator()
    report = validator.validate(draft, policy=policy)

    assert not report.is_valid
    codes = [e.code for e in report.errors]
    assert "ERR_POLICY_MISSING_JOB_DESCRIPTION" in codes
    assert "ERR_POLICY_MISSING_CELL_DESCRIPTION" in codes
    assert "ERR_POLICY_FORBIDDEN_CONNECTOR" in codes
