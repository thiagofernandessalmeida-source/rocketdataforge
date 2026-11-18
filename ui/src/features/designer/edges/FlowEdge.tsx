import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
import { useEdgeStyle } from "../hooks/useEdgeStyle";
import { computeBusRoutes } from "./busRouter";
import { getFlowStrokeStyle } from "./edgeStyleUtils";
import { FloatingMenu } from "../../../components/common/FloatingMenu";
import { VirtualRect } from "../../../components/common/floatingPosition";

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
  const [edgeStyle] = useEdgeStyle();

  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
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

  // Cálculo de rota ortogonal com barramento (Fase 1 e 2)
  const { effectivePath, effectiveLabelX, effectiveLabelY, junctionPoints } = useMemo(() => {
    if (edgeStyle === "ortogonal") {
      try {
        const allNodes = getNodes();
        const allEdges = getEdges();
        const orientation = sourcePosition === "bottom" || targetPosition === "top" ? "TB" : "LR";
        const nodeRects = allNodes.map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          w: n.width || (n as any).measured?.width || 180,
          h: n.height || (n as any).measured?.height || 72,
        }));
        const routes = computeBusRoutes(allEdges, nodeRects, orientation);
        const myRoute = routes.find((r) => r.edgeId === id);
        if (myRoute && myRoute.svgPath) {
          return {
            effectivePath: myRoute.svgPath,
            effectiveLabelX: myRoute.labelPosition.x,
            effectiveLabelY: myRoute.labelPosition.y,
            junctionPoints: myRoute.junctionPoints || [],
          };
        }
      } catch (_) {}
    }
    return {
      effectivePath: bezierPath,
      effectiveLabelX: bezierLabelX,
      effectiveLabelY: bezierLabelY,
      junctionPoints: [],
    };
  }, [edgeStyle, getNodes, getEdges, sourcePosition, targetPosition, id, bezierPath, bezierLabelX, bezierLabelY]);

  const strokeStyle = getFlowStrokeStyle(flowType, selected);

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

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const menuAnchor = useMemo(
    (): VirtualRect => ({
      left: menuPos.x,
      top: menuPos.y,
      right: menuPos.x,
      bottom: menuPos.y,
      width: 0,
      height: 0,
    }),
    [menuPos.x, menuPos.y]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleDeleteConnection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  }, [id, setEdges]);

  return (
    <>
      {/* Definição de Marcador de Seta com a cor do fluxo (Regra 2.7) */}
      <defs>
        <marker
          id={`flow-marker-${id}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={selected ? "var(--accent-cyan)" : strokeStyle.stroke} />
        </marker>
      </defs>

      {/* Contorno (Halo) de 6px na cor de fundo para separação visual de linhas próximas (Regra 2.4) */}
      <path
        d={effectivePath}
        fill="none"
        stroke="var(--bg-app, #07080f)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      />

      {/* Aresta Principal com traço e cor por tipo (Regra 2.6) */}
      <BaseEdge
        id={id}
        path={effectivePath}
        markerEnd={markerEnd || `url(#flow-marker-${id})`}
        interactionWidth={20}
        style={{
          ...style,
          stroke: strokeStyle.stroke,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: flowType === "iterate" ? "9 3 2 3" : strokeStyle.strokeDasharray,
          strokeLinecap: strokeStyle.strokeLinecap,
          animation: flowType === "iterate" ? "flow-iterate-dash 1s linear infinite" : undefined,
          transition: "stroke 0.2s, stroke-width 0.2s",
        }}
      />

      {/* Pontos de Junção no início do tronco quando há múltiplas saídas (Regra 1.3 e 2.7) */}
      {junctionPoints.map((jp, i) => (
        <circle
          key={`jp-${id}-${i}`}
          cx={jp.x}
          cy={jp.y}
          r={3.5}
          fill={selected ? "var(--accent-cyan)" : strokeStyle.stroke}
          stroke="var(--bg-app, #07080f)"
          strokeWidth={1}
          style={{ pointerEvents: "none" }}
        />
      ))}

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${effectiveLabelX}px,${effectiveLabelY}px)`,
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
              onContextMenu={handleContextMenu}
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

      {/* Menu de Contexto da Aresta: Excluir Conexão (RF-02.3 & T-1.5) via FloatingMenu */}
      <FloatingMenu
        open={showContextMenu}
        anchorRef={menuAnchor}
        onRequestClose={() => setShowContextMenu(false)}
        className="flow-edge-context-menu"
        style={{
          background: "var(--bg-elevated, #1e2230)",
          border: "1px solid var(--border-subtle, #2a3148)",
          borderRadius: 6,
          padding: "4px 0",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          minWidth: 140,
        }}
      >
        <button
          type="button"
          className="flow-edge-context-item"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: "var(--status-danger, #ef4444)",
            fontSize: "0.8rem",
            cursor: "pointer",
            textAlign: "left",
          }}
          onClick={handleDeleteConnection}
        >
          <Trash2 size={13} />
          <span>Excluir Conexão</span>
        </button>
      </FloatingMenu>
    </>
  );
};
