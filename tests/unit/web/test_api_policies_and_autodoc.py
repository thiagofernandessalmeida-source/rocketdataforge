"""Testes de Integração da API para Políticas Criptográficas e Auto-Doc."""

from fastapi.testclient import TestClient
import pytest

from src.core.infrastructure.web.app import app

client = TestClient(app)


def test_api_generate_keys_and_sign_policy():
    # 1. Gerar par de chaves RSA
    res_keys = client.post("/api/v1/policies/keys/generate")
    assert res_keys.status_code == 200
    keys_data = res_keys.json()
    assert "private_key_pem" in keys_data
    assert "public_key_pem" in keys_data
    priv_pem = keys_data["private_key_pem"]
    pub_pem = keys_data["public_key_pem"]

    # 2. Obter Hardware Fingerprint da máquina
    res_hw = client.get("/api/v1/policies/machine-fingerprint")
    assert res_hw.status_code == 200
    hw_data = res_hw.json()
    assert "hardware_fingerprint" in hw_data

    # 3. Assinar uma política
    policy_payload = {
        "version": "2026-10-01",
        "principal": "user_developer_1",
        "hardware_fingerprint": hw_data["hardware_fingerprint"],
        "statements": [
            {
                "sid": "AllowCoreConnectors",
                "effect": "Allow",
                "actions": ["connector:use", "pipeline:execute"],
                "resources": ["urn:rdf:connector:core.*"],
                "conditions": {"max_batch_size": 1000}
            }
        ]
    }

    res_sign = client.post(
        "/api/v1/policies/sign",
        json={"policy": policy_payload, "private_key_pem": priv_pem}
    )
    assert res_sign.status_code == 200
    sign_data = res_sign.json()
    assert "signed_jws" in sign_data
    jws = sign_data["signed_jws"]

    # 4. Verificar a assinatura e identity binding
    res_verify = client.post(
        "/api/v1/policies/verify",
        json={
            "signed_jws": jws,
            "public_key_pem": pub_pem,
            "expected_principal": "user_developer_1",
            "verify_hardware": True
        }
    )
    assert res_verify.status_code == 200
    assert res_verify.json()["valid"] is True

    # 5. Tentar verificar com principal fraudulento deve falhar
    res_fraud = client.post(
        "/api/v1/policies/verify",
        json={
            "signed_jws": jws,
            "public_key_pem": pub_pem,
            "expected_principal": "fraud_user",
            "verify_hardware": False
        }
    )
    assert res_fraud.status_code == 403


def test_api_simulate_policy():
    # Simulação direta com JSON de Policy
    sim_payload = {
        "policy": {
            "version": "2026-10-01",
            "principal": "analyst_maria",
            "statements": [
                {
                    "sid": "AllowDatabaseTarget",
                    "effect": "Allow",
                    "actions": ["connector:use"],
                    "resources": ["urn:rdf:connector:core.database.target"],
                    "conditions": {"max_batch_size": 2000}
                }
            ]
        },
        "action": "connector:use",
        "resource": "urn:rdf:connector:core.database.target",
        "context": {"batch_size": 1500}
    }

    res = client.post("/api/v1/policies/simulate", json=sim_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["allowed"] is True
    assert data["decision"] == "Allow"
    assert data["matched_statement_sid"] == "AllowDatabaseTarget"

    # Simulação que deve violar a condição
    sim_payload_exceeded = {
        **sim_payload,
        "context": {"batch_size": 5000}
    }
    res_denied = client.post("/api/v1/policies/simulate", json=sim_payload_exceeded)
    assert res_denied.status_code == 200
    data_denied = res_denied.json()
    assert data_denied["allowed"] is False
    assert data_denied["decision"] == "Deny"


def test_api_autodoc_endpoints():
    import time
    ts = int(time.time() * 1000)
    # 1. Criar projeto e pipeline para teste
    ws_res = client.post("/api/v1/workspaces", json={"name": f"WS Test AutoDoc {ts}"})
    assert ws_res.status_code == 201
    ws_id = ws_res.json()["id"]

    proj_res = client.post(
        f"/api/v1/workspaces/{ws_id}/projects",
        json={"name": "Proj Test AutoDoc", "slug": f"proj-autodoc-{ts}"}
    )
    assert proj_res.status_code == 201
    proj_id = proj_res.json()["id"]

    pipe_res = client.post(f"/api/v1/projects/{proj_id}/pipelines", json={"name": "Pipeline AutoDoc Demo"})
    pipe_id = pipe_res.json()["id"]

    # 2. Gerar Auto-Doc
    gen_res = client.post(
        f"/api/v1/pipelines/{pipe_id}/autodoc/generate",
        json={
            "author": "Equipe de Engenharia",
            "business_tags": ["#financeiro", "#dados-sensiveis"],
            "telemetry_metrics": {
                "avg_duration_ms": 2500,
                "total_records_processed": 100000,
                "success_rate_percent": 100.0,
                "last_executed_at": "2026-10-07 20:00:00"
            }
        }
    )
    assert gen_res.status_code == 200
    doc_data = gen_res.json()
    assert doc_data["pipeline_id"] == pipe_id
    assert "# 📘 Documentação Técnica: Pipeline AutoDoc Demo" in doc_data["markdown"]
    assert "flowchart LR" in doc_data["mermaid_code"]
    assert "`#financeiro`" in doc_data["markdown"]

    # 3. Exportar HTML
    html_res = client.post(
        f"/api/v1/pipelines/{pipe_id}/autodoc/export-html",
        json={"markdown_content": doc_data["markdown"]}
    )
    assert html_res.status_code == 200
    assert "text/html" in html_res.headers["content-type"]
    assert "<!DOCTYPE html>" in html_res.text
    assert "mermaid.min.js" in html_res.text
