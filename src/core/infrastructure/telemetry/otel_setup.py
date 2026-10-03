"""Configuração e Instrumentação de Telemetria com OpenTelemetry (TASK-025).

Fornece emissão padronizada de traces, spans com injeção automática de
execution_id e correlation_id, além de métricas operacionais e logs correlacionados.
"""

from contextlib import contextmanager
import logging
from typing import Any, Dict, Generator, Optional

from opentelemetry import metrics, trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Span, StatusCode

logger = logging.getLogger(__name__)

# Singletons globais
_tracer_provider: Optional[TracerProvider] = None
_span_exporter: Optional[InMemorySpanExporter] = None
_meter_provider: Optional[MeterProvider] = None
_metric_reader: Optional[InMemoryMetricReader] = None

# Métricas globais
_rows_in_counter = None
_rows_out_counter = None
_rejected_counter = None
_execution_duration_hist = None


def setup_telemetry(
    service_name: str = "RocketDataForge",
    in_memory: bool = True
) -> None:
    """Inicializa os provedores globais de Tracer e Meter do OpenTelemetry de forma idempotente."""
    global _tracer_provider, _span_exporter, _meter_provider, _metric_reader
    global _rows_in_counter, _rows_out_counter, _rejected_counter, _execution_duration_hist

    if _tracer_provider is not None:
        return

    resource = Resource.create({
        "service.name": service_name,
        "service.version": "1.0.0"
    })

    # Tracer Setup
    _tracer_provider = TracerProvider(resource=resource)
    if in_memory:
        _span_exporter = InMemorySpanExporter()
        _tracer_provider.add_span_processor(SimpleSpanProcessor(_span_exporter))
    trace.set_tracer_provider(_tracer_provider)

    # Meter Setup
    _metric_reader = InMemoryMetricReader()
    _meter_provider = MeterProvider(resource=resource, metric_readers=[_metric_reader])
    metrics.set_meter_provider(_meter_provider)

    meter = metrics.get_meter(service_name)
    _rows_in_counter = meter.create_counter(
        name="rdf.rows.in",
        description="Total de linhas lidas pelos operadores",
        unit="rows"
    )
    _rows_out_counter = meter.create_counter(
        name="rdf.rows.out",
        description="Total de linhas emitidas pelos operadores",
        unit="rows"
    )
    _rejected_counter = meter.create_counter(
        name="rdf.rows.rejected",
        description="Total de linhas rejeitadas pelos filtros",
        unit="rows"
    )
    _execution_duration_hist = meter.create_histogram(
        name="rdf.execution.duration",
        description="Duração da execução em milissegundos",
        unit="ms"
    )


def get_tracer(name: str = "RocketDataForge"):
    """Retorna o tracer configurado."""
    return trace.get_tracer(name)


def get_in_memory_spans():
    """Retorna todos os spans capturados pelo exportador em memória (útil para testes)."""
    if _span_exporter is not None:
        return _span_exporter.get_finished_spans()
    return []


def clear_in_memory_telemetry() -> None:
    """Limpa os spans e métricas em memória."""
    if _span_exporter is not None:
        _span_exporter.clear()


@contextmanager
def execution_span(
    name: str,
    execution_id: str,
    correlation_id: str,
    node_id: Optional[str] = None,
    attributes: Optional[Dict[str, Any]] = None
) -> Generator[Span, None, None]:
    """Context manager para criar spans com atributos canônicos de observabilidade."""
    tracer = get_tracer()
    attrs = {
        "rdf.execution_id": execution_id,
        "rdf.correlation_id": correlation_id,
        **(attributes or {})
    }
    if node_id:
        attrs["rdf.node_id"] = node_id

    with tracer.start_as_current_span(name, attributes=attrs) as span:
        try:
            yield span
            span.set_status(StatusCode.OK)
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise


def record_node_metrics(
    execution_id: str,
    node_id: str,
    rows_in: int = 0,
    rows_out: int = 0,
    rejected: int = 0,
    duration_ms: Optional[int] = None
) -> None:
    """Registra métricas atômicas associadas a um nó de execução."""
    attrs = {
        "execution_id": execution_id,
        "node_id": node_id
    }
    if _rows_in_counter and rows_in > 0:
        _rows_in_counter.add(rows_in, attrs)
    if _rows_out_counter and rows_out > 0:
        _rows_out_counter.add(rows_out, attrs)
    if _rejected_counter and rejected > 0:
        _rejected_counter.add(rejected, attrs)
    if _execution_duration_hist and duration_ms is not None:
        _execution_duration_hist.record(duration_ms, attrs)
