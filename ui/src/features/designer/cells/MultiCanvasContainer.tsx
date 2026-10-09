import React, { useState, useEffect, useCallback, useRef } from "react";
import { Node, Edge } from "reactflow";
import {
  Plus,
  Play,
  Square,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  RefreshCw,
} from "lucide-react";

import { CanvasCellCard } from "./CanvasCellCard";
import {
  jobStore,
  CanvasCellData,
  JobData,
  CellExecutionStatus,
  evaluateCellPreconditions,
  detectCellCycles,
  validateParallelCellConsistency,
} from "../../../store/jobStore";
import { CanvasNodeData } from "../../../types";

interface MultiCanvasContainerProps {
  job: JobData;
  onSelectNode: (node: Node<CanvasNodeData> | null) => void;
  onDoubleClickNode?: (node: Node<CanvasNodeData>) => void;
  onRunEntireJob?: () => void;
  onStopJob?: () => void;
  onExecuteCellIsolated?: (cell: CanvasCellData) => Promise<boolean>;
  onStopCellIsolated?: (cell: CanvasCellData) => void;
  showToast?: (type: "success" | "error" | "info", msg: string) => void;
}

export const MultiCanvasContainer: React.FC<MultiCanvasContainerProps> = ({
  job,
  onSelectNode,
  onDoubleClickNode,
  onRunEntireJob,
  onStopJob,
  onExecuteCellIsolated,
  onStopCellIsolated,
  showToast,
}) => {
  const [focusCellId, setFocusCellId] = useState<string | null>(null);
  const [activeCellId, setActiveCellId] = useState<string>(
    job.activeCellId || job.cells?.[0]?.id || "canvas-cell-01"
  );
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const cancelOrchestrationRef = useRef(false);

  const cells = job.cells && job.cells.length > 0 ? job.cells : [];

  // Sort cells by order
  const sortedCells = [...cells].sort((a, b) => a.order - b.order);

  // Sync active cell if current one was removed
  useEffect(() => {
    if (cells.length > 0 && !cells.some((c) => c.id === activeCellId)) {
      setActiveCellId(cells[0].id);
    }
  }, [cells, activeCellId]);

  // Sync focus cell if removed
  useEffect(() => {
    if (focusCellId && !cells.some((c) => c.id === focusCellId)) {
      setFocusCellId(null);
    }
  }, [cells, focusCellId]);

  // ─── Cell Operations ──────────────────────────────────────────

  const handleAddCell = () => {
    const newCell = jobStore.createCell(job.id);
    if (newCell) {
      setActiveCellId(newCell.id);
      showToast?.("success", `Nova célula "${newCell.name}" adicionada ao Job!`);
    }
  };

  const handleRenameCell = (oldName: string, newName: string) => {
    jobStore.renameCell(job.id, oldName, newName);
    showToast?.("info", `Célula renomeada para "${newName}" (referências atualizadas)`);
  };

  const handleUpdateCellMeta = (cellId: string, updates: Partial<CanvasCellData>) => {
    jobStore.updateCell(job.id, cellId, updates);
  };

  const handleDeleteCell = (cellId: string) => {
    const success = jobStore.deleteCell(job.id, cellId);
    if (success) {
      showToast?.("info", "Célula removida com sucesso");
    }
  };

  const handleDuplicateCell = (cellId: string) => {
    const duplicated = jobStore.duplicateCell(job.id, cellId);
    if (duplicated) {
      showToast?.("success", `Célula duplicada: "${duplicated.name}"`);
    }
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const targetCell = sortedCells[index];
    const prevCell = sortedCells[index - 1];
    jobStore.updateCell(job.id, targetCell.id, { order: prevCell.order });
    jobStore.updateCell(job.id, prevCell.id, { order: targetCell.order });
  };

  const handleMoveDown = (index: number) => {
    if (index >= sortedCells.length - 1) return;
    const targetCell = sortedCells[index];
    const nextCell = sortedCells[index + 1];
    jobStore.updateCell(job.id, targetCell.id, { order: nextCell.order });
    jobStore.updateCell(job.id, nextCell.id, { order: targetCell.order });
  };

  const handleToggleFocus = (cellId: string) => {
    if (focusCellId === cellId) {
      setFocusCellId(null);
    } else {
      setFocusCellId(cellId);
      setActiveCellId(cellId);
    }
  };

  const handleUpdateGraph = (cellId: string, nodes: Node<CanvasNodeData>[], edges: Edge[]) => {
    jobStore.saveCellGraph(job.id, cellId, nodes, edges);
  };

  // ─── Single Cell Run (Isolated) ───────────────────────────────

  const handleRunSingleCell = async (cell: CanvasCellData) => {
    jobStore.setCellStatus(job.id, cell.id, "running");
    showToast?.("info", `Executando célula isolada: ${cell.name}...`);

    try {
      if (onExecuteCellIsolated) {
        const ok = await onExecuteCellIsolated(cell);
        jobStore.setCellStatus(job.id, cell.id, ok ? "success" : "failed");
        if (ok) {
          showToast?.("success", `Célula "${cell.name}" concluída com sucesso! (Saída em memória disponível)`);
        } else {
          showToast?.("error", `Célula "${cell.name}" falhou durante a execução.`);
        }
      } else {
        // Local simulation fallback
        await new Promise((res) => setTimeout(res, 800));
        jobStore.setCellStatus(job.id, cell.id, "success");
        showToast?.("success", `Célula "${cell.name}" executada com sucesso!`);
      }
    } catch (err: any) {
      jobStore.setCellStatus(job.id, cell.id, "failed");
      showToast?.("error", `Erro na execução da célula "${cell.name}": ${err.message}`);
    }
  };

  const handleStopSingleCell = (cell: CanvasCellData) => {
    if (onStopCellIsolated) {
      onStopCellIsolated(cell);
    }
    jobStore.setCellStatus(job.id, cell.id, "cancelled");
    showToast?.("info", `Execução da célula "${cell.name}" interrompida.`);
  };

  // ─── Orchestrated Job Run & Stop (Multi-Cell Mesh Execution) ─────────

  const handleStopOrchestrated = () => {
    cancelOrchestrationRef.current = true;
    if (onStopJob) {
      onStopJob();
    }
    // Cancel queued / running cells
    sortedCells.forEach((c) => {
      if (c.status === "queued") {
        jobStore.setCellStatus(job.id, c.id, "skipped");
      } else if (c.status === "running") {
        jobStore.setCellStatus(job.id, c.id, "cancelled");
      }
    });
    setIsOrchestrating(false);
    showToast?.("info", "Orquestração do Job interrompida pelo usuário.");
  };

  const handleRunOrchestrated = async () => {
    if (isOrchestrating) return;

    // Check for macro cycles
    const cycles = detectCellCycles(sortedCells);
    if (cycles) {
      showToast?.(
        "error",
        `Impossível executar: Ciclo detectado nas dependências das células (${cycles.join(", ")})`
      );
      return;
    }

    // Check for parallel order consistency (cells with same order cannot depend on each other)
    const orderErrors = validateParallelCellConsistency(sortedCells);
    if (orderErrors && orderErrors.length > 0) {
      showToast?.("error", `Impossível executar: ${orderErrors[0]}`);
      return;
    }

    cancelOrchestrationRef.current = false;
    setIsOrchestrating(true);
    showToast?.("info", `Iniciando orquestração completa do Job (${sortedCells.length} células)...`);

    // Reset status to queued
    sortedCells.forEach((c) => jobStore.setCellStatus(job.id, c.id, "queued"));

    const completedStatuses: Record<string, "success" | "failed" | "skipped" | "cancelled"> = {};

    // Group cells by execution order
    const orderGroups = new Map<number, CanvasCellData[]>();
    sortedCells.forEach((c) => {
      const group = orderGroups.get(c.order) || [];
      group.push(c);
      orderGroups.set(c.order, group);
    });

    const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);

    try {
      for (const orderNum of sortedOrders) {
        if (cancelOrchestrationRef.current) {
          showToast?.("info", "Orquestração do Job interrompida.");
          break;
        }

        const parallelCells = orderGroups.get(orderNum) || [];

        // Safe Parallel Execution for cells with the same order
        await Promise.all(
          parallelCells.map(async (cell) => {
            if (cancelOrchestrationRef.current) {
              jobStore.setCellStatus(job.id, cell.id, "skipped");
              completedStatuses[cell.id] = "skipped";
              completedStatuses[cell.name] = "skipped";
              return;
            }

            const canRun = evaluateCellPreconditions(cell, completedStatuses as any, sortedCells);

            if (!canRun) {
              jobStore.setCellStatus(job.id, cell.id, "skipped");
              completedStatuses[cell.id] = "skipped";
              completedStatuses[cell.name] = "skipped";
              return;
            }

            jobStore.setCellStatus(job.id, cell.id, "running");

            try {
              if (onExecuteCellIsolated) {
                const ok = await onExecuteCellIsolated(cell);
                if (cancelOrchestrationRef.current) {
                  jobStore.setCellStatus(job.id, cell.id, "cancelled");
                  completedStatuses[cell.id] = "cancelled";
                  completedStatuses[cell.name] = "cancelled";
                  return;
                }
                const finalStatus = ok ? "success" : "failed";
                jobStore.setCellStatus(job.id, cell.id, finalStatus);
                completedStatuses[cell.id] = finalStatus;
                completedStatuses[cell.name] = finalStatus;
              } else {
                // Simulation delay
                await new Promise((res) => setTimeout(res, 600));
                if (cancelOrchestrationRef.current) {
                  jobStore.setCellStatus(job.id, cell.id, "cancelled");
                  completedStatuses[cell.id] = "cancelled";
                  completedStatuses[cell.name] = "cancelled";
                  return;
                }
                jobStore.setCellStatus(job.id, cell.id, "success");
                completedStatuses[cell.id] = "success";
                completedStatuses[cell.name] = "success";
              }
            } catch {
              jobStore.setCellStatus(job.id, cell.id, "failed");
              completedStatuses[cell.id] = "failed";
              completedStatuses[cell.name] = "failed";
            }
          })
        );
      }

      if (cancelOrchestrationRef.current) {
        showToast?.("info", "Orquestração cancelada pelo usuário.");
      } else {
        const totalFailed = Object.values(completedStatuses).filter((s) => s === "failed").length;
        const totalSkipped = Object.values(completedStatuses).filter((s) => s === "skipped").length;
        const totalSuccess = Object.values(completedStatuses).filter((s) => s === "success").length;

        if (totalFailed > 0) {
          showToast?.("error", `Orquestração finalizada com falhas: ${totalSuccess} sucesso, ${totalFailed} falhas, ${totalSkipped} puladas.`);
        } else {
          showToast?.("success", `Orquestração do Job finalizada com sucesso! (${totalSuccess} células executadas)`);
        }
      }
    } finally {
      setIsOrchestrating(false);
    }
  };

  // If focus mode is active, find the focused cell
  const focusedCell = focusCellId
    ? sortedCells.find((c) => c.id === focusCellId) || sortedCells[0]
    : null;

  return (
    <div
      className="multi-canvas-wrapper"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg-canvas)",
        overflow: "hidden",
      }}
    >
      {/* ─── Top Multi-Canvas Toolbar ────────────────────────── */}
      <div
        className="multi-canvas-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 16px",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-subtle)",
          zIndex: 10,
        }}
      >
        {/* Left: View Mode info & Count */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Layers size={15} color="var(--accent-cyan)" />
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
              {focusedCell ? `Modo Foco: ${focusedCell.name}` : "Multi-Canvas (Sequência de Células)"}
            </span>
          </div>

          <span
            className="badge"
            style={{
              fontSize: "0.7rem",
              background: "rgba(6, 182, 212, 0.1)",
              borderColor: "rgba(6, 182, 212, 0.25)",
              color: "var(--accent-cyan)",
            }}
          >
            {cells.length} Célula{cells.length === 1 ? "" : "s"}
          </span>

          {focusedCell && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "0.72rem", padding: "3px 9px", color: "var(--accent-cyan)" }}
              onClick={() => setFocusCellId(null)}
            >
              <Minimize2 size={12} /> Sair do Modo Foco
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Reset Status Options */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "0.74rem", padding: "4px 9px", color: "#fbbf24", borderColor: "rgba(245, 158, 11, 0.3)" }}
              onClick={() => {
                jobStore.resetCellStatus(job.id, activeCellId);
                showToast?.("info", `Status da célula "${sortedCells.find((c) => c.id === activeCellId)?.name || activeCellId}" resetado.`);
              }}
              title="Resetar status da célula ativa para idle"
            >
              <RotateCcw size={12} />
              <span>Reset Ativa</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "0.74rem", padding: "4px 9px", color: "#fbbf24", borderColor: "rgba(245, 158, 11, 0.3)" }}
              onClick={() => {
                jobStore.resetAllCellsStatus(job.id);
                showToast?.("info", "Status de todas as células resetado.");
              }}
              title="Resetar status de todas as células do Job para idle"
            >
              <RefreshCw size={12} />
              <span>Reset Todas</span>
            </button>
          </div>

          {/* Add Cell Button */}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.76rem", padding: "4px 11px" }}
            onClick={handleAddCell}
            title="Adicionar nova etapa (canvas-cell) ao Job"
          >
            <Plus size={13} />
            <span>Nova Canvas-Cell</span>
          </button>

          {/* Orchestrated Run / Stop Button */}
          {isOrchestrating ? (
            <button
              type="button"
              className="btn btn-danger"
              style={{
                fontSize: "0.76rem",
                padding: "4px 12px",
                gap: 6,
                background: "rgba(239, 68, 68, 0.25)",
                borderColor: "var(--status-danger)",
                color: "var(--status-danger)",
              }}
              onClick={handleStopOrchestrated}
              title="Parar a execução do Job imediatamente"
            >
              <Square size={12} fill="currentColor" />
              <span>Parar Job</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-success"
              style={{ fontSize: "0.76rem", padding: "4px 12px", gap: 6 }}
              onClick={handleRunOrchestrated}
              title="Executa todas as células respeitando ordens, pré-condições e isolamento de escrita DuckDB"
            >
              <Play size={12} fill="currentColor" />
              <span>Executar Job Orquestrado</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Cell View Area ──────────────────────────────────── */}
      <div
        className="multi-canvas-scroll-area"
        style={{
          flex: 1,
          overflowY: focusedCell ? "hidden" : "auto",
          padding: focusedCell ? 0 : 16,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {focusedCell ? (
          // ─── Focus Mode: Single Expanded Cell ───────────────
          <div style={{ height: "100%", width: "100%" }}>
            <CanvasCellCard
              key={focusedCell.id}
              cell={focusedCell}
              allCells={sortedCells}
              isFocusMode={true}
              isActive={true}
              canDelete={sortedCells.length > 1}
              onSelectCell={setActiveCellId}
              onUpdateGraph={handleUpdateGraph}
              onRenameCell={handleRenameCell}
              onUpdateCellMeta={handleUpdateCellMeta}
              onDeleteCell={handleDeleteCell}
              onDuplicateCell={handleDuplicateCell}
              onToggleFocus={handleToggleFocus}
              onRunSingleCell={handleRunSingleCell}
              onStopSingleCell={handleStopSingleCell}
              onResetStatus={(cellId) => {
                jobStore.resetCellStatus(job.id, cellId);
                showToast?.("info", "Status da célula resetado.");
              }}
              onSelectNode={onSelectNode}
              onDoubleClickNode={onDoubleClickNode}
            />
          </div>
        ) : (
          // ─── Default / Medium View: Scrollable Cards ─────────
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sortedCells.map((cell, idx) => (
              <CanvasCellCard
                key={cell.id}
                cell={cell}
                allCells={sortedCells}
                isFocusMode={false}
                isActive={activeCellId === cell.id}
                canDelete={sortedCells.length > 1}
                onSelectCell={setActiveCellId}
                onUpdateGraph={handleUpdateGraph}
                onRenameCell={handleRenameCell}
                onUpdateCellMeta={handleUpdateCellMeta}
                onDeleteCell={handleDeleteCell}
                onDuplicateCell={handleDuplicateCell}
                onMoveUp={idx > 0 ? () => handleMoveUp(idx) : undefined}
                onMoveDown={idx < sortedCells.length - 1 ? () => handleMoveDown(idx) : undefined}
                onToggleFocus={handleToggleFocus}
                onRunSingleCell={handleRunSingleCell}
                onStopSingleCell={handleStopSingleCell}
                onResetStatus={(cellId) => {
                  jobStore.resetCellStatus(job.id, cellId);
                  showToast?.("info", "Status da célula resetado.");
                }}
                onSelectNode={onSelectNode}
                onDoubleClickNode={onDoubleClickNode}
              />
            ))}

            {/* Bottom Add Cell Quick Bar */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "16px 0 24px",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  borderStyle: "dashed",
                  padding: "8px 20px",
                  fontSize: "0.8rem",
                  borderColor: "var(--border-subtle)",
                }}
                onClick={handleAddCell}
              >
                <Plus size={14} /> Adicionar Próxima Canvas-Cell
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
