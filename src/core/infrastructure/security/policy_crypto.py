"""Serviço Criptográfico para Assinatura, Verificação e Binding de Políticas ABAC.

Utiliza criptografia assimétrica RSA (RS256) via cryptography e PyJWT para garantir
integridade, autenticidade e anti-tampering (Identity Binding e Hardware Fingerprint).
"""

import hashlib
import platform
import uuid
from typing import Any, Dict, Optional, Tuple

import jwt
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from src.core.domain.policy.policy_model import PolicyDocument
from src.core.domain.shared.exceptions import SecurityViolationError


def generate_rsa_keypair(key_size: int = 2048) -> Tuple[str, str]:
    """Gera um par de chaves RSA (Privada e Pública) em formato PEM."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=key_size,
        backend=default_backend()
    )
    
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode("utf-8")

    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("utf-8")

    return private_pem, public_pem


def get_current_hardware_fingerprint() -> str:
    """Calcula um hash único representativo da máquina/host atual (Hardware Fingerprint).
    
    Combina o MAC address (via uuid.getnode()), arquitetura do sistema e identificador
    de plataforma para ancorar a política ao hardware físico/virtual.
    """
    node_id = str(uuid.getnode())
    machine_arch = platform.machine()
    system_name = platform.system()
    raw_ident = f"rdf_hw:{node_id}:{system_name}:{machine_arch}"
    return hashlib.sha256(raw_ident.encode("utf-8")).hexdigest()[:32]


class PolicyCryptoService:
    """Serviço para assinatura digital JWS e verificação estrita de políticas."""

    @staticmethod
    def sign_policy(policy_doc: PolicyDocument, private_key_pem: str) -> str:
        """Assina um PolicyDocument com a Chave Privada do servidor/autoridade central.
        
        Gera um token JWS (JSON Web Signature) padrão RS256 contendo o payload e a assinatura.
        Realiza validação estrita prévia do modelo.
        """
        # Validação estrita do modelo antes da assinatura
        payload = policy_doc.model_dump(mode="json")
        
        headers = {
            "typ": "RDF-POLICY+JWS",
            "alg": "RS256"
        }

        try:
            signed_jws = jwt.encode(
                payload=payload,
                key=private_key_pem,
                algorithm="RS256",
                headers=headers
            )
            return signed_jws
        except Exception as e:
            raise SecurityViolationError(f"Falha ao assinar digitalmente a política: {str(e)}")

    @staticmethod
    def verify_and_load_policy(
        signed_jws: str,
        public_key_pem: str,
        expected_principal: Optional[str] = None,
        verify_hardware_binding: bool = False
    ) -> PolicyDocument:
        """Verifica a assinatura criptográfica e valida os bindings de identidade e hardware.
        
        Passos de Segurança:
        1. Validação da assinatura digital com a Chave Pública (prevenindo adulteração/tampering).
        2. Strict Schema Validation (reconstrução do PolicyDocument com validação Pydantic estrita).
        3. Identity Binding: Garante que a policy pertence estritamente ao usuário autenticado.
        4. Hardware Binding (opcional): Garante que a policy está rodando na máquina autorizada.
        """
        # 1. Validação da Assinatura Criptográfica
        try:
            payload = jwt.decode(
                signed_jws,
                public_key_pem,
                algorithms=["RS256"],
                options={"verify_signature": True}
            )
        except jwt.PyJWTError as e:
            raise SecurityViolationError(
                f"Assinatura digital da política INVÁLIDA ou arquivo adulterado: {str(e)}"
            )

        # 2. Reconstrução estrita do modelo Pydantic
        try:
            policy_doc = PolicyDocument.model_validate(payload)
        except Exception as e:
            raise SecurityViolationError(
                f"Estrutura do payload da política é inválida segundo o JSON Schema estrito: {str(e)}"
            )

        # 3. Mecanismo Anti-Cópia: Identity Binding
        if expected_principal is not None and expected_principal != "*":
            if policy_doc.principal != expected_principal and policy_doc.principal != "*":
                raise SecurityViolationError(
                    f"Tentativa de violação de identidade detectada (Identity Binding): "
                    f"A política assinada pertence ao usuário '{policy_doc.principal}', "
                    f"mas a sessão atual pertence ao usuário '{expected_principal}'."
                )

        # 4. Mecanismo Anti-Cópia: Hardware Fingerprint Binding
        if verify_hardware_binding and policy_doc.hardware_fingerprint:
            current_hw = get_current_hardware_fingerprint()
            if policy_doc.hardware_fingerprint != current_hw:
                raise SecurityViolationError(
                    f"Tentativa de execução em máquina não autorizada (Hardware Binding): "
                    f"O fingerprint da política ({policy_doc.hardware_fingerprint[:8]}...) "
                    f"difere do hardware da máquina local ({current_hw[:8]}...)."
                )

        return policy_doc
