"""Testes unitários do LocalFileSystemArtifactStore."""

import json
import os
import pytest
from src.core.domain.shared.exceptions import DomainError, SecurityViolationError
from src.core.infrastructure.persistence.artifact_store import LocalFileSystemArtifactStore


def test_store_and_load_artifact(tmp_path):
    store = LocalFileSystemArtifactStore(base_directory=str(tmp_path))

    content = json.dumps({"plan_id": "p1", "operators": ["scan", "sink"]}).encode("utf-8")
    uri, checksum = store.store_artifact("plans/p1_physical.json", content)

    assert uri == "artifact://local/plans/p1_physical.json"
    assert len(checksum) == 64
    assert store.has_artifact(uri)

    loaded = store.load_artifact(uri)
    assert loaded == content


def test_detect_corrupted_artifact(tmp_path):
    store = LocalFileSystemArtifactStore(base_directory=str(tmp_path))
    content = b"original safe content"
    uri, _ = store.store_artifact("data.bin", content)

    # Simula corrupção física alterando o arquivo em disco sem atualizar os metadados
    file_path = tmp_path / "data.bin"
    with open(file_path, "wb") as f:
        f.write(b"tampered malicious content")

    with pytest.raises(DomainError) as exc_info:
        store.load_artifact(uri)
    assert exc_info.value.code == "ERR_ARTIFACT_CORRUPTED"


def test_artifact_path_traversal_prevention(tmp_path):
    store = LocalFileSystemArtifactStore(base_directory=str(tmp_path))

    with pytest.raises(SecurityViolationError):
        store.store_artifact("../outside.txt", b"hack")
