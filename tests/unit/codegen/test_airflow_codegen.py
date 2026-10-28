"""Testes unitários para o Gerador de DAGs do Apache Airflow (Fase 3 - Tarefa T-3.3).

Valida:
1. Geração de arquivo de DAG Python sintaticamente válido (ast.parse).
2. Definição correta do objeto DAG com schedule_interval, start_date, tags e default_args.
3. Criação de tarefas com PythonOperator para cada nó/célula do pipeline.
4. Respeito rigoroso à topologia do grafo gerando dependências bitshift (>>).
5. Conformidade com RNF-02: Garantia de ausência de credenciais em texto puro.
"""

import ast
import pytest

from src.core.application.codegen.airflow_generator import (
    AirflowDagBundle,
    AirflowGenerator,
    AirflowOptions,
)


def test_airflow_codegen_syntax_and_operators():
    """Valida sintaxe da DAG e geração de PythonOperators."""
    pipeline_def = {
        "metadata": {"name": "finance_reconciliation", "id": "dag_finance"},
        "spec": {
            "nodes": [
                {
                    "id": "source_csv",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {"path": "/opt/airflow/data/input.csv", "format": "csv"}
                },
                {
                    "id": "transform_tmap",
                    "component": {"type": "core.tmap", "version": "1.0.0"},
                    "config": {}
                },
                {
                    "id": "sink_parquet",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {"path": "/opt/airflow/data/output.parquet", "format": "parquet"}
                }
            ],
            "edges": [
                {"from": "source_csv.output", "to": "transform_tmap.input"},
                {"from": "transform_tmap.output", "to": "sink_parquet.input"}
            ]
        }
    }

    generator = AirflowGenerator()
    options = AirflowOptions(
        dag_id="daily_finance_reconciliation",
        schedule_interval="0 4 * * *",
        owner="data_engineering",
        retries=2,
        tags=["finance", "rocketdataforge"]
    )
    bundle: AirflowDagBundle = generator.generate(pipeline_def, options)

    assert isinstance(bundle, AirflowDagBundle)
    assert bundle.dag_py is not None
    assert bundle.dag_id == "daily_finance_reconciliation"

    # 1. Validação sintática AST
    parsed = ast.parse(bundle.dag_py)
    assert parsed is not None

    # 2. Imports essenciais
    assert "from airflow import DAG" in bundle.dag_py or "from airflow.models import DAG" in bundle.dag_py
    assert "from airflow.operators.python import PythonOperator" in bundle.dag_py
    assert "from datetime import datetime" in bundle.dag_py

    # 3. Definição da DAG
    assert "daily_finance_reconciliation" in bundle.dag_py
    assert "0 4 * * *" in bundle.dag_py
    assert "data_engineering" in bundle.dag_py

    # 4. Operadores e dependências bitshift
    assert "task_source_csv" in bundle.dag_py
    assert "task_transform_tmap" in bundle.dag_py
    assert "task_sink_parquet" in bundle.dag_py

    # Dependências encadeadas
    assert "task_source_csv >> task_transform_tmap" in bundle.dag_py
    assert "task_transform_tmap >> task_sink_parquet" in bundle.dag_py


def test_airflow_codegen_zero_plaintext_credentials():
    """Valida que credenciais em nós de banco utilizam os.getenv e não vazam no código da DAG."""
    pipeline_def = {
        "metadata": {"name": "db_sync", "id": "pipe_db"},
        "spec": {
            "nodes": [
                {
                    "id": "pg_orders",
                    "component": {"type": "core.postgres.source", "version": "1.0.0"},
                    "config": {
                        "host": "db.corp.net",
                        "username": "airflow_worker",
                        "password": "UltraSecretPassword999#",
                        "database": "sales"
                    }
                },
                {
                    "id": "dw_sink",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {"path": "/data/orders.parquet"}
                }
            ],
            "edges": [
                {"from": "pg_orders.output", "to": "dw_sink.input"}
            ]
        }
    }

    generator = AirflowGenerator()
    bundle = generator.generate(pipeline_def)

    assert "UltraSecretPassword999#" not in bundle.dag_py
    assert "os.getenv(" in bundle.dag_py
