import pytest
import polars as pl
from unittest.mock import MagicMock
from src.core.application.compiler.logical_planner import resolve_tmap_main_input
from src.core.domain.shared.exceptions import DomainError
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_resolve_tmap_main_input_valid():
    """main_input_id apontando para nó conectado e não-lookup é preservado sem warnings."""
    cfg = {
        "main_input_id": "postgres_source_1",
        "lookups": [{"node_id": "oracle_source_1"}]
    }
    input_ids = ["postgres_source_1", "oracle_source_1"]
    warnings = []

    res = resolve_tmap_main_input(cfg, input_ids, node_id="mapper_1", warning_fn=lambda lvl, msg: warnings.append(msg))
    assert res == "postgres_source_1"
    assert len(warnings) == 0


def test_resolve_tmap_main_input_nonexistent_node():
    """main_input_id apontando para nó inexistente é substituído pela primeira entrada não-lookup com aviso."""
    cfg = {
        "main_input_id": "csv_source_1",  # nó desatualizado que não existe na célula
        "lookups": [{"node_id": "oracle_source_1"}]
    }
    input_ids = ["postgres_source_3", "oracle_source_1"]
    warnings = []

    res = resolve_tmap_main_input(cfg, input_ids, node_id="data_mapper_1", warning_fn=lambda lvl, msg: warnings.append(msg))
    assert res == "postgres_source_3"
    assert len(warnings) == 1
    assert "csv_source_1" in warnings[0]
    assert "postgres_source_3" in warnings[0]


def test_resolve_tmap_main_input_pointing_to_lookup():
    """main_input_id apontando para um lookup conectado não é aceito como main; ajusta para o fluxo real."""
    cfg = {
        "main_input_id": "oracle_source_1",  # nó configurado como lookup
        "lookups": [{"node_id": "oracle_source_1"}]
    }
    input_ids = ["oracle_source_1", "postgres_source_2"]
    warnings = []

    res = resolve_tmap_main_input(cfg, input_ids, node_id="data_mapper_1", warning_fn=lambda lvl, msg: warnings.append(msg))
    assert res == "postgres_source_2"
    assert len(warnings) == 1
    assert "oracle_source_1" in warnings[0]
    assert "postgres_source_2" in warnings[0]


def test_worker_tmap_missing_inputs_raises_error():
    """worker falha com erro canônico se tMap não possuir nenhum input_id conectado."""
    worker = ExecutionWorker()
    phys_op = MagicMock()
    phys_op.id = "data_mapper_1"
    phys_op.input_ids = []

    task = MagicMock()
    token = MagicMock()
    node_buffers = {}

    with pytest.raises(DomainError) as excinfo:
        worker._execute_tmap_node(phys_op, {}, token, task, node_buffers)

    assert excinfo.value.code == "ERR_TMAP_MISSING_MAIN_STREAM"


def test_worker_tmap_empty_buffer_raises_error():
    """worker falha com erro canônico se o fluxo principal não tiver produzido nenhum buffer."""
    worker = ExecutionWorker()
    phys_op = MagicMock()
    phys_op.id = "data_mapper_1"
    phys_op.input_ids = ["source_1"]

    task = MagicMock()
    token = MagicMock()
    node_buffers = {"source_1": []}  # buffer vazio

    with pytest.raises(DomainError) as excinfo:
        worker._execute_tmap_node(phys_op, {"main_input_id": "source_1"}, token, task, node_buffers)

    assert excinfo.value.code == "ERR_TMAP_EMPTY_MAIN_STREAM"
