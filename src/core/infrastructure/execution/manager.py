"""Gerenciador e Coordenador de Execuções Assíncronas (ExecutionManager).

Coordena o ciclo de vida das execuções em segundo plano, gerencia tokens de
cancelamento cooperativo, captura logs estruturados e atualiza os repositórios.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import logging
import threading
from typing import Dict, List, Optional

from sqlalchemy.orm import sessionmaker

from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlan, PhysicalPlanner
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.pipeline.version import PipelineVersion
from src.core.infrastructure.execution.cancellation import CancellationToken
from src.core.infrastructure.execution.worker import ExecutionWorker
from src.core.infrastructure.persistence.execution_repository import SqlAlchemyExecutionRepository
from src.core.infrastructure.telemetry.otel_setup import (
    execution_span,
    record_node_metrics,
)

logger = logging.getLogger(__name__)


class ExecutionLogRecord:
    """Registro de log estruturado."""
    def __init__(
        self,
        execution_id: str,
        level: str,
        message: str,
        node_id: Optional[str] = None,
        timestamp: Optional[datetime] = None
    ):
        self.execution_id = execution_id
        self.level = level
        self.message = message
        self.node_id = node_id
        self.timestamp = timestamp or datetime.now(timezone.utc)

    def to_dict(self) -> Dict:
        return {
            "timestamp": self.timestamp,
            "level": self.level,
            "execution_id": self.execution_id,
            "node_id": self.node_id,
            "message": self.message
        }


class ExecutionManager:
    """Gerenciador singleton para execuções assíncronas do RocketDataForge."""

    def __init__(
        self,
        session_factory: Optional[sessionmaker] = None,
        max_workers: int = 4
    ):
        self.session_factory = session_factory
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="rdf-worker")
        self._tokens: Dict[str, CancellationToken] = {}
        self._logs: Dict[str, List[ExecutionLogRecord]] = {}
        self._lock = threading.RLock()
        self.worker = ExecutionWorker()

    def register_execution(self, execution_id: str) -> CancellationToken:
        """Registra uma nova execução e seu respectivo token de cancelamento."""
        with self._lock:
            token = CancellationToken()
            self._tokens[execution_id] = token
            self._logs[execution_id] = []
            return token

    def get_token(self, execution_id: str) -> Optional[CancellationToken]:
        """Recupera o token de cancelamento da execução."""
        with self._lock:
            return self._tokens.get(execution_id)

    def cancel_execution(self, execution_id: str) -> bool:
        """Aciona o cancelamento cooperativo para a execução informada."""
        with self._lock:
            token = self._tokens.get(execution_id)
            if token is not None:
                token.cancel()
                self.log(execution_id, "WARN", "Sinal de cancelamento cooperativo emitido pelo usuário.")
                return True
            return False

    def log(
        self,
        execution_id: str,
        level: str,
        message: str,
        node_id: Optional[str] = None
    ) -> None:
        """Registra uma entrada de log estruturada para a execução."""
        record = ExecutionLogRecord(execution_id, level, message, node_id)
        with self._lock:
            if execution_id not in self._logs:
                self._logs[execution_id] = []
            self._logs[execution_id].append(record)
        logger.info(f"[{level}] [{execution_id}] {f'({node_id}) ' if node_id else ''}{message}")

    def get_logs(
        self,
        execution_id: str,
        node_id: Optional[str] = None
    ) -> List[ExecutionLogRecord]:
        """Retorna os logs registrados para uma dada execução."""
        with self._lock:
            logs = list(self._logs.get(execution_id, []))
        if node_id:
            logs = [l for l in logs if l.node_id == node_id]
        return logs

    def compile_version(self, version: PipelineVersion) -> PhysicalPlan:
        """Compila a versão em planos e retorna o PhysicalPlan."""
        imm = version.immutable_definition
        spec = imm.get("spec", {})
        meta = imm.get("metadata", {})

        from src.core.domain.pipeline.draft import PipelineDraft
        from src.core.domain.shared.types import PortId, SemanticVersion

        draft = PipelineDraft(id=version.pipeline_id, project_id="temp", name=meta.get("name", "pipeline"))
        for n in spec.get("nodes", []):
            comp = n.get("component", {})
            draft.add_node(
                node_id=n["id"],
                component_type=comp.get("type", "generic"),
                component_version=SemanticVersion.parse(comp.get("version", "1.0.0")),
                config=n.get("config", {})
            )
        for e in spec.get("edges", []):
            draft.connect_ports(PortId.parse(e["from"]), PortId.parse(e["to"]))

        validator = GraphValidator()
        report = validator.validate(draft)
        if not report.is_valid:
            err_msgs = "; ".join(e.message for e in report.errors)
            raise ValueError(f"Falha na validação do grafo: {err_msgs}")

        logical_plan = LogicalPlanner().compile(draft, report)
        optimized_plan = PlanOptimizer().optimize(logical_plan)
        physical_plan = PhysicalPlanner().compile(optimized_plan)
        return physical_plan

    def submit_execution(
        self,
        execution: Execution,
        plan: PhysicalPlan,
        token: CancellationToken
    ) -> None:
        """Enfileira a execução assíncrona no pool de threads."""
        self.executor.submit(self._run_task, execution, plan, token)

    def _run_task(
        self,
        execution: Execution,
        plan: PhysicalPlan,
        token: CancellationToken
    ) -> None:
        """Rotina interna de execução do worker em thread separada."""
        self.log(execution.id, "INFO", f"Iniciando execução assíncrona '{execution.id}'...")

        with execution_span(
            name="pipeline_execution",
            execution_id=execution.id,
            correlation_id=execution.correlation_id,
            attributes={"pipeline_version_id": execution.pipeline_version_id}
        ):
            try:
                # Executa o worker
                self.worker.run(execution, plan, token)

                # Registra métricas e logs para cada nó processado
                for node_id, task in execution.tasks.items():
                    record_node_metrics(
                        execution_id=execution.id,
                        node_id=node_id,
                        rows_in=task.rows_in,
                        rows_out=task.rows_out,
                        rejected=task.rejected_count,
                        duration_ms=task.duration_ms
                    )
                    self.log(
                        execution.id,
                        "INFO" if task.status == ExecutionStatus.SUCCEEDED else "WARN",
                        f"Nó '{node_id}' finalizado: {task.rows_in} in, {task.rows_out} out, status={task.status.value}",
                        node_id=node_id
                    )

                if execution.status == ExecutionStatus.SUCCEEDED:
                    self.log(execution.id, "INFO", "Execução finalizada com SUCESSO.")
                elif execution.status == ExecutionStatus.CANCELLED:
                    self.log(execution.id, "WARN", "Execução CANCELADA com sucesso.")
                else:
                    self.log(execution.id, "ERROR", f"Execução FALHOU: {execution.error_details}")

            except Exception as e:
                logger.exception(f"Erro fatal durante execução assíncrona '{execution.id}': {e}")
                self.log(execution.id, "ERROR", f"Erro interno não tratado: {str(e)}")
                execution.fail("ERR_WORKER_UNHANDLED", str(e))
            finally:
                # Salva o estado final no banco de dados
                if self.session_factory:
                    try:
                        session = self.session_factory()
                        repo = SqlAlchemyExecutionRepository(session)
                        repo.save(execution)
                        session.commit()
                        session.close()
                    except Exception as persist_err:
                        logger.error(f"Erro ao persistir estado final da execução: {persist_err}")
