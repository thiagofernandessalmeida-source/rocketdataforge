import React, { memo, useState, useCallback, useRef } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "reactflow";
import { CanvasNodeData, PortDefinition } from "../../../types";
import { EXPANDED_CATALOG } from "../../../catalog/components";
import { useNodeTelemetry } from "../../../store/telemetryStore";
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
  Clock,
  Activity,
  Zap,
  BarChart2,
} from "lucide-react";

function formatSpeed(rowsPerSec: number): string {
  if (rowsPerSec >= 1_000_000) return `${(rowsPerSec / 1_000_000).toFixed(1)}M/s`;
  if (rowsPerSec >= 1_000) return `${(rowsPerSec / 1_000).toFixed(1)}k/s`;
  return `${rowsPerSec}/s`;
}

interface NodeTelemetryFooterProps {
  nodeId: string;
  fallbackStatus?: string;
  fallbackMetrics?: { rowsIn?: number; rowsOut?: number; durationMs?: number };
}

const NodeTelemetryFooter: React.FC<NodeTelemetryFooterProps> = memo(({
  nodeId,
  fallbackStatus,
  fallbackMetrics,
}) => {
  const telemetry = useNodeTelemetry(nodeId);

  // Determina status ativo: da store reativa ou fallback legado
  let status = telemetry?.status;
  if (!status || status === "idle") {
    if (fallbackStatus === "running") status = "running";
    else if (fallbackStatus === "succeeded") status = "succeeded";
    else if (fallbackStatus === "failed") status = "failed";
    else return null; // Quando não há execução ativa ou métricas, oculta para manter o card limpo
  }

  const rowCount = telemetry
    ? telemetry.rowCount
    : Math.max(fallbackMetrics?.rowsIn || 0, fallbackMetrics?.rowsOut || 0);
  const throughput = telemetry?.throughput || 0;

  return (
    <div className={`rdf-node-telemetry-footer status-${status}`}>
      {/* 1. Status em tempo real */}
      <div className="rdf-telemetry-status-badge">
        {status === "queued" && (
          <>
            <Clock size={11} color="#f59e0b" />
            <span style={{ color: "#f59e0b" }}>Queued</span>
          </>
        )}
        {status === "starting" && (
          <>
            <Loader2 size={11} className="rdf-telemetry-spin" color="#38bdf8" />
            <span style={{ color: "#38bdf8" }}>Starting</span>
          </>
        )}
        {status === "running" && (
          <>
            <Activity size={11} className="rdf-telemetry-pulse" color="#10b981" />
            <span style={{ color: "#10b981" }}>Running</span>
          </>
        )}
        {status === "succeeded" && (
          <>
            <CheckCircle2 size={11} color="#22c55e" />
            <span style={{ color: "#22c55e" }}>Success</span>
          </>
        )}
        {status === "failed" && (
          <>
            <AlertCircle size={11} color="#ef4444" />
            <span style={{ color: "#ef4444" }}>Failed</span>
          </>
        )}
        {status === "cancelled" && (
          <>
            <AlertCircle size={11} color="#94a3b8" />
            <span style={{ color: "#94a3b8" }}>Cancelled</span>
          </>
        )}
      </div>

      {/* 2. Feedback quando status é Starting (esperando retorno do banco) */}
      {status === "starting" && (
        <div className="rdf-telemetry-starting-hint" title="Aguardando retorno da query no banco de dados">
          <span>Consultando DB...</span>
        </div>
      )}

      {/* 3. Métricas de Linhas e Throughput */}
      {(status === "running" || status === "succeeded") && (
        <div className="rdf-telemetry-metrics">
          <span className="rdf-telemetry-rows" title={`Total de linhas: ${rowCount.toLocaleString()}`}>
            {rowCount.toLocaleString()} rows
          </span>

          {throughput > 0 && (
            <span className="rdf-telemetry-throughput" title={`Taxa de transferência: ${throughput.toLocaleString()} rows/sec`}>
              <Zap size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 1 }} />
              {formatSpeed(throughput)}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

NodeTelemetryFooter.displayName = "NodeTelemetryFooter";

function getCategoryIcon(typeId?: string) {
  const safeId = typeId || "";
  if (safeId.includes("control.sync") || safeId.includes("control.barrier") || safeId.includes("control")) return <Clock size={15} color="#10b981" />;
  if (safeId.includes("database.source") || safeId.includes("connector.db")) return <Database size={15} color="#10b981" />;
  if (safeId.includes("file.source")) return <FileText size={15} color="#10b981" />;
  if (safeId.includes("filter")) return <Filter size={15} color="#3b82f6" />;
  if (safeId.includes("aggregate")) return <BarChart2 size={15} color="#06b6d4" />;
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
    case "control":
      return "rgba(16, 185, 129, 0.25)";
    default:
      return "rgba(139, 92, 246, 0.15)";
  }
}

export const GenericNode: React.FC<NodeProps<CanvasNodeData>> = memo(({ id, data, selected, targetPosition, sourcePosition }) => {
  const { setNodes } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [titleText, setTitleText] = useState(data.label || id);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determina orientação dos handles (LR padrão, ou TB no layout vertical)
  const isVertical = (data as any)?.layoutDirection
    ? (data as any).layoutDirection === "TB"
    : targetPosition === Position.Top || sourcePosition === Position.Bottom;
  const inPosition = isVertical ? Position.Top : Position.Left;
  const outPosition = isVertical ? Position.Bottom : Position.Right;

  // Busca descrição no catálogo de componentes
  const catalogComp = EXPANDED_CATALOG.find((c) => c.type_id === data.componentType);
  const compDescription = catalogComp?.description || "Operador de processamento de dados";

  // Componentes de Origem (Source) sempre expõem a porta 'input' para receber
  // arestas de iteração e repetição em loop (tFlowToIterate direto entre inputs)
  const hasDeclaredInput = data.ports?.some((p) => p.direction === "input");
  const inputPorts: PortDefinition[] = hasDeclaredInput
    ? (data.ports?.filter((p) => p.direction === "input") || [])
    : data.category === "source"
    ? [{ name: "input", direction: "input", type: "dataset" }]
    : (data.ports?.filter((p) => p.direction === "input") || []);

  // Pass-through nos Nós de Target (Output):
  // Mesmo componentes de categoria "target" agora podem ter portas de saída ("main" e "reject")
  // permitindo encadeamento contínuo do fluxo de dados estilo Talend
  const hasDeclaredOutput = data.ports?.some((p) => p.direction === "output");
  const outputPorts: PortDefinition[] = hasDeclaredOutput
    ? (data.ports?.filter((p) => p.direction === "output") || [])
    : data.category === "target"
    ? [{ name: "main", direction: "output", type: "dataset" }]
    : [{ name: "main", direction: "output", type: "dataset" }];

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
        const offsetPercent = ((idx + 1) / (inputPorts.length + 1)) * 100;
        const handleStyle: React.CSSProperties = isVertical
          ? { left: `${offsetPercent}%`, top: "-5px", bottom: "auto", right: "auto", transform: "translateX(-50%)" }
          : { top: `${offsetPercent}%`, left: "-5px", right: "auto", bottom: "auto", transform: "translateY(-50%)" };
        return (
          <Handle
            key={`${id}-${port.name}`}
            type="target"
            position={inPosition}
            id={port.name}
            style={handleStyle}
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

      </div>

      {/* ─── Real-time Telemetry Footer ─────────── */}
      <NodeTelemetryFooter
        nodeId={id}
        fallbackStatus={data.status}
        fallbackMetrics={data.metrics}
      />

      {/* Output Handles */}
      {outputPorts.map((port: PortDefinition, idx: number) => {
        const offsetPercent = ((idx + 1) / (outputPorts.length + 1)) * 100;
        const handleStyle: React.CSSProperties = isVertical
          ? { left: `${offsetPercent}%`, bottom: "-5px", top: "auto", right: "auto", transform: "translateX(-50%)" }
          : { top: `${offsetPercent}%`, right: "-5px", left: "auto", bottom: "auto", transform: "translateY(-50%)" };
        return (
          <Handle
            key={`${id}-${port.name}`}
            type="source"
            position={outPosition}
            id={port.name}
            style={handleStyle}
            className={`custom-handle ${
              port.type === "reject" ? "handle-reject" : "handle-dataset"
            }`}
            title={`Output: ${port.name} (${port.type})`}
          />
        );
      })}

      {/* Trigger / OnComponentOk Source Handle (Disponível em nós de Target e Control) */}
      {(data.category === "target" || data.category === "control" || data.componentType?.includes("sync")) && (
        <Handle
          key={`${id}-trigger-out`}
          type="source"
          position={outPosition}
          id="trigger"
          style={
            isVertical
              ? { left: "85%", bottom: "-5px", top: "auto", right: "auto", transform: "translateX(-50%)", background: "#10b981", borderColor: "#059669", borderRadius: 2 }
              : { top: "85%", right: "-5px", left: "auto", bottom: "auto", transform: "translateY(-50%)", background: "#10b981", borderColor: "#059669", borderRadius: 2 }
          }
          className="custom-handle handle-trigger-source"
          title="Gatilho de Execução: OnComponentOk / Trigger (Puxe para ordenar execução)"
        />
      )}

      {/* Trigger / Barrier Target Handle (Para componentes de Controle / Sincronização) */}
      {(data.category === "control" || data.componentType?.includes("sync")) && (
        <Handle
          key={`${id}-trigger-in`}
          type="target"
          position={inPosition}
          id="trigger"
          style={
            isVertical
              ? { left: "15%", top: "-5px", bottom: "auto", right: "auto", transform: "translateX(-50%)", background: "#10b981", borderColor: "#059669", borderRadius: 2 }
              : { top: "15%", left: "-5px", right: "auto", bottom: "auto", transform: "translateY(-50%)", background: "#10b981", borderColor: "#059669", borderRadius: 2 }
          }
          className="custom-handle handle-trigger-target"
          title="Entrada Trigger: Aguarda conclusão dos ramos upstream antes de liberar"
        />
      )}

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
