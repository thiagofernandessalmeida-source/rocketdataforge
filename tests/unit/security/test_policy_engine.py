"""Testes Unitários do Motor de Políticas ABAC, Criptografia Assimétrica e Identity Binding."""

import pytest
from pydantic import ValidationError

from src.core.domain.policy.evaluator import PolicyEvaluator
from src.core.domain.policy.policy_model import (
    EffectEnum,
    PolicyDocument,
    PolicyStatement,
)
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.infrastructure.security.policy_crypto import (
    PolicyCryptoService,
    generate_rsa_keypair,
    get_current_hardware_fingerprint,
)


@pytest.fixture
def rsa_keys():
    """Gera um par de chaves RSA para os testes."""
    return generate_rsa_keypair(key_size=2048)


def test_policy_model_strict_validation():
    """Garante que campos desconhecidos ou malformados sejam bloqueados pelo Strict Mode."""
    # Validação correta
    valid_doc = PolicyDocument(
        principal="analyst_user_1",
        statements=[
            PolicyStatement(
                sid="AllowMysqlSource",
                effect=EffectEnum.ALLOW,
                actions=["connector:use", "pipeline:execute"],
                resources=["urn:rdf:connector:mysql-*"],
                conditions={"max_batch_size": 1000}
            )
        ]
    )
    assert valid_doc.principal == "analyst_user_1"
    assert len(valid_doc.statements) == 1

    # Campo desconhecido deve falhar (extra="forbid")
    with pytest.raises(ValidationError):
        PolicyDocument.model_validate({
            "principal": "analyst_user_1",
            "statements": [
                {
                    "effect": "Allow",
                    "actions": ["connector:use"],
                    "resources": ["urn:rdf:connector:*"],
                    "campo_invalido_hacker": True
                }
            ]
        })

    # Statement sem actions deve falhar
    with pytest.raises(ValidationError):
        PolicyStatement(
            effect=EffectEnum.ALLOW,
            actions=[],
            resources=["urn:rdf:connector:*"]
        )


def test_asymmetric_signing_and_verification(rsa_keys):
    """Testa o ciclo completo de assinatura JWS e verificação com chave pública."""
    priv_key, pub_key = rsa_keys
    doc = PolicyDocument(
        principal="data_engineer_01",
        statements=[
            PolicyStatement(
                sid="Stmt1",
                effect=EffectEnum.ALLOW,
                actions=["pipeline:execute"],
                resources=["urn:rdf:pipeline:*"]
            )
        ]
    )

    signed_jws = PolicyCryptoService.sign_policy(doc, priv_key)
    assert isinstance(signed_jws, str)
    assert signed_jws.count(".") == 2  # Cabeçalho.Payload.Assinatura

    # Verificação bem-sucedida
    loaded_doc = PolicyCryptoService.verify_and_load_policy(
        signed_jws=signed_jws,
        public_key_pem=pub_key,
        expected_principal="data_engineer_01"
    )
    assert loaded_doc.principal == "data_engineer_01"
    assert loaded_doc.statements[0].sid == "Stmt1"


def test_identity_binding_anti_copy(rsa_keys):
    """Garante que se um usuário comum copiar a policy de um Admin, a carga é rejeitada."""
    priv_key, pub_key = rsa_keys
    admin_doc = PolicyDocument(
        principal="admin_user",
        statements=[
            PolicyStatement(
                sid="FullAdmin",
                effect=EffectEnum.ALLOW,
                actions=["*"],
                resources=["*"]
            )
        ]
    )
    admin_jws = PolicyCryptoService.sign_policy(admin_doc, priv_key)

    # Usuário "fraud_user" tenta carregar a policy do Admin
    with pytest.raises(SecurityViolationError, match="Tentativa de violação de identidade detectada"):
        PolicyCryptoService.verify_and_load_policy(
            signed_jws=admin_jws,
            public_key_pem=pub_key,
            expected_principal="fraud_user"
        )


def test_tamper_detection_invalidates_signature(rsa_keys):
    """Garante que alterar qualquer caractere do payload JWS invalida a assinatura digital."""
    priv_key, pub_key = rsa_keys
    doc = PolicyDocument(
        principal="admin_user",
        statements=[
            PolicyStatement(
                sid="FullAdmin",
                effect=EffectEnum.ALLOW,
                actions=["*"],
                resources=["*"]
            )
        ]
    )
    signed_jws = PolicyCryptoService.sign_policy(doc, priv_key)
    parts = signed_jws.split(".")

    # Adulterar o payload alterando um caractere
    tampered_payload = parts[1][:-1] + ("A" if parts[1][-1] != "A" else "B")
    tampered_jws = f"{parts[0]}.{tampered_payload}.{parts[2]}"

    with pytest.raises(SecurityViolationError, match="Assinatura digital da política INVÁLIDA"):
        PolicyCryptoService.verify_and_load_policy(
            signed_jws=tampered_jws,
            public_key_pem=pub_key,
            expected_principal="admin_user"
        )


def test_hardware_fingerprint_binding(rsa_keys):
    """Garante que a política pode ser ancorada à máquina física/virtual atual."""
    priv_key, pub_key = rsa_keys
    current_hw = get_current_hardware_fingerprint()

    doc = PolicyDocument(
        principal="local_operator",
        hardware_fingerprint=current_hw,
        statements=[
            PolicyStatement(
                sid="LocalStmt",
                effect=EffectEnum.ALLOW,
                actions=["pipeline:run_local"],
                resources=["urn:rdf:pipeline:*"]
            )
        ]
    )
    signed_jws = PolicyCryptoService.sign_policy(doc, priv_key)

    # Sucesso na máquina correta
    loaded = PolicyCryptoService.verify_and_load_policy(
        signed_jws=signed_jws,
        public_key_pem=pub_key,
        expected_principal="local_operator",
        verify_hardware_binding=True
    )
    assert loaded.hardware_fingerprint == current_hw

    # Falha se a máquina tiver fingerprint diferente
    doc_other_machine = PolicyDocument(
        principal="local_operator",
        hardware_fingerprint="outra_maquina_ficticia_hash_12345",
        statements=doc.statements
    )
    jws_other = PolicyCryptoService.sign_policy(doc_other_machine, priv_key)

    with pytest.raises(SecurityViolationError, match="Tentativa de execução em máquina não autorizada"):
        PolicyCryptoService.verify_and_load_policy(
            signed_jws=jws_other,
            public_key_pem=pub_key,
            expected_principal="local_operator",
            verify_hardware_binding=True
        )


def test_evaluator_allow_and_default_deny():
    """Testa concessão de acesso e negação por default."""
    policy = PolicyDocument(
        principal="user_a",
        statements=[
            PolicyStatement(
                sid="AllowPostgres",
                effect=EffectEnum.ALLOW,
                actions=["connector:use"],
                resources=["urn:rdf:connector:postgres-*"]
            )
        ]
    )
    evaluator = PolicyEvaluator([policy])

    # Acesso permitido para recurso correspondente ao wildcard
    res1 = evaluator.evaluate("connector:use", "urn:rdf:connector:postgres-prod")
    assert res1.allowed is True
    assert res1.decision == EffectEnum.ALLOW
    assert res1.matched_statement_sid == "AllowPostgres"

    # Default Deny para recurso não coberto
    res2 = evaluator.evaluate("connector:use", "urn:rdf:connector:mysql-secret")
    assert res2.allowed is False
    assert res2.decision == EffectEnum.DENY
    assert "Default Deny" in res2.reason


def test_evaluator_explicit_deny_precedence():
    """Testa precedência de regras DENY explícitas sobre regras ALLOW."""
    policy = PolicyDocument(
        principal="user_b",
        statements=[
            PolicyStatement(
                sid="AllowAllConnectors",
                effect=EffectEnum.ALLOW,
                actions=["connector:*"],
                resources=["urn:rdf:connector:*"]
            ),
            PolicyStatement(
                sid="DenyProductionPayroll",
                effect=EffectEnum.DENY,
                actions=["connector:*"],
                resources=["urn:rdf:connector:*-payroll-prod"]
            )
        ]
    )
    evaluator = PolicyEvaluator([policy])

    # Conector comum é permitido
    res1 = evaluator.evaluate("connector:use", "urn:rdf:connector:orders-db")
    assert res1.allowed is True

    # Conector restrito é explicitamente negado
    res2 = evaluator.evaluate("connector:use", "urn:rdf:connector:finance-payroll-prod")
    assert res2.allowed is False
    assert res2.decision == EffectEnum.DENY
    assert res2.matched_statement_sid == "DenyProductionPayroll"


def test_evaluator_conditions_batch_size_and_descriptions():
    """Testa avaliação de condições como max_batch_size, require_job_description e require_cell_description."""
    policy = PolicyDocument(
        principal="user_c",
        statements=[
            PolicyStatement(
                sid="EnforceHardConstraints",
                effect=EffectEnum.ALLOW,
                actions=["pipeline:execute"],
                resources=["urn:rdf:pipeline:*"],
                conditions={
                    "max_batch_size": 500,
                    "require_job_description": True,
                    "require_cell_description": True
                }
            )
        ]
    )
    evaluator = PolicyEvaluator([policy])

    # Caso 1: Lote excede limite máximo
    res_exceeded = evaluator.evaluate(
        action="pipeline:execute",
        resource="urn:rdf:pipeline:order_sync",
        context={
            "batch_size": 1500,
            "job_description": "Sincroniza pedidos",
            "cell_description": "Célula 1"
        }
    )
    assert res_exceeded.allowed is False

    # Caso 2: Falta descrição do Job
    res_missing_desc = evaluator.evaluate(
        action="pipeline:execute",
        resource="urn:rdf:pipeline:order_sync",
        context={
            "batch_size": 200,
            "job_description": "",
            "cell_description": "Célula 1"
        }
    )
    assert res_missing_desc.allowed is False

    # Caso 3: Tudo em conformidade
    res_valid = evaluator.evaluate(
        action="pipeline:execute",
        resource="urn:rdf:pipeline:order_sync",
        context={
            "batch_size": 300,
            "job_description": "Pipeline devidamente documentado",
            "cell_description": "Processamento da célula"
        }
    )
    assert res_valid.allowed is True
    assert res_valid.matched_statement_sid == "EnforceHardConstraints"
