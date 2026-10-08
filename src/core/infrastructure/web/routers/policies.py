"""Router FastAPI para Motor de Políticas ABAC, Criptografia Assimétrica e Simulador Dry-Run."""

import platform
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from src.core.domain.policy.evaluator import PolicyEvaluator
from src.core.domain.policy.policy_model import (
    EvaluationResult,
    PolicyDocument,
)
from src.core.domain.shared.exceptions import SecurityViolationError
from src.core.infrastructure.security.policy_crypto import (
    PolicyCryptoService,
    generate_rsa_keypair,
    get_current_hardware_fingerprint,
)

router = APIRouter(prefix="/policies", tags=["Policies & Security"])


class GenerateKeyPairResponse(BaseModel):
    private_key_pem: str
    public_key_pem: str


class SignPolicyRequest(BaseModel):
    policy: PolicyDocument
    private_key_pem: str


class SignPolicyResponse(BaseModel):
    signed_jws: str
    principal: str
    version: str


class VerifyPolicyRequest(BaseModel):
    signed_jws: str
    public_key_pem: str
    expected_principal: Optional[str] = None
    verify_hardware: bool = False


class VerifyPolicyResponse(BaseModel):
    valid: bool
    policy: PolicyDocument
    message: str


class PolicySimulationRequest(BaseModel):
    policy: Optional[PolicyDocument] = None
    signed_jws: Optional[str] = None
    public_key_pem: Optional[str] = None
    principal: Optional[str] = None
    action: str = Field(..., description="Ação solicitada (ex: connector:use, pipeline:execute)")
    resource: str = Field(..., description="Recurso alvo (ex: urn:rdf:connector:mysql-agreements)")
    context: Dict[str, Any] = Field(default_factory=dict, description="Contexto dinâmico de execução")
    verify_hardware: bool = False


class MachineFingerprintResponse(BaseModel):
    hardware_fingerprint: str
    system: str
    machine: str


@router.post("/keys/generate", response_model=GenerateKeyPairResponse)
def generate_keys():
    """Gera um novo par de chaves assimétricas RSA (2048-bit) para a Autoridade Central."""
    priv, pub = generate_rsa_keypair(key_size=2048)
    return GenerateKeyPairResponse(private_key_pem=priv, public_key_pem=pub)


@router.get("/machine-fingerprint", response_model=MachineFingerprintResponse)
def get_machine_fingerprint():
    """Retorna o identificador de hardware (Hardware Fingerprint) do servidor/máquina local."""
    return MachineFingerprintResponse(
        hardware_fingerprint=get_current_hardware_fingerprint(),
        system=platform.system(),
        machine=platform.machine()
    )


@router.post("/sign", response_model=SignPolicyResponse)
def sign_policy(req: SignPolicyRequest):
    """Assina digitalmente uma política JSON com a chave privada, gerando um token JWS blindado."""
    try:
        signed_jws = PolicyCryptoService.sign_policy(req.policy, req.private_key_pem)
        return SignPolicyResponse(
            signed_jws=signed_jws,
            principal=req.policy.principal,
            version=req.policy.version
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao assinar a política: {str(e)}"
        )


@router.post("/verify", response_model=VerifyPolicyResponse)
def verify_policy(req: VerifyPolicyRequest):
    """Verifica a integridade criptográfica da política e valida o Identity Binding e Hardware Fingerprint."""
    try:
        policy = PolicyCryptoService.verify_and_load_policy(
            signed_jws=req.signed_jws,
            public_key_pem=req.public_key_pem,
            expected_principal=req.expected_principal,
            verify_hardware_binding=req.verify_hardware
        )
        return VerifyPolicyResponse(
            valid=True,
            policy=policy,
            message="Política válida e autêntica. Integridade e identidade confirmadas."
        )
    except SecurityViolationError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Violação de Segurança na Política: {e.message}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao verificar assinatura: {str(e)}"
        )


@router.post("/simulate", response_model=EvaluationResult)
def simulate_policy_access(req: PolicySimulationRequest):
    """Executa a simulação Dry-Run de acesso: testa ação, recurso e contexto contra regras da policy."""
    policy_doc: Optional[PolicyDocument] = req.policy

    # Se forneceu policy assinada em JWS, valida antes de simular
    if req.signed_jws and req.public_key_pem:
        try:
            policy_doc = PolicyCryptoService.verify_and_load_policy(
                signed_jws=req.signed_jws,
                public_key_pem=req.public_key_pem,
                expected_principal=req.principal,
                verify_hardware_binding=req.verify_hardware
            )
        except SecurityViolationError as e:
            return EvaluationResult(
                decision="Deny",
                allowed=False,
                matched_statement_sid=None,
                reason=f"Simulação Rejeitada na Validação Criptográfica: {e.message}",
                evaluated_statements_count=0
            )

    if not policy_doc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe um objeto 'policy' ou 'signed_jws' acompanhado de 'public_key_pem'."
        )

    evaluator = PolicyEvaluator([policy_doc])
    result = evaluator.evaluate(
        action=req.action,
        resource=req.resource,
        context=req.context,
        principal=req.principal or policy_doc.principal
    )
    return result
