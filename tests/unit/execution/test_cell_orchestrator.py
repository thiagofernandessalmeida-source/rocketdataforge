"""Testes unitários para orquestração de células no ExecutionManager.

Verifica:
1. Interceptação de células desativadas (is_active == False) com status SKIPPED.
2. Propagação de SKIPPED em cascata para células dependentes.
3. Execução normal de células ativas e independentes.
"""

import pytest
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.infrastructure.execution.manager import ExecutionManager


def test_orchestrate_cells_inactive_and_cascade_skipped():
    manager = ExecutionManager()
    execution = Execution(
        id="exec_test_01",
        pipeline_version_id="hash_01",
        correlation_id="corr_01",
        status=ExecutionStatus.CREATED
    )

    cells = [
        # Célula 1: Desativada
        {
            "id": "cell-01",
            "name": "Extract ERP",
            "order": 1,
            "is_active": False,
            "preconditions": []
        },
        # Célula 2: Depende da Célula 1 (deve sofrer cascata e ficar SKIPPED)
        {
            "id": "cell-02",
            "name": "Transform Staging",
            "order": 2,
            "is_active": True,
            "preconditions": [
                {"target_cell_id": "cell-01", "expected_status": "OK"}
            ],
            "precondition_operator": "AND"
        },
        # Célula 3: Independente e Ativa (deve executar com SUCESSO)
        {
            "id": "cell-03",
            "name": "Audit Logging",
            "order": 1,
            "is_active": True,
            "preconditions": []
        }
    ]

    statuses = manager.orchestrate_cells(execution, cells)

    # Célula 1: desativada -> skipped
    assert statuses["cell-01"] == "skipped"
    assert execution.tasks["cell-01"].status == ExecutionStatus.SKIPPED

    # Célula 2: dependente da Célula 1 -> cascata -> skipped
    assert statuses["cell-02"] == "skipped"
    assert execution.tasks["cell-02"].status == ExecutionStatus.SKIPPED

    # Célula 3: ativa e sem dependências -> executada com sucesso
    assert statuses["cell-03"] == "success"
    assert execution.tasks["cell-03"].status == ExecutionStatus.SUCCEEDED
