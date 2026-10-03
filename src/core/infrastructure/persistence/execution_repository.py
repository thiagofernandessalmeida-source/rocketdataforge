"""Repositório SQLAlchemy para o Agregado Execution e telemetria de TaskRuns."""

from typing import Optional

from sqlalchemy.orm import Session
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.execution.task_run import TaskRun
from src.core.infrastructure.persistence.models import ExecutionModel, TaskRunModel


class SqlAlchemyExecutionRepository:
    """Implementação concreta de repositório de execuções usando SQLAlchemy."""

    def __init__(self, session: Session):
        self.session = session

    def save(self, execution: Execution, plan_artifact_uri: Optional[str] = None) -> None:
        """Persiste ou sincroniza o agregado Execution e suas TaskRuns."""
        exec_model = self.session.get(ExecutionModel, execution.id)
        if exec_model is None:
            exec_model = ExecutionModel(
                id=execution.id,
                pipeline_version_id=execution.pipeline_version_id,
                correlation_id=execution.correlation_id,
                status=execution.status.value,
                attempt=execution.attempt,
                plan_artifact_uri=plan_artifact_uri,
                started_at=execution.started_at,
                finished_at=execution.finished_at,
                error_details_json=execution.error_details,
                created_at=execution.created_at
            )
            self.session.add(exec_model)
        else:
            exec_model.status = execution.status.value
            exec_model.started_at = execution.started_at
            exec_model.finished_at = execution.finished_at
            exec_model.error_details_json = execution.error_details
            if plan_artifact_uri:
                exec_model.plan_artifact_uri = plan_artifact_uri

        # Sincroniza cada TaskRun
        for task in execution.tasks.values():
            task_model_id = f"{execution.id}:{task.node_id}"
            task_model = self.session.get(TaskRunModel, task_model_id)
            if task_model is None:
                task_model = TaskRunModel(
                    id=task_model_id,
                    execution_id=execution.id,
                    node_id=task.node_id,
                    status=task.status.value,
                    rows_in=task.rows_in,
                    rows_out=task.rows_out,
                    rejected_count=task.rejected_count,
                    duration_ms=task.duration_ms,
                    started_at=task.started_at,
                    finished_at=task.finished_at,
                    error_code=task.error_code,
                    error_message=task.error_message
                )
                self.session.add(task_model)
            else:
                task_model.status = task.status.value
                task_model.rows_in = task.rows_in
                task_model.rows_out = task.rows_out
                task_model.rejected_count = task.rejected_count
                task_model.duration_ms = task.duration_ms
                task_model.started_at = task.started_at
                task_model.finished_at = task.finished_at
                task_model.error_code = task.error_code
                task_model.error_message = task.error_message

        self.session.flush()

    def get(self, execution_id: str) -> Optional[Execution]:
        """Recupera execução reconstituindo a entidade de domínio completa."""
        exec_model = self.session.get(ExecutionModel, execution_id)
        if exec_model is None:
            return None

        tasks = {}
        for tm in exec_model.task_runs:
            tasks[tm.node_id] = TaskRun(
                node_id=tm.node_id,
                status=ExecutionStatus(tm.status),
                rows_in=tm.rows_in,
                rows_out=tm.rows_out,
                rejected_count=tm.rejected_count,
                duration_ms=tm.duration_ms,
                started_at=tm.started_at,
                finished_at=tm.finished_at,
                error_code=tm.error_code,
                error_message=tm.error_message
            )

        execution = Execution(
            id=exec_model.id,
            pipeline_version_id=exec_model.pipeline_version_id,
            correlation_id=exec_model.correlation_id,
            status=ExecutionStatus(exec_model.status),
            attempt=exec_model.attempt,
            tasks=tasks,
            created_at=exec_model.created_at,
            started_at=exec_model.started_at,
            finished_at=exec_model.finished_at,
            error_details=exec_model.error_details_json
        )

        return execution
