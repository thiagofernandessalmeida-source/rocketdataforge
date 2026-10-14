import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
} from "reactflow";
import {
  Zap,
  Search,
  ArrowRight,
  AlertCircle,
  Edit2,
  Check,
  X,
  Trash2,
  Repeat,
} from "lucide-react";
import {
  FlowType,
  FLOW_CONFIG,
  isFlowNameUnique,
} from "../utils/flowNaming";

export interface FlowEdgeData {
  flowName: string;
  flowType: FlowType;
  sourceLabel?: string;
  targetLabel?: string;
}

export const FlowEdge: React.FC<EdgeProps<FlowEdgeData>> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  label,
  selected,
}) => {
  const { setEdges, getEdges, getNodes } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const flowName = data?.flowName || (typeof label === "string" ? label : "") || "main1";
  const flowType: FlowType = data?.flowType || (flowName.startsWith("iterate") ? "iterate" : flowName.startsWith("lkp") ? "lkp" : flowName.startsWith("out") ? "out" : flowName.startsWith("reject") ? "reject" : "main");
  const meta = FLOW_CONFIG[flowType] || FLOW_CONFIG.main;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(flowName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditText(flowName);
  }, [flowName]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Resolve source and target node labels
  const allNodes = getNodes();
  const sourceNode = allNodes.find((n) => n.id === source);
  const targetNode = allNodes.find((n) => n.id === target);
  const sourceLabel = data?.sourceLabel || sourceNode?.data?.label || source;
  const targetLabel = data?.targetLabel || targetNode?.data?.label || target;

  // ─── Salvar Novo Nome do Fluxo ─────────────────────────────────
  const handleSaveName = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditText(flowName);
      setIsEditing(false);
      setErrorMessage(null);
      return;
    }

    if (trimmed.toLowerCase() === flowName.toLowerCase()) {
      setIsEditing(false);
      setErrorMessage(null);
      return;
    }

    const edges = getEdges();
    if (!isFlowNameUnique(trimmed, edges, id)) {
      setErrorMessage(`O nome "${trimmed}" já está em uso em outro fluxo deste job.`);
      setTimeout(() => setErrorMessage(null), 3500);
      return;
    }

    // Atualiza a aresta
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === id) {
          return {
            ...e,
            label: trimmed,
            data: {
              ...e.data,
              flowName: trimmed,
              flowType: e.data?.flowType || flowType,
            },
          };
        }
        return e;
      })
    );

    setIsEditing(false);
    setErrorMessage(null);
  }, [editText, flowName, getEdges, id, setEdges, flowType]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditText(flowName);
      setIsEditing(false);
      setErrorMessage(null);
    }
  };

  const handleDeleteEdge = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  };

  const getFlowIcon = () => {
    switch (flowType) {
      case "iterate":
        return <Repeat size={11} color={meta.badgeColor} />;
      case "main":
        return <Zap size={11} color={meta.badgeColor} />;
      case "lkp":
        return <Search size={11} color={meta.badgeColor} />;
      case "out":
        return <ArrowRight size={11} color={meta.badgeColor} />;
      case "reject":
        return <AlertCircle size={11} color={meta.badgeColor} />;
      default:
        return <Zap size={11} color={meta.badgeColor} />;
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? "var(--accent-cyan)" : meta.strokeColor,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: flowType === "iterate" ? "6, 4" : undefined,
          animation: flowType === "iterate" ? "flow-iterate-dash 1s linear infinite" : undefined,
          transition: "stroke 0.2s, stroke-width 0.2s",
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            zIndex: isEditing ? 1000 : 10,
          }}
          className="flow-edge-renderer"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {isEditing ? (
            <div className="flow-edge-edit-box">
              <input
                ref={inputRef}
                className="flow-edge-input"
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveName}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className="flow-edge-btn save"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveName();
                }}
                title="Salvar nome"
              >
                <Check size={11} />
              </button>
              <button
                className="flow-edge-btn cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditText(flowName);
                  setIsEditing(false);
                  setErrorMessage(null);
                }}
                title="Cancelar"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <div
              className={`flow-edge-badge ${flowType} ${selected ? "selected" : ""}`}
              style={{
                background: meta.badgeBg,
                borderColor: selected ? "var(--accent-cyan)" : meta.badgeBorder,
                color: meta.badgeColor,
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
            >
              <span className="flow-badge-icon">{getFlowIcon()}</span>
              <span className="flow-badge-name">{flowName}</span>
              <button
                className="flow-badge-edit-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                title="Renomear fluxo (duplo-clique)"
              >
                <Edit2 size={9} opacity={0.6} />
              </button>
            </div>
          )}

          {/* Mensagem de Erro de Validação de Unicidade */}
          {errorMessage && (
            <div className="flow-edge-error-toast" onClick={(e) => e.stopPropagation()}>
              <AlertCircle size={12} color="var(--status-danger)" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Hover Tooltip com detalhes do fluxo */}
          {showTooltip && !isEditing && !errorMessage && (
            <div className="flow-edge-hover-tooltip" onClick={(e) => e.stopPropagation()}>
              <div className="flow-tooltip-title" style={{ color: meta.badgeColor }}>
                {getFlowIcon()}
                <span>{meta.displayTitle}: <strong>{flowName}</strong></span>
              </div>
              <div className="flow-tooltip-route">
                <span className="source-label">{sourceLabel}</span>
                <span className="route-arrow">→</span>
                <span className="target-label">{targetLabel}</span>
              </div>
              <div className="flow-tooltip-hint">
                Duplo clique para renomear este fluxo
              </div>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
