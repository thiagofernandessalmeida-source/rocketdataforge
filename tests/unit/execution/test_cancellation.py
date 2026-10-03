"""Testes unitários do CancellationToken."""

import pytest
from src.core.domain.shared.exceptions import DomainError
from src.core.infrastructure.execution.cancellation import CancellationToken


def test_cancellation_token_flow():
    token = CancellationToken()
    assert not token.is_cancelled()
    token.check_cancelled()  # Não deve lançar nada

    token.cancel()
    assert token.is_cancelled()

    with pytest.raises(DomainError) as exc_info:
        token.check_cancelled()
    assert exc_info.value.code == "ERR_EXECUTION_CANCELLED"
