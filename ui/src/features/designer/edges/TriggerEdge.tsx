import React, { memo } from "react";
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from "reactflow";
import { CheckCircle2 } from "lucide-react";

export interface TriggerEdgeData {
  flowName?: string;
  triggerType?: "OnSubjobOk" | "OnComponentOk" | "RunIf";
}

export const TriggerEdge: React.FC<EdgeProps<TriggerEdgeData>> = memo(({
  id,
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = data?.flowName || data?.triggerType || "OnComponentOk";

  return (
    <>
      {/* Linha tracejada verde esmeralda (semáforo de execução, sem tráfego de dados) */}
      <BaseEdge
        id={id}
        path={edgePath}
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

      {/* Badge central de Gatilho / Sincronização */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
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
