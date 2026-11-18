"""Testes unitários para execução física de nós Sink PostgreSQL e resolução de configurações."""

from unittest.mock import MagicMock, patch
import polars as pl
import pytest

from src.core.application.compiler.physical_planner import PhysicalOperator, PhysicalPlan
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.shared.exceptions import DomainValidationError
from src.core.infrastructure.execution.worker import ExecutionWorker


def test_postgres_sink_does_not_raise_unbound_raw_cfg(tmp_path):
    """Verifica se o nó sink PostgreSQL executa sem disparar UnboundLocalError para raw_cfg."""
    input_csv = tmp_path / "input.csv"
    df_sample = pl.DataFrame({
        "cd_pessoa": [1, 2, 3],
        "cpf": ["123", "456", "789"],
        "validacao_01": [1, 1, 0]
    })
    df_sample.write_csv(input_csv)

    worker = ExecutionWorker()

    plan = PhysicalPlan(
        pipeline_id="pipe-test-pg-sink",
        execution_order=["source_node", "postgres_sink_1"],
        operators={
            "source_node": PhysicalOperator(
                id="source_node",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(input_csv), "format": "csv"}
            ),
            "postgres_sink_1": PhysicalOperator(
                id="postgres_sink_1",
                operator_type="sink",
                engine="duckdb",
                input_ids=["source_node"],
                config={
                    "format": "postgres",
                    "target": "public.migra_1_atendentes",
                    "table_action": "create_if_not_exists",
                    "connection_ref": "odsdw",
                    "raw_config": {
                        "table": "public.migra_1_atendentes",
                        "target": "public.migra_1_atendentes",
                        "table_action": "create_if_not_exists",
                        "connection_ref": "odsdw"
                    },
                    "connection_details": {
                        "type": "postgresql",
                        "host": "localhost",
                        "port": 5432,
                        "database": "odsdw",
                        "username": "odsdw_user",
                        "password": "secret_password"
                    }
                }
            )
        }
    )

    execution = Execution(
        id="exec-pg-test-01",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-test-01"
    )

    with patch("src.core.infrastructure.connectors.postgres_connector.PostgresConnector.execute_write", return_value=3) as mock_write:
        res_exec = worker.run(execution, plan)

        assert res_exec.status == ExecutionStatus.SUCCEEDED
        assert mock_write.called
        call_kwargs = mock_write.call_args.kwargs
        assert call_kwargs["table_name"] == "public.migra_1_atendentes"
        assert call_kwargs["table_action"] == "create_if_not_exists"
        assert call_kwargs["df"].height == 3


def test_postgres_sink_forwards_schema_definitions_and_casts_types(tmp_path):
    """Garante que o worker repassa schema_definitions para o PostgresConnector e tipa o DataFrame."""
    input_csv = tmp_path / "input.csv"
    input_csv.write_text("cd_pessoa,cpf,validacao_01\n188559825,12345678910,0\n", encoding="utf-8")

    worker = ExecutionWorker()

    schema_defs = [
        {"name": "cd_pessoa", "type": "Integer"},
        {"name": "cpf", "type": "String"},
        {"name": "validacao_01", "type": "Integer"}
    ]

    plan = PhysicalPlan(
        pipeline_id="pipe-test-schema-forward",
        execution_order=["source_node", "postgres_sink_1"],
        operators={
            "source_node": PhysicalOperator(
                id="source_node",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(input_csv), "format": "csv"}
            ),
            "postgres_sink_1": PhysicalOperator(
                id="postgres_sink_1",
                operator_type="sink",
                engine="duckdb",
                input_ids=["source_node"],
                config={
                    "format": "postgres",
                    "target": "public.migra_1_atendentes",
                    "table_action": "create_if_not_exists",
                    "connection_ref": "odsdw",
                    "schema_definitions": schema_defs,
                    "raw_config": {
                        "table": "public.migra_1_atendentes",
                        "target": "public.migra_1_atendentes",
                        "table_action": "create_if_not_exists",
                        "connection_ref": "odsdw",
                        "schema_definitions": schema_defs
                    },
                    "connection_details": {
                        "type": "postgresql",
                        "host": "localhost",
                        "port": 5432,
                        "database": "odsdw",
                        "username": "odsdw_user",
                        "password": "secret_password"
                    }
                }
            )
        }
    )

    execution = Execution(
        id="exec-pg-test-schema",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-test-schema"
    )

    with patch("src.core.infrastructure.connectors.postgres_connector.PostgresConnector.execute_write", return_value=1) as mock_write:
        res_exec = worker.run(execution, plan)

        assert res_exec.status == ExecutionStatus.SUCCEEDED
        assert mock_write.called
        call_kwargs = mock_write.call_args.kwargs
        assert call_kwargs["table_name"] == "public.migra_1_atendentes"
        assert call_kwargs["table_action"] == "create_if_not_exists"
        assert call_kwargs["schema_definitions"] == schema_defs
        # DataFrame deve estar tipado conforme o schema
        out_df = call_kwargs["df"]
        assert out_df["cd_pessoa"].dtype == pl.Int32
        assert out_df["cpf"].dtype == pl.Utf8
        assert out_df["validacao_01"].dtype == pl.Int32


def test_postgres_sink_missing_connection_raises_domain_validation_error(tmp_path):
    """Valida se nó sink sem connection_ref nem connection_details dispara DomainValidationError claro."""
    input_csv = tmp_path / "input.csv"
    df_sample = pl.DataFrame({"id": [1]})
    df_sample.write_csv(input_csv)

    worker = ExecutionWorker()

    plan = PhysicalPlan(
        pipeline_id="pipe-test-missing-conn",
        execution_order=["src", "sink_err"],
        operators={
            "src": PhysicalOperator(
                id="src",
                operator_type="scan",
                engine="polars",
                input_ids=[],
                config={"source": str(input_csv), "format": "csv"}
            ),
            "sink_err": PhysicalOperator(
                id="sink_err",
                operator_type="sink",
                engine="duckdb",
                input_ids=["src"],
                config={
                    "format": "postgres",
                    "table": "minha_tabela"
                }
            )
        }
    )

    execution = Execution(
        id="exec-pg-err",
        pipeline_version_id="ver-1.0.0",
        correlation_id="corr-test-02"
    )

    res_exec = worker.run(execution, plan)
    assert res_exec.status == ExecutionStatus.FAILED
    assert res_exec.error_details is not None
    assert "Conexão PostgreSQL não configurada" in res_exec.error_details["message"]
