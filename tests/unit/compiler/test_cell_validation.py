"""Testes unitários de validação macro de Canvas-Cells e prevenção de ciclos globais."""

import pytest
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.pipeline.draft import PipelineDraft
from src.core.domain.shared.types import PortId, SemanticVersion


def test_validate_cells_linear_acyclic():
    """Valida ordenação macro acíclica de canvas-cells (ex: cell-01 -> cell-02 -> cell-03)."""
    validator = GraphValidator()
    cells = [
        {
            "id": "canvas-cell-01",
            "name": "canvas-cell-01",
            "order": 1,
            "preconditions": []
        },
        {
            "id": "canvas-cell-02",
            "name": "canvas-cell-02",
            "order": 2,
            "preconditions": [
                {"target_cell_id": "canvas-cell-01", "expected_status": "OK"}
            ]
        },
        {
            "id": "canvas-cell-03",
            "name": "canvas-cell-03",
            "order": 3,
            "preconditions": [
                {"target_cell_id": "canvas-cell-02", "expected_status": "OK"}
            ]
        }
    ]

    errors, order = validator.validate_cell_topology(cells)
    assert len(errors) == 0
    assert order == ["canvas-cell-01", "canvas-cell-02", "canvas-cell-03"]


def test_validate_cells_detect_global_cycle():
    """Valida rejeição de dependências circulares entre células (Célula A -> B e B -> A)."""
    validator = GraphValidator()
    cells = [
        {
            "id": "cell-extract",
            "name": "Extract",
            "preconditions": [
                {"target_cell_id": "cell-load", "expected_status": "OK"}
            ]
        },
        {
            "id": "cell-transform",
            "name": "Transform",
            "preconditions": [
                {"target_cell_id": "cell-extract", "expected_status": "OK"}
            ]
        },
        {
            "id": "cell-load",
            "name": "Load",
            "preconditions": [
                {"target_cell_id": "cell-transform", "expected_status": "OK"}
            ]
        }
    ]

    errors, order = validator.validate_cell_topology(cells)
    assert len(errors) > 0
    assert any(err.code == "ERR_CYCLIC_CELL_DEPENDENCY" for err in errors)


def test_validate_cells_self_cycle():
    """Valida rejeição de auto-dependência (Célula A depende de Célula A)."""
    validator = GraphValidator()
    cells = [
        {
            "id": "canvas-cell-01",
            "name": "canvas-cell-01",
            "preconditions": [
                {"target_cell_id": "canvas-cell-01", "expected_status": "OK"}
            ]
        }
    ]

    errors, _ = validator.validate_cell_topology(cells)
    assert len(errors) > 0
    assert any(err.code == "ERR_CYCLIC_CELL_DEPENDENCY" for err in errors)


def test_validate_cells_invalid_reference():
    """Valida rejeição quando pré-condição referencia célula inexistente."""
    validator = GraphValidator()
    cells = [
        {
            "id": "canvas-cell-02",
            "name": "canvas-cell-02",
            "preconditions": [
                {"target_cell_id": "canvas-cell-99-nonexistent", "expected_status": "OK"}
            ]
        }
    ]

    errors, _ = validator.validate_cell_topology(cells)
    assert len(errors) > 0
    assert any(err.code == "ERR_INVALID_CELL_REFERENCE" for err in errors)


def test_validate_pipeline_draft_with_cells():
    """Valida PipelineDraft contendo nodes e cells com GraphValidator.validate."""
    draft = PipelineDraft(id="p1", project_id="pr1", name="Multi-Canvas Job")
    ver = SemanticVersion(1, 0, 0)
    draft.add_node("source1", "core.file.source", ver)
    draft.add_node("sink1", "core.file.target", ver)
    draft.connect_ports(PortId("source1", "main"), PortId("sink1", "input"))

    draft.cells = [
        {
            "id": "canvas-cell-01",
            "name": "Extract Raw",
            "order": 1,
            "preconditions": []
        },
        {
            "id": "canvas-cell-02",
            "name": "Transform Staging",
            "order": 2,
            "preconditions": [
                {"target_cell_id": "canvas-cell-01", "expected_status": "OK"}
            ]
        }
    ]

    validator = GraphValidator()
    report = validator.validate(draft)

    assert report.is_valid
    assert len(report.errors) == 0
    assert report.cell_topological_order == ["canvas-cell-01", "canvas-cell-02"]


def test_validate_cells_same_order_interdependency_rejected():
    """Valida que células com mesma ordem de execução não podem ter interdependência (quebra de paralelismo)."""
    validator = GraphValidator()
    cells = [
        {
            "id": "cell-a",
            "name": "Cell A",
            "order": 1,
            "preconditions": []
        },
        {
            "id": "cell-b",
            "name": "Cell B",
            "order": 1,  # Mesma ordem!
            "preconditions": [
                {"target_cell_id": "cell-a", "expected_status": "OK"}
            ]
        }
    ]

    errors, _ = validator.validate_cell_topology(cells)
    assert len(errors) > 0
    assert any(err.code == "ERR_PARALLEL_CELL_INTERDEPENDENCY" for err in errors)


def test_validate_cells_reverse_order_dependency_rejected():
    """Valida que uma célula não pode depender de uma célula com ordem posterior."""
    validator = GraphValidator()
    cells = [
        {
            "id": "cell-early",
            "name": "Cell Early",
            "order": 1,
            "preconditions": [
                {"target_cell_id": "cell-late", "expected_status": "OK"}
            ]
        },
        {
            "id": "cell-late",
            "name": "Cell Late",
            "order": 2,
            "preconditions": []
        }
    ]

    errors, _ = validator.validate_cell_topology(cells)
    assert len(errors) > 0
    assert any(err.code == "ERR_INVALID_ORDER_DEPENDENCY" for err in errors)

