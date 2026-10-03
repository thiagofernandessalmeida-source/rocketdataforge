"""Testes unitários para a instrumentação de Telemetria OpenTelemetry (TASK-025)."""

import pytest

from src.core.infrastructure.telemetry.otel_setup import (
    clear_in_memory_telemetry,
    execution_span,
    get_in_memory_spans,
    record_node_metrics,
    setup_telemetry,
)


@pytest.fixture(autouse=True)
def init_telemetry():
    setup_telemetry(service_name="TestRocketDataForge", in_memory=True)
    clear_in_memory_telemetry()
    yield
    clear_in_memory_telemetry()


def test_telemetry_creates_spans_with_canonical_attributes():
    execution_id = "exec-otel-001"
    correlation_id = "corr-otel-001"
    node_id = "node_filter_active"

    with execution_span(
        name="test_operator_span",
        execution_id=execution_id,
        correlation_id=correlation_id,
        node_id=node_id,
        attributes={"custom_tag": "slice_001"}
    ):
        pass

    spans = get_in_memory_spans()
    assert len(spans) == 1
    span = spans[0]

    assert span.name == "test_operator_span"
    assert span.attributes["rdf.execution_id"] == execution_id
    assert span.attributes["rdf.correlation_id"] == correlation_id
    assert span.attributes["rdf.node_id"] == node_id
    assert span.attributes["custom_tag"] == "slice_001"
    assert span.status.is_ok


def test_telemetry_records_exception_on_failure():
    execution_id = "exec-otel-err"
    correlation_id = "corr-otel-err"

    with pytest.raises(RuntimeError, match="Simulated execution error"):
        with execution_span("failing_span", execution_id, correlation_id):
            raise RuntimeError("Simulated execution error")

    spans = get_in_memory_spans()
    assert len(spans) == 1
    span = spans[0]
    assert not span.status.is_ok


def test_telemetry_records_node_metrics():
    # Não deve lançar exceção
    record_node_metrics(
        execution_id="exec-001",
        node_id="src_csv",
        rows_in=1000,
        rows_out=1000,
        rejected=0,
        duration_ms=45
    )
    record_node_metrics(
        execution_id="exec-001",
        node_id="filter_active",
        rows_in=1000,
        rows_out=800,
        rejected=200,
        duration_ms=25
    )
