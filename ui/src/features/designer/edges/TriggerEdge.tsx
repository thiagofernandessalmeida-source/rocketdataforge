import React, { memo, useMemo } from "react";
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
} from "reactflow";
import { CheckCircle2 } from "lucide-react";
import { useEdgeStyle } from "../hooks/useEdgeStyle";
import { computeBusRoutes } from "./busRouter";

export interface TriggerEdgeData {
  flowName?: string;
  triggerType?: "OnSubjobOk" | "OnComponentOk" | "RunIf";
}

export const TriggerEdge: React.FC<EdgeProps<TriggerEdgeData>> = memo(({
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
  selected,
}) => {
  const { getEdges, getNodes } = useReactFlow();
  const [edgeStyle] = useEdgeStyle();

  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

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

  const label = data?.flowName || data?.triggerType || "OnComponentOk";

  return (
    <>
      {/* Contorno (Halo) de 6px na cor de fundo para separação visual (2.4) */}
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

      {/* Linha tracejada verde esmeralda (semáforo de execução, sem tráfego de dados) */}
      <BaseEdge
        id={id}
        path={effectivePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? "var(--accent-cyan, #38bdf8)" : "#10b981",
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: "5, 5",
          animation: "flow-trigger-dash 1.5s linear infinite",
          transition: "stroke 0.2s, stroke-width 0.2s",
        }}
      />

      {/* Pontos de Junção no início do tronco */}
      {junctionPoints.map((jp, i) => (
        <circle
          key={`jp-trigger-${id}-${i}`}
          cx={jp.x}
          cy={jp.y}
          r={3.5}
          fill={selected ? "var(--accent-cyan, #38bdf8)" : "#10b981"}
          stroke="var(--bg-app, #07080f)"
          strokeWidth={1}
          style={{ pointerEvents: "none" }}
        />
      ))}

      {/* Badge central de Gatilho / Sincronização */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${effectiveLabelX}px,${effectiveLabelY}px)`,
            pointerEvents: "all",
            zIndex: 10,
          }}
          className="trigger-edge-label-container"
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 12,
              background: "rgba(6, 78, 59, 0.95)",
              border: `1px solid ${selected ? "var(--accent-cyan, #38bdf8)" : "#059669"}`,
              color: "#34d399",
              fontSize: "0.68rem",
              fontWeight: 600,
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              cursor: "pointer",
            }}
            title="Aresta de Gatilho: Executa o nó destino somente após o sucesso completo da origem"
          >
            <CheckCircle2 size={11} color="#34d399" />
            <span>{label}</span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

TriggerEdge.displayName = "TriggerEdge";
