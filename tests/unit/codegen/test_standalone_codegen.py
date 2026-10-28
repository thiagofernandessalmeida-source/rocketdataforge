"""Testes unitários para o Gerador de Código Autônomo Python (Fase 3 - Tarefa T-3.1).

Valida:
1. Geração de script Python executável via Jinja2 templates (DuckDB + Polars).
2. Validação sintática do código gerado (ast.parse).
3. Execução real do script gerado em subprocesso, processando CSV -> Parquet.
4. Aplicação de regras de Data Masking nativas diretamente no script autônomo.
5. Conformidade com RNF-02: Garantia de ausência de credenciais em texto puro (uso de os.getenv).
6. Geração de requirements.txt e arquivo de variáveis de ambiente de exemplo.
"""

import ast
import os
import subprocess
import sys
from pathlib import Path
import polars as pl
import pytest

from src.core.application.codegen.standalone_generator import (
    StandaloneCodeBundle,
    StandaloneGenerator,
)


def test_standalone_codegen_syntax_and_structure():
    """Valida que o código gerado é sintaticamente válido e possui estrutura esperada."""
    pipeline_def = {
        "metadata": {"name": "sample_etl_pipeline", "id": "pipe_001"},
        "spec": {
            "nodes": [
                {
                    "id": "node_source",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {
                        "path": "/data/input.csv",
                        "format": "csv",
                        "table": "raw_input"
                    }
                },
                {
                    "id": "node_target",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {
                        "path": "/data/output.parquet",
                        "format": "parquet"
                    }
                }
            ],
            "edges": [
                {"from": "node_source.output", "to": "node_target.input"}
            ]
        }
    }

    generator = StandaloneGenerator()
    bundle: StandaloneCodeBundle = generator.generate(pipeline_def)

    assert isinstance(bundle, StandaloneCodeBundle)
    assert bundle.script_py is not None
    assert bundle.requirements_txt is not None
    assert bundle.env_example is not None

    # Validação sintática via AST do Python
    parsed_ast = ast.parse(bundle.script_py)
    assert parsed_ast is not None

    # Verifica imports essenciais
    assert "import duckdb" in bundle.script_py
    assert "import polars" in bundle.script_py
    assert "def run_pipeline" in bundle.script_py
    assert 'if __name__ == "__main__":' in bundle.script_py

    # Verifica requirements
    assert "duckdb" in bundle.requirements_txt
    assert "polars" in bundle.requirements_txt


def test_standalone_codegen_execution_end_to_end(tmp_path):
    """Executa o script Python gerado em subprocesso real e valida saída em disco."""
    # 1. Cria CSV de entrada com dados sensíveis
    in_csv = tmp_path / "customers.csv"
    df_raw = pl.DataFrame({
        "id": [101, 102],
        "name": ["Alice Smith", "Bob Jones"],
        "email": ["alice.smith@corporation.com", "bob.jones@corporation.com"],
        "cpf": ["123.456.789-00", "987.654.321-99"]
    })
    df_raw.write_csv(in_csv)

    out_parquet = tmp_path / "customers_masked.parquet"

    # 2. Define o pipeline com regras de masking
    pipeline_def = {
        "metadata": {"name": "customers_anonymization", "id": "pipe_customers"},
        "spec": {
            "nodes": [
                {
                    "id": "read_customers",
                    "component": {"type": "core.file.source", "version": "1.0.0"},
                    "config": {
                        "path": str(in_csv).replace("\\", "/"),
                        "format": "csv",
                        "table": "raw_customers",
                        "schema": [
                            {"name": "id", "type": "Integer"},
                            {"name": "name", "type": "String"},
                            {"name": "email", "type": "String", "masking": "MASK_EMAIL"},
                            {"name": "cpf", "type": "String", "masking": "MASK_CPF_CNPJ"}
                        ]
                    }
                },
                {
                    "id": "write_customers",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {
                        "path": str(out_parquet).replace("\\", "/"),
                        "format": "parquet"
                    }
                }
            ],
            "edges": [
                {"from": "read_customers.output", "to": "write_customers.input"}
            ]
        }
    }

    # 3. Gera código autônomo
    generator = StandaloneGenerator()
    bundle = generator.generate(pipeline_def)

    script_path = tmp_path / "standalone_job.py"
    script_path.write_text(bundle.script_py, encoding="utf-8")

    # 4. Executa em subprocesso isolado
    run_res = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        timeout=15
    )

    assert run_res.returncode == 0, f"Erro ao executar script gerado:\nSTDOUT: {run_res.stdout}\nSTDERR: {run_res.stderr}"

    # 5. Valida que o parquet gerado contém dados anonimizados
    assert out_parquet.exists(), "Arquivo Parquet alvo não foi gerado pelo script."
    df_result = pl.read_parquet(out_parquet)

    assert len(df_result) == 2
    assert df_result["name"][0] == "Alice Smith"
    assert df_result["email"][0] == "a***@corporation.com"
    assert df_result["email"][1] == "b***@corporation.com"
    assert df_result["cpf"][0] == "123.***.***-00"
    assert df_result["cpf"][1] == "987.***.***-99"


def test_standalone_codegen_zero_plaintext_credentials_rnf02():
    """Valida RNF-02: Nenhuma credencial em texto puro no código gerado (usa os.getenv)."""
    secret_pass = "SuperSecretDbPassword123!"
    secret_token = "api_secret_jwt_xyz987"

    pipeline_def = {
        "metadata": {"name": "secure_db_pipeline", "id": "pipe_secure"},
        "spec": {
            "nodes": [
                {
                    "id": "postgres_source",
                    "component": {"type": "core.postgres.source", "version": "1.0.0"},
                    "config": {
                        "host": "postgres.corp.internal",
                        "port": 5432,
                        "database": "production_db",
                        "username": "etl_reader",
                        "password": secret_pass,
                        "token": secret_token,
                        "query": "SELECT * FROM financial_records"
                    }
                },
                {
                    "id": "duckdb_sink",
                    "component": {"type": "core.file.target", "version": "1.0.0"},
                    "config": {
                        "path": "output_records.parquet",
                        "format": "parquet"
                    }
                }
            ],
            "edges": [
                {"from": "postgres_source.output", "to": "duckdb_sink.input"}
            ]
        }
    }

    generator = StandaloneGenerator()
    bundle = generator.generate(pipeline_def)

    # Nenhuma das senhas literais pode aparecer no script
    assert secret_pass not in bundle.script_py, "Credencial sensível (password) exposta em texto puro!"
    assert secret_token not in bundle.script_py, "Token sensível exposto em texto puro!"

    # Deve utilizar os.getenv para variáveis de ambiente
    assert "os.getenv(" in bundle.script_py
    assert "DB_PASSWORD" in bundle.script_py or "POSTGRES_SOURCE_PASSWORD" in bundle.script_py

    # Deve documentar as variáveis no env_example
    assert "PASSWORD" in bundle.env_example


def test_export_endpoints_api():
    """Valida chamadas REST para os endpoints de exportação autônoma e Airflow."""
    from starlette.testclient import TestClient
    from src.core.infrastructure.web.app import app

    client = TestClient(app)

    payload = {
        "draft_definition": {
            "metadata": {"name": "api_test_job", "id": "job_007"},
            "spec": {
                "nodes": [
                    {"id": "src", "component": {"type": "core.file.source"}, "config": {"path": "in.csv"}},
                    {"id": "tgt", "component": {"type": "core.file.target"}, "config": {"path": "out.parquet"}}
                ],
                "edges": [{"from": "src.output", "to": "tgt.input"}]
            }
        }
    }

    # 1. Endpoint Standalone
    res_standalone = client.post("/api/v1/pipelines/job_007/export/standalone", json=payload)
    assert res_standalone.status_code == 200
    data_std = res_standalone.json()
    assert "script_py" in data_std
    assert "requirements_txt" in data_std
    assert "env_example" in data_std
    assert "duckdb" in data_std["script_py"]

    # 2. Endpoint Airflow
    res_airflow = client.post("/api/v1/pipelines/job_007/export/airflow", json={
        **payload,
        "dag_id": "airflow_exported_dag",
        "schedule_interval": "0 12 * * *"
    })
    assert res_airflow.status_code == 200
    data_af = res_airflow.json()
    assert "dag_py" in data_af
    assert data_af["dag_id"] == "airflow_exported_dag"
    assert "0 12 * * *" in data_af["dag_py"]

