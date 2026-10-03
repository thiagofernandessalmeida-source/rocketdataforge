import React, { memo, useState, useCallback, useRef } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "reactflow";
import { CanvasNodeData, PortDefinition } from "../../../types";
import { EXPANDED_CATALOG } from "../../../catalog/components";
import {
  Database,
  FileText,
  Filter,
  Layers,
  GitMerge,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Edit2,
  Info,
} from "lucide-react";

function getCategoryIcon(typeId?: string) {
  const safeId = typeId || "";
  if (safeId.includes("database.source") || safeId.includes("connector.db")) return <Database size={15} color="#10b981" />;
  if (safeId.includes("file.source")) return <FileText size={15} color="#10b981" />;
  if (safeId.includes("filter")) return <Filter size={15} color="#3b82f6" />;
  if (safeId.includes("select")) return <Layers size={15} color="#3b82f6" />;
  if (safeId.includes("join")) return <GitMerge size={15} color="#8b5cf6" />;
  if (safeId.includes("database.target") || safeId.includes(".output")) return <Database size={15} color="#f59e0b" />;
  if (safeId.includes("file.target")) return <HardDrive size={15} color="#f59e0b" />;
  return <Layers size={15} color="#94a3b8" />;
}

function getCategoryBadgeColor(category: string) {
  switch (category) {
    case "source":
      return "rgba(16, 185, 129, 0.15)";
    case "transform":
      return "rgba(59, 130, 246, 0.15)";
    case "target":
      return "rgba(245, 158, 11, 0.15)";
    default:
      return "rgba(139, 92, 246, 0.15)";
  }
}

export const GenericNode: React.FC<NodeProps<CanvasNodeData>> = memo(({ id, data, selected }) => {
  const { setNodes } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [titleText, setTitleText] = useState(data.label || id);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca descrição no catálogo de componentes
  const catalogComp = EXPANDED_CATALOG.find((c) => c.type_id === data.componentType);
  const compDescription = catalogComp?.description || "Operador de processamento de dados";

  const inputPorts = data.ports?.filter((p) => p.direction === "input") || [];
  const outputPorts = data.ports?.filter((p) => p.direction === "output") || [];

  // ─── Salvar renomeação ──────────────────────────────────────
  const handleSaveTitle = useCallback(() => {
    const trimmed = titleText.trim();
    if (!trimmed) {
      setTitleText(data.label || id);
      setIsEditing(false);
      return;
    }
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: trimmed } } : n))
    );
    setIsEditing(false);
  }, [id, titleText, data.label, setNodes]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTitleText(data.label || id);
      setIsEditing(false);
    }
  };

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 450); // delay sutil para não incomodar ao passar rápido o mouse
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setShowTooltip(false);
  };

  return (
    <div
      className={`rdf-node ${selected ? "selected" : ""}`}
      style={{
        borderColor: selected ? "var(--accent-cyan)" : undefined,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Input Handles */}
      {inputPorts.map((port: PortDefinition, idx: number) => {
        const topPercent = ((idx + 1) / (inputPorts.length + 1)) * 100;
        return (
          <Handle
            key={`${id}-${port.name}`}
            type="target"
            position={Position.Left}
            id={port.name}
            style={{ top: `${topPercent}%` }}
            className={`custom-handle ${
              port.type === "reject" ? "handle-reject" : "handle-dataset"
            }`}
            title={`Input: ${port.name} (${port.type})`}
          />
        );
      })}

      {/* Node Header */}
      <div
        className="rdf-node-header"
        style={{
          borderLeft: `3px solid ${
            data.category === "source"
              ? "var(--cat-source)"
              : data.category === "transform"
              ? "var(--cat-transform)"
              : "var(--cat-target)"
          }`,
        }}
      >
        <div className="rdf-node-title" onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>
          {getCategoryIcon(data.componentType)}
          {isEditing ? (
            <input
              className="rdf-node-rename-input"
              value={titleText}
              autoFocus
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span title="Duplo-clique para renomear" style={{ cursor: "text" }}>
              {data.label || id}
            </span>
          )}
          {!isEditing && (
            <button
              className="node-rename-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              title="Renomear componente"
            >
              <Edit2 size={10} opacity={0.6} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {data.status === "running" && (
            <Loader2 size={13} className="badge-running" color="var(--accent-blue)" />
          )}
          {data.status === "succeeded" && (
            <CheckCircle2 size={13} color="var(--status-success)" />
          )}
          {data.status === "failed" && (
            <AlertCircle size={13} color="var(--status-danger)" />
          )}
          <span
            className="badge"
            style={{
              background: getCategoryBadgeColor(data.category),
              fontSize: "0.65rem",
              padding: "1px 6px",
            }}
          >
            {data.category}
          </span>
        </div>
      </div>

      {/* Node Body */}
      <div className="rdf-node-body">
        <div className="rdf-node-meta">ID: {id}</div>
        {data.config && (
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {data.config.connection_ref && `Conn: ${data.config.connection_ref}`}
            {data.config.path && `Path: ${data.config.path.split(/[\\/]/).pop()}`}
            {data.config.expression && `Filter: ${data.config.expression}`}
            {data.config.query && `Query: ${data.config.query.substring(0, 24)}...`}
            {data.config.columns && `Cols: [${data.config.columns.join(", ")}]`}
          </div>
        )}

        {/* Runtime Metrics Display */}
        {data.metrics && (
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.68rem",
              color: "var(--accent-cyan)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span>In: {data.metrics.rowsIn ?? 0}</span>
            <span>Out: {data.metrics.rowsOut ?? 0}</span>
          </div>
        )}
      </div>

      {/* Output Handles */}
      {outputPorts.map((port: PortDefinition, idx: number) => {
        const topPercent = ((idx + 1) / (outputPorts.length + 1)) * 100;
        return (
          <Handle
            key={`${id}-${port.name}`}
            type="source"
            position={Position.Right}
            id={port.name}
            style={{ top: `${topPercent}%` }}
            className={`custom-handle ${
              port.type === "reject" ? "handle-reject" : "handle-dataset"
            }`}
            title={`Output: ${port.name} (${port.type})`}
          />
        );
      })}

      {/* ─── Hover Description Tooltip ─────────────────────────── */}
      {showTooltip && (
        <div className="node-hover-tooltip" onClick={(e) => e.stopPropagation()}>
          <div className="tooltip-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {getCategoryIcon(data.componentType)}
              <span className="tooltip-title">{data.label || catalogComp?.name || id}</span>
            </div>
            <span className="tooltip-type">{data.componentType}</span>
          </div>

          <div className="tooltip-desc">{compDescription}</div>

          <div className="tooltip-meta">
            <div className="tooltip-ports">
              <span>Portas: </span>
              {inputPorts.length > 0 && <span style={{ color: "#38bdf8" }}>{inputPorts.length} In</span>}
              {inputPorts.length > 0 && outputPorts.length > 0 && <span> • </span>}
              {outputPorts.length > 0 && <span style={{ color: "#4ade80" }}>{outputPorts.length} Out</span>}
            </div>
            <div className="tooltip-hint">Duplo clique no nó para abrir janela de configuração</div>
          </div>
        </div>
      )}
    </div>
  );
});

GenericNode.displayName = "GenericNode";
