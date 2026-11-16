import React from "react";
import {
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { FlowLayoutNode } from "./jobFlowLayout";
import { FlowCanvasBody } from "./FlowCanvasBody";
import { FlowPythonBody } from "./FlowPythonBody";

interface FlowCellNodeProps {
  layoutNode: FlowLayoutNode;
  onToggleExpand: (cellId: string) => void;
  onOpenInCanvas: (cellId: string) => void;
  onFocusNode: (nodeId: string, cellId: string) => void;
  onRunSingleCell?: (cellId: string) => void;
  onStopSingleCell?: (cellId: string) => void;
}

export const FlowCellNode: React.FC<FlowCellNodeProps> = ({
  layoutNode,
  onToggleExpand,
  onOpenInCanvas,
  onFocusNode,
  onRunSingleCell,
  onStopSingleCell,
}) => {
  const { id, x, y, w, h, isExpanded, model } = layoutNode;
  const isPython = model.cellType === "PYTHON";
  const status = model.status || "idle";
  const preconditions = model.preconditions || [];
  const hasMultiplePre = preconditions.length > 1;

  const renderStatusBadge = (compact = false) => {
    switch (status) {
      case "running":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--accent-cyan, #38bdf8)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
            }}
          >
            <Loader2 size={11} className="spin" />
            {!compact && "Executando"}
          </span>
        );
      case "success":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(16, 185, 129, 0.15)",
              color: "var(--status-success, #10b981)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
            }}
          >
            <CheckCircle2 size={11} />
            {!compact && "Sucesso"}
          </span>
        );
      case "failed":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(239, 68, 68, 0.15)",
              color: "var(--status-danger, #ef4444)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
            }}
          >
            <AlertCircle size={11} />
            {!compact && "Falha"}
          </span>
        );
      case "cancelled":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(249, 115, 22, 0.15)",
              color: "#f97316",
              border: "1px solid rgba(249, 115, 22, 0.3)",
            }}
          >
            <XCircle size={11} />
            {!compact && "Cancelado"}
          </span>
        );
      case "skipped":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(148, 163, 184, 0.15)",
              color: "var(--text-muted, #94a3b8)",
              border: "1px solid rgba(148, 163, 184, 0.3)",
            }}
          >
            <MinusCircle size={11} />
            {!compact && "Ignorado"}
          </span>
        );
      default:
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.66rem",
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.04)",
              color: "var(--text-muted, #94a3b8)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
            }}
          >
            <Clock size={11} />
            {!compact && "Ocioso"}
          </span>
        );
    }
  };

  // Se estiver recolhido (Ícone UC4 Automic / JOBP)
  if (!isExpanded) {
    return (
      <div
        style={{
          position: "absolute",
          left: `${x}px`,
          top: `${y}px`,
          width: `${w}px`,
          height: `${h}px`,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          aria-expanded={false}
          aria-label={`Célula ${model.name}, Ordem ${model.order}`}
          title={`Clique para expandir ${model.name}`}
          onClick={() => onToggleExpand(id)}
          style={{
            width: "100%",
            height: "100%",
            background: "var(--bg-card, #1e293b)",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
            borderRadius: "8px",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            cursor: "pointer",
            textAlign: "left",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
            position: "relative",
            transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-cyan, #38bdf8)";
            e.currentTarget.style.transform = "translateY(-2px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-subtle, rgba(255, 255, 255, 0.12))";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          {/* Top Row: Type Avatar & Order Badge */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: isPython ? "rgba(245, 158, 11, 0.2)" : "rgba(56, 189, 248, 0.2)",
                  border: `1.5px solid ${isPython ? "#f59e0b" : "#38bdf8"}`,
                  color: isPython ? "#f59e0b" : "#38bdf8",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  userSelect: "none",
                }}
              >
                {isPython ? "P" : "C"}
              </div>
              <span
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  color: "var(--text-muted, #94a3b8)",
                  background: "rgba(255, 255, 255, 0.05)",
                  padding: "1px 5px",
                  borderRadius: 3,
                }}
              >
                #{model.order}
              </span>
            </div>

            {/* Operator AND/OR Badge if > 1 precondition */}
            {hasMultiplePre && (
              <span
                style={{
                  fontSize: "0.62rem",
                  fontWeight: 800,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: model.preconditionOperator === "OR" ? "rgba(234, 179, 8, 0.2)" : "rgba(56, 189, 248, 0.2)",
                  color: model.preconditionOperator === "OR" ? "#eab308" : "#38bdf8",
                  border: `1px solid ${model.preconditionOperator === "OR" ? "#eab308" : "#38bdf8"}`,
                }}
                title={`Operador lógico de pré-condições: ${model.preconditionOperator}`}
              >
                {model.preconditionOperator === "OR" ? "OU" : "E"}
              </span>
            )}
          </div>

          {/* Cell Name */}
          <div
            style={{
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "var(--text-primary, #f8fafc)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              width: "100%",
            }}
            title={model.name}
          >
            {model.name}
          </div>

          {/* Bottom Row: Status Badge & Duration */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              marginTop: 4,
            }}
          >
            {renderStatusBadge()}
            {model.metrics?.durationMs !== undefined && model.metrics.durationMs > 0 && (
              <span
                style={{
                  fontSize: "0.64rem",
                  color: "var(--text-muted, #94a3b8)",
                  fontFamily: "monospace",
                }}
              >
                {model.metrics.durationMs < 1000
                  ? `${model.metrics.durationMs}ms`
                  : `${(model.metrics.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        </button>
      </div>
    );
  }

  // Se estiver expandido (Card de 540 px)
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
        background: "var(--bg-card, #1e293b)",
        border: "1.5px solid var(--accent-cyan, #38bdf8)",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        zIndex: 20,
        overflow: "hidden",
      }}
      role="region"
      aria-label={`Célula expandida ${model.name}`}
    >
      {/* 4.2 Cabeçalho (52 px) */}
      <div
        style={{
          height: "52px",
          padding: "0 14px",
          background: "var(--bg-surface, #0f172a)",
          borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: isPython ? "rgba(245, 158, 11, 0.2)" : "rgba(56, 189, 248, 0.2)",
              border: `1.5px solid ${isPython ? "#f59e0b" : "#38bdf8"}`,
              color: isPython ? "#f59e0b" : "#38bdf8",
              fontSize: "0.76rem",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {isPython ? "P" : "C"}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  color: "var(--text-muted, #94a3b8)",
                }}
              >
                #{model.order}
              </span>
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: "var(--text-primary, #f8fafc)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "200px",
                }}
                title={model.name}
              >
                {model.name}
              </span>
            </div>
            <div style={{ marginTop: 2 }}>{renderStatusBadge()}</div>
          </div>
        </div>

        {/* Actions Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {status === "running" ? (
            <button
              type="button"
              className="btn btn-danger"
              style={{
                fontSize: "0.7rem",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(239, 68, 68, 0.2)",
                color: "var(--status-danger, #ef4444)",
                borderColor: "var(--status-danger, #ef4444)",
                borderRadius: 4,
                cursor: "pointer",
              }}
              title="Parar a execução desta célula"
              onClick={() => onStopSingleCell?.(id)}
            >
              <Square size={10} fill="currentColor" />
              Parar
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              style={{
                fontSize: "0.7rem",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: "var(--accent-cyan, #38bdf8)",
                borderColor: "rgba(56, 189, 248, 0.3)",
                background: "rgba(56, 189, 248, 0.08)",
                borderRadius: 4,
                cursor: "pointer",
              }}
              title="Executar apenas esta célula"
              onClick={() => onRunSingleCell?.(id)}
            >
              <Play size={10} fill="currentColor" />
              Executar
            </button>
          )}

          <button
            type="button"
            style={{
              fontSize: "0.7rem",
              padding: "3px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-primary, #f8fafc)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: 4,
              cursor: "pointer",
            }}
            title="Abrir e focar esta célula no Canvas"
            aria-label="Abrir célula no Canvas"
            onClick={() => onOpenInCanvas(id)}
          >
            <ExternalLink size={11} />
            Abrir no Canvas
          </button>

          <button
            type="button"
            style={{
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted, #94a3b8)",
              border: "none",
              background: "transparent",
              borderRadius: 4,
              cursor: "pointer",
            }}
            title="Recolher célula"
            aria-expanded={true}
            aria-label="Recolher célula"
            onClick={() => onToggleExpand(id)}
          >
            <ChevronUp size={16} />
          </button>
        </div>
      </div>

      {/* Corpo (Canvas ou Python) */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {isPython ? (
          <FlowPythonBody code={model.codeSnippet} />
        ) : (
          <FlowCanvasBody cellId={id} nodes={model.nodes} onFocusNode={onFocusNode} />
        )}
      </div>

      {/* 4.2 Rodapé (36 px) */}
      <div
        style={{
          height: "36px",
          padding: "0 14px",
          background: "var(--bg-surface, #0f172a)",
          borderTop: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "0.68rem",
          color: "var(--text-muted, #94a3b8)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {model.metrics && (
            <>
              {model.metrics.durationMs !== undefined && (
                <span>Duração: <strong>{model.metrics.durationMs}ms</strong></span>
              )}
              {model.metrics.rowsIn !== undefined && (
                <span>Lidas: <strong>{model.metrics.rowsIn}</strong></span>
              )}
              {model.metrics.rowsOut !== undefined && (
                <span>Gravadas: <strong>{model.metrics.rowsOut}</strong></span>
              )}
            </>
          )}
        </div>

        {preconditions.length > 0 && (
          <span title={`${preconditions.length} pré-condição(ões)`}>
            Pré-condições: <strong>{preconditions.length}</strong> ({model.preconditionOperator})
          </span>
        )}
      </div>
    </div>
  );
};
