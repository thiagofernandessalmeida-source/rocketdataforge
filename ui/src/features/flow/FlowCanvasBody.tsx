import React from "react";
import { Layers, Database, ArrowRight, Filter, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface FlowCanvasBodyProps {
  cellId: string;
  nodes?: any[];
  onFocusNode: (nodeId: string, cellId: string) => void;
}

export const FlowCanvasBody: React.FC<FlowCanvasBodyProps> = ({
  cellId,
  nodes = [],
  onFocusNode,
}) => {
  if (!nodes || nodes.length === 0) {
    return (
      <div
        style={{
          padding: "16px",
          textAlign: "center",
          color: "var(--text-muted, #94a3b8)",
          fontSize: "0.78rem",
          fontStyle: "italic",
        }}
      >
        Nenhum componente nesta célula Canvas.
      </div>
    );
  }

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case "source":
        return <Database size={13} color="var(--flow-main, #60a5fa)" />;
      case "transform":
        return <Filter size={13} color="var(--flow-lkp, #c4b0fb)" />;
      case "target":
        return <ArrowRight size={13} color="var(--flow-out, #5eead4)" />;
      default:
        return <Layers size={13} color="var(--text-muted, #94a3b8)" />;
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "running":
        return <Loader2 size={12} className="spin" color="var(--accent-cyan, #38bdf8)" />;
      case "success":
        return <CheckCircle2 size={12} color="var(--status-success, #10b981)" />;
      case "failed":
        return <AlertCircle size={12} color="var(--status-danger, #ef4444)" />;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        padding: "8px 12px",
        maxHeight: "340px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        background: "rgba(0, 0, 0, 0.2)",
      }}
      role="list"
      aria-label="Componentes da célula"
    >
      {nodes.map((node, idx) => {
        const label = node.data?.label || node.id || `Componente ${idx + 1}`;
        const compType = node.data?.componentType || "Desconhecido";
        const category = node.data?.category || "transform";
        const status = node.data?.status;

        return (
          <div
            key={node.id || idx}
            role="listitem"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 8px",
              background: "var(--bg-card, #1e293b)",
              borderRadius: "4px",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s",
              userSelect: "none",
            }}
            title="Duplo clique para focar este componente no Canvas"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onFocusNode(node.id, cellId);
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: "rgba(255, 255, 255, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {getCategoryIcon(category)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    color: "var(--text-primary, #f8fafc)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "280px",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: "0.64rem",
                    color: "var(--text-muted, #94a3b8)",
                    fontFamily: "monospace",
                  }}
                >
                  {compType}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {getStatusIcon(status)}
              <span
                style={{
                  fontSize: "0.62rem",
                  padding: "1px 5px",
                  borderRadius: "3px",
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "var(--text-muted, #94a3b8)",
                }}
              >
                {category}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
