"""Testes unitários dos tipos canônicos e Value Objects."""

import pytest
from src.core.domain.shared.exceptions import DomainValidationError, SecurityViolationError
from src.core.domain.shared.identifiers import EntityId
from src.core.domain.shared.types import (
    LogicalDataType,
    PortId,
    SecretReference,
    SemanticVersion,
)


def test_semantic_version_valid():
    v = SemanticVersion.parse("1.2.3")
    assert v.major == 1
    assert v.minor == 2
    assert v.patch == 3
    assert str(v) == "1.2.3"


def test_semantic_version_invalid():
    with pytest.raises(DomainValidationError):
        SemanticVersion.parse("1.2")
    with pytest.raises(DomainValidationError):
        SemanticVersion.parse("v1.0.0")
    with pytest.raises(DomainValidationError):
        SemanticVersion(major=-1, minor=0, patch=0)


def test_secret_reference_valid():
    ref = SecretReference(uri="secret://env/POSTGRES_PASSWORD")
    assert ref.uri == "secret://env/POSTGRES_PASSWORD"


def test_secret_reference_invalid_scheme():
    with pytest.raises(SecurityViolationError):
        SecretReference(uri="plaintext_password_123")


def test_secret_reference_with_spaces():
    with pytest.raises(SecurityViolationError):
        SecretReference(uri="secret://env/my password")


def test_secret_reference_empty():
    with pytest.raises(SecurityViolationError):
        SecretReference(uri="")


def test_port_id_parsing():
    p = PortId.parse("node_1.main")
    assert p.node_id == "node_1"
    assert p.port_name == "main"
    assert str(p) == "node_1.main"


def test_port_id_invalid():
    with pytest.raises(DomainValidationError):
        PortId.parse("invalid_port_without_dot")


def test_entity_id_generation_and_validation():
    eid = EntityId.generate()
    assert len(eid.value) == 26
    # Deve ser possível instanciar outro EntityId a partir do mesmo valor
    eid2 = EntityId(value=eid.value)
    assert eid == eid2


def test_entity_id_invalid():
    with pytest.raises(DomainValidationError):
        EntityId(value="invalid_ulid_too_short")
    with pytest.raises(DomainValidationError):
        # Letra 'I' é proibida no alfabeto Crockford
        EntityId(value="01ARZ3NDEKTSV4RRFFQ69G5FAI")
