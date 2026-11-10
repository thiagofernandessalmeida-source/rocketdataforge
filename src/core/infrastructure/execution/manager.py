"""Gerenciador e Coordenador de Execuções Assíncronas (ExecutionManager).

Coordena o ciclo de vida das execuções em segundo plano, gerencia tokens de
cancelamento cooperativo, captura logs estruturados e atualiza os repositórios.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import logging
import threading
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import sessionmaker

from src.core.application.compiler.logical_planner import LogicalPlanner
from src.core.application.compiler.optimizer import PlanOptimizer
from src.core.application.compiler.physical_planner import PhysicalPlan, PhysicalPlanner
from src.core.application.compiler.validator import GraphValidator
from src.core.domain.execution.execution import Execution
from src.core.domain.execution.status import ExecutionStatus
from src.core.domain.pipeline.version import PipelineVersion
from src.core.infrastructure.execution.cancellation import CancellationToken, interrupt_execution
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
        """Aciona o cancelamento cooperativo e interrupção de conexões ativas para a execução informada."""
        with self._lock:
            interrupt_execution(execution_id)
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
        raw_cells = spec.get("cells", [])
        draft.cells = raw_cells

        # Identifica células inativas (is_active == False) e propaga SKIPPED em cascata
        skipped_cell_ids = set()
        if raw_cells:
            for c in raw_cells:
                cid = c.get("id") or c.get("name")
                if c.get("is_active", True) is False:
                    skipped_cell_ids.add(cid)

            # Propagação em cascata
            changed = True
            while changed:
                changed = False
                for c in raw_cells:
                    cid = c.get("id") or c.get("name")
                    if cid in skipped_cell_ids:
                        continue
                    for pre in (c.get("preconditions") or []):
                        target = pre.get("target_cell_id") or pre.get("targetCellId")
                        if target in skipped_cell_ids:
                            skipped_cell_ids.add(cid)
                            changed = True
                            break

        # Filtra os nós: se pertencerem a uma célula pulada/inativa, são ignorados no plano compilado
        nodes_to_compile = []
        for n in spec.get("nodes", []):
            node_cell = n.get("cellId") or n.get("cell_id") or (n.get("config") or {}).get("cellId")
            if node_cell and node_cell in skipped_cell_ids:
                continue
            nodes_to_compile.append(n)

        active_node_ids = {n["id"] for n in nodes_to_compile}

        for n in nodes_to_compile:
            comp = n.get("component", {})
            draft.add_node(
                node_id=n["id"],
                component_type=comp.get("type", "generic"),
                component_version=SemanticVersion.parse(comp.get("version", "1.0.0")),
                config=n.get("config", {})
            )
        for e in spec.get("edges", []):
            from_port = PortId.parse(e["from"])
            to_port = PortId.parse(e["to"])
            if from_port.node_id in active_node_ids and to_port.node_id in active_node_ids:
                draft.connect_ports(from_port, to_port)

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

    def orchestrate_cells(
        self,
        execution: Execution,
        cells: List[Dict[str, Any]],
        token: Optional[CancellationToken] = None
    ) -> Dict[str, str]:
        """Orquestra a execução das células do Job (Multi-Canvas / Python),

        respeitando ordenação, pré-condições, flag `is_active` e propagação de `SKIPPED` em cascata.
        """
        token = token or CancellationToken()
        completed_statuses: Dict[str, str] = {}

        # Agrupa células por order
        order_groups: Dict[int, List[Dict[str, Any]]] = {}
        for cell in cells:
            order = int(cell.get("order", 1))
            order_groups.setdefault(order, []).append(cell)

        sorted_orders = sorted(order_groups.keys())

        for order in sorted_orders:
            token.check_cancelled()
            group_cells = order_groups[order]

            for cell in group_cells:
                token.check_cancelled()
                cid = cell.get("id") or cell.get("name", "cell")
                cname = cell.get("name", cid)
                is_active = cell.get("is_active", True)

                # 1. Intercepta célula desativada (is_active == False)
                if not is_active:
                    completed_statuses[cid] = "skipped"
                    completed_statuses[cname] = "skipped"
                    task = execution.tasks.get(cid) or execution.add_task(cid)
                    task.status = ExecutionStatus.SKIPPED
                    self.log(
                        execution.id,
                        "INFO",
                        f"Célula '{cname}' desativada (is_active=False). Status marcado como SKIPPED.",
                        node_id=cid
                    )
                    continue

                # 2. Avaliação de Pré-condições com Cascata de Falhas / Skipped
                preconditions = cell.get("preconditions") or []
                op = str(cell.get("precondition_operator") or cell.get("preconditionOperator") or "AND").upper()
                can_run = True

                if preconditions:
                    pre_results: List[bool] = []
                    for pre in preconditions:
                        target = pre.get("target_cell_id") or pre.get("targetCellId")
                        expected = str(pre.get("expected_status") or pre.get("expectedStatus") or "OK").upper()
                        target_status = completed_statuses.get(target)

                        # Se o target foi SKIPPED ou não executou, a dependência quebra a cadeia
                        if not target_status or target_status == "skipped":
                            pre_results.append(False)
                        elif expected == "OK" and target_status == "success":
                            pre_results.append(True)
                        elif expected == "ERROR" and target_status == "failed":
                            pre_results.append(True)
                        else:
                            pre_results.append(False)

                    can_run = any(pre_results) if op == "OR" else all(pre_results)

                if not can_run:
                    completed_statuses[cid] = "skipped"
                    completed_statuses[cname] = "skipped"
                    task = execution.tasks.get(cid) or execution.add_task(cid)
                    task.status = ExecutionStatus.SKIPPED
                    self.log(
                        execution.id,
                        "WARN",
                        f"Célula '{cname}' pulada (SKIPPED) por não atender pré-condições de células upstream.",
                        node_id=cid
                    )
                    continue

                # 3. Execução da célula ativa
                task = execution.tasks.get(cid) or execution.add_task(cid)
                task.status = ExecutionStatus.RUNNING
                self.log(execution.id, "INFO", f"Iniciando execução da célula '{cname}'...", node_id=cid)

                try:
                    self._execute_single_cell(cell, execution, token)
                    task.status = ExecutionStatus.SUCCEEDED
                    completed_statuses[cid] = "success"
                    completed_statuses[cname] = "success"
                    self.log(execution.id, "INFO", f"Célula '{cname}' finalizada com SUCESSO.", node_id=cid)
                except Exception as err:
                    task.status = ExecutionStatus.FAILED
                    task.error_message = str(err)
                    completed_statuses[cid] = "failed"
                    completed_statuses[cname] = "failed"
                    self.log(execution.id, "ERROR", f"Célula '{cname}' FALHOU: {err}", node_id=cid)

        return completed_statuses

    def _execute_single_cell(
        self,
        cell: Dict[str, Any],
        execution: Execution,
        token: CancellationToken
    ) -> None:
        """Executa uma única célula isolada (Canvas ou Python)."""
        token.check_cancelled()
        cell_type = str(cell.get("cell_type") or cell.get("cellType") or "CANVAS").upper()

        if cell_type == "PYTHON":
            from src.core.infrastructure.engines.python_cell_runner import PythonCellContext, PythonCellRunner
            runner = PythonCellRunner()
            cid = cell.get("id") or cell.get("name", "python-cell")
            cname = cell.get("name", cid)
            context = PythonCellContext(
                cell_id=cid,
                cell_name=cname,
                job_id=execution.id,
                preceding_cell_ids=[
                    p.get("target_cell_id") or p.get("targetCellId")
                    for p in (cell.get("preconditions") or [])
                    if p.get("target_cell_id") or p.get("targetCellId")
                ]
            )
            code = cell.get("code_snippet") or cell.get("codeSnippet") or ""
            res = runner.execute_code(code, context)
            if not res.get("success", False):
                raise RuntimeError(res.get("error") or "Erro na execução da célula Python")
        else:
            # Canvas Cell
            pass

