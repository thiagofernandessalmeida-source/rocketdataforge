import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ReactFlowProvider,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import {
  Play,
  Maximize2,
  Minimize2,
  Settings,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  ShieldCheck,
} from "lucide-react";

import { Canvas } from "../Canvas";
import { CanvasCellData, CellExecutionStatus, CellPrecondition } from "../../../store/jobStore";
import { CanvasNodeData } from "../../../types";
import { CellPreconditionsModal } from "./CellPreconditionsModal";

interface CanvasCellCardProps {
  cell: CanvasCellData;
  allCells: CanvasCellData[];
  isFocusMode: boolean;
  isActive: boolean;
  canDelete: boolean;
  onSelectCell: (cellId: string) => void;
  onUpdateGraph: (cellId: string, nodes: Node<CanvasNodeData>[], edges: Edge[]) => void;
  onRenameCell: (oldIdOrName: string, newName: string) => void;
  onUpdateCellMeta: (cellId: string, updates: Partial<CanvasCellData>) => void;
  onDeleteCell: (cellId: string) => void;
  onDuplicateCell: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleFocus: (cellId: string) => void;
  onRunSingleCell: (cell: CanvasCellData) => void;
  onSelectNode: (node: Node<CanvasNodeData> | null) => void;
  onDoubleClickNode?: (node: Node<CanvasNodeData>) => void;
}

export const CanvasCellCard: React.FC<CanvasCellCardProps> = ({
  cell,
  allCells,
  isFocusMode,
  isActive,
  canDelete,
  onSelectCell,
  onUpdateGraph,
  onRenameCell,
  onUpdateCellMeta,
  onDeleteCell,
  onDuplicateCell,
  onMoveUp,
  onMoveDown,
  onToggleFocus,
  onRunSingleCell,
  onSelectNode,
  onDoubleClickNode,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(cell.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(cell.edges || []);
  const [name, setName] = useState(cell.name);
  const [description, setDescription] = useState(cell.description || "");
  const [showDesc, setShowDesc] = useState(Boolean(cell.description));
  const [showPreconditionsModal, setShowPreconditionsModal] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderInput, setOrderInput] = useState(String(cell.order));

  // Sync internal nodes/edges when cell prop changes externally
  useEffect(() => {
    setNodes(cell.nodes || []);
  }, [cell.nodes, setNodes]);

  useEffect(() => {
    setEdges(cell.edges || []);
  }, [cell.edges, setEdges]);

  useEffect(() => {
    setName(cell.name);
  }, [cell.name]);

  useEffect(() => {
    setDescription(cell.description || "");
    if (cell.description) setShowDesc(true);
  }, [cell.description]);

  useEffect(() => {
    setOrderInput(String(cell.order));
  }, [cell.order]);

  // Propagate graph changes to parent container
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);
      // Inform parent with updated node positions on next tick
      setTimeout(() => {
        setNodes((currentNodes) => {
          onUpdateGraph(cell.id, currentNodes, edges);
          return currentNodes;
        });
      }, 0);
    },
    [onNodesChange, onUpdateGraph, cell.id, edges, setNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChange(changes);
      setTimeout(() => {
        setEdges((currentEdges) => {
          onUpdateGraph(cell.id, nodes, currentEdges);
          return currentEdges;
        });
      }, 0);
    },
    [onEdgesChange, onUpdateGraph, cell.id, nodes, setEdges]
  );

  const handleCommitName = () => {
    const trimmed = name.trim().slice(0, 50);
    if (trimmed && trimmed !== cell.name) {
      onRenameCell(cell.name, trimmed);
    } else {
      setName(cell.name);
    }
  };

  const handleCommitOrder = () => {
    setIsEditingOrder(false);
    const parsed = parseInt(orderInput, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed !== cell.order) {
      onUpdateCellMeta(cell.id, { order: parsed });
    } else {
      setOrderInput(String(cell.order));
    }
  };

  const handleCommitDescription = () => {
    onUpdateCellMeta(cell.id, { description });
  };

  // Status visual attributes
  const statusConfig: Record<
    CellExecutionStatus,
    { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
  > = {
    idle: {
      label: "Idle",
      color: "var(--text-muted)",
      bg: "transparent",
      border: "var(--border-subtle)",
      icon: null,
    },
    queued: {
      label: "Queued",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.12)",
      border: "#f59e0b",
      icon: <Clock size={12} className="spin-slow" />,
    },
    running: {
      label: "Running",
      color: "var(--accent-cyan)",
      bg: "rgba(6, 182, 212, 0.15)",
      border: "var(--accent-cyan)",
      icon: <Loader2 size={12} className="spin" />,
    },
    success: {
      label: "Success",
      color: "var(--status-success)",
      bg: "rgba(16, 185, 129, 0.12)",
      border: "var(--status-success)",
      icon: <CheckCircle2 size={12} />,
    },
    failed: {
      label: "Failed",
      color: "var(--status-danger)",
      bg: "rgba(239, 68, 68, 0.15)",
      border: "var(--status-danger)",
      icon: <AlertCircle size={12} />,
    },
    skipped: {
      label: "Skipped",
      color: "var(--text-dim)",
      bg: "rgba(255, 255, 255, 0.05)",
      border: "var(--border-subtle)",
      icon: null,
    },
  };

  const currentStatus = cell.status || "idle";
  const statusMeta = statusConfig[currentStatus];

  // Card outline glow style
  const getBorderColor = () => {
    if (currentStatus === "running") return "var(--accent-cyan)";
    if (currentStatus === "failed") return "var(--status-danger)";
    if (currentStatus === "success") return "var(--status-success)";
    if (currentStatus === "queued") return "#f59e0b";
    if (isActive) return "rgba(6, 182, 212, 0.4)";
    return "var(--border-medium)";
  };

  const getBoxShadow = () => {
    if (currentStatus === "running") return "0 0 16px rgba(6, 182, 212, 0.35)";
    if (currentStatus === "failed") return "0 0 14px rgba(239, 68, 68, 0.3)";
    if (currentStatus === "success") return "0 0 12px rgba(16, 185, 129, 0.25)";
    if (currentStatus === "queued") return "0 0 10px rgba(245, 158, 11, 0.25)";
    if (isActive) return "0 4px 16px rgba(0, 0, 0, 0.3)";
    return "none";
  };

  return (
    <div
      className={`canvas-cell-container ${isFocusMode ? "focus-mode" : ""} ${
        isActive ? "active-cell" : ""
      }`}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-card)",
        border: `1.5px solid ${getBorderColor()}`,
        borderRadius: isFocusMode ? 0 : 10,
        boxShadow: getBoxShadow(),
        marginBottom: isFocusMode ? 0 : 18,
        height: isFocusMode ? "100%" : 460,
        minHeight: isFocusMode ? "100%" : 380,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        position: "relative",
      }}
      onClick={() => onSelectCell(cell.id)}
    >
      {/* ─── Cell Header ────────────────────────────────────── */}
      <div
        className="canvas-cell-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-subtle)",
          borderTopLeftRadius: isFocusMode ? 0 : 8,
          borderTopRightRadius: isFocusMode ? 0 : 8,
          userSelect: "none",
        }}
      >
        {/* Left: Telemetry Badge + Cell ID/Name + Order */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          {/* Telemetry Status Badge */}
          {currentStatus !== "idle" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "0.7rem",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 12,
                background: statusMeta.bg,
                color: statusMeta.color,
                border: `1px solid ${statusMeta.border}`,
              }}
            >
              {statusMeta.icon}
              {statusMeta.label}
            </span>
          )}

          {/* Execution Order Badge */}
          {isEditingOrder ? (
            <input
              type="number"
              min="1"
              style={{
                width: 48,
                fontSize: "0.72rem",
                padding: "2px 4px",
                background: "var(--bg-card)",
                border: "1px solid var(--accent-cyan)",
                borderRadius: 4,
                color: "var(--text-primary)",
                textAlign: "center",
              }}
              value={orderInput}
              autoFocus
              onChange={(e) => setOrderInput(e.target.value)}
              onBlur={handleCommitOrder}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitOrder();
                if (e.key === "Escape") setIsEditingOrder(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="badge"
              style={{
                cursor: "pointer",
                background: "rgba(79, 142, 247, 0.12)",
                color: "var(--accent-blue)",
                borderColor: "rgba(79, 142, 247, 0.3)",
                fontSize: "0.7rem",
                fontWeight: 600,
                padding: "2px 6px",
              }}
              title="Clique para editar a ordem de execução da célula"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingOrder(true);
              }}
            >
              Ordem: #{cell.order}
            </button>
          )}

          {/* Cell Name (Editable, max 50 chars) */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, maxWidth: 360 }}>
            <Layers size={14} color="var(--accent-cyan)" />
            <input
              className="form-input"
              style={{
                background: "transparent",
                border: "1px solid transparent",
                fontWeight: 600,
                fontSize: "0.85rem",
                color: "var(--text-primary)",
                padding: "2px 6px",
                borderRadius: 4,
                width: "100%",
                maxWidth: 260,
                transition: "border-color 0.15s",
              }}
              value={name}
              maxLength={50}
              placeholder="Nome da Célula"
              title="Clique para editar o nome da célula (máx 50 caracteres)"
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-cyan)")}
              onBlur={(e) => {
                e.target.style.borderColor = "transparent";
                handleCommitName();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          {/* Preconditions summary button */}
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              fontSize: "0.7rem",
              padding: "2px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              borderColor: cell.preconditions?.length ? "var(--accent-cyan)" : undefined,
              color: cell.preconditions?.length ? "var(--accent-cyan)" : undefined,
            }}
            title="Configurar pré-condições de execução desta célula"
            onClick={(e) => {
              e.stopPropagation();
              setShowPreconditionsModal(true);
            }}
          >
            <ShieldCheck size={12} />
            {cell.preconditions?.length
              ? `${cell.preconditions.length} dependência(s) (${cell.preconditionOperator || "AND"})`
              : "Sem dependências"}
          </button>

          {/* Description Toggle */}
          <button
            type="button"
            className={`icon-btn ${showDesc ? "active" : ""}`}
            style={{ padding: "3px 6px" }}
            title="Alternar anotações de negócio"
            onClick={(e) => {
              e.stopPropagation();
              setShowDesc((v) => !v);
            }}
          >
            <FileText size={13} color={showDesc ? "var(--accent-cyan)" : "var(--text-muted)"} />
          </button>
        </div>

        {/* Right: Actions Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Run Single Cell Button */}
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              fontSize: "0.72rem",
              padding: "3px 9px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--status-success)",
              borderColor: "rgba(16, 185, 129, 0.4)",
            }}
            title="Executar apenas esta célula de forma isolada"
            onClick={(e) => {
              e.stopPropagation();
              onRunSingleCell(cell);
            }}
          >
            <Play size={11} fill="currentColor" />
            Executar Célula
          </button>

          {/* Move Up */}
          {onMoveUp && !isFocusMode && (
            <button
              type="button"
              className="icon-btn"
              title="Mover célula para cima"
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
            >
              <ChevronUp size={14} />
            </button>
          )}

          {/* Move Down */}
          {onMoveDown && !isFocusMode && (
            <button
              type="button"
              className="icon-btn"
              title="Mover célula para baixo"
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
            >
              <ChevronDown size={14} />
            </button>
          )}

          {/* Duplicate Cell */}
          <button
            type="button"
            className="icon-btn"
            title="Duplicar célula"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicateCell(cell.id);
            }}
          >
            <Copy size={13} />
          </button>

          {/* Delete Cell */}
          <button
            type="button"
            className="icon-btn danger"
            title={canDelete ? "Excluir célula" : "O job precisa de pelo menos uma célula"}
            disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Deseja excluir a célula "${cell.name}"?`)) {
                onDeleteCell(cell.id);
              }
            }}
          >
            <Trash2 size={13} />
          </button>

          {/* Focus Mode / Maximize Toggle */}
          <button
            type="button"
            className={`icon-btn ${isFocusMode ? "active" : ""}`}
            style={{
              marginLeft: 4,
              background: isFocusMode ? "rgba(6, 182, 212, 0.15)" : undefined,
              borderColor: isFocusMode ? "var(--accent-cyan)" : undefined,
              color: isFocusMode ? "var(--accent-cyan)" : undefined,
            }}
            title={isFocusMode ? "Restaurar Visão Geral" : "Modo Foco (Maximizar Célula)"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFocus(cell.id);
            }}
          >
            {isFocusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Description Area (Business Documentation) */}
      {showDesc && (
        <div
          style={{
            padding: "6px 14px",
            background: "rgba(0, 0, 0, 0.15)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="form-input"
            style={{
              fontSize: "0.75rem",
              padding: "4px 8px",
              background: "transparent",
              border: "1px dashed var(--border-subtle)",
              color: "var(--text-secondary)",
              width: "100%",
            }}
            value={description}
            placeholder="Adicione notas de negócio ou documentação desta etapa..."
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleCommitDescription}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommitDescription();
            }}
          />
        </div>
      )}

      {/* ─── Cell Canvas (Scoped in its own ReactFlowProvider) ─── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <ReactFlowProvider>
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onSelectNode={onSelectNode}
            onDoubleClickNode={onDoubleClickNode}
          />
        </ReactFlowProvider>
      </div>

      {/* Preconditions Modal */}
      {showPreconditionsModal && (
        <CellPreconditionsModal
          cell={cell}
          allCells={allCells}
          onSave={(precs, op) => {
            onUpdateCellMeta(cell.id, {
              preconditions: precs,
              preconditionOperator: op,
            });
          }}
          onClose={() => setShowPreconditionsModal(false)}
        />
      )}
    </div>
  );
};
