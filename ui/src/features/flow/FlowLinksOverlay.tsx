import React from "react";
import { RouterEdgeResult } from "../designer/edges/busRouter";
import { FlowLinkModel } from "./jobFlowModel";

interface FlowLinksOverlayProps {
  routes: RouterEdgeResult[];
  links: FlowLinkModel[];
  width: number;
  height: number;
}

export const FlowLinksOverlay: React.FC<FlowLinksOverlayProps> = ({
  routes,
  links,
  width,
  height,
}) => {
  const linkMap = new Map<string, FlowLinkModel>();
  for (const l of links) {
    linkMap.set(l.id, l);
  }

  return (
    <svg
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "none",
        zIndex: 5,
        overflow: "visible",
      }}
    >
      <defs>
        {/* Seta Verde (Expectativa OK) */}
        <marker
          id="flow-arrow-ok"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
        </marker>

        {/* Seta Vermelha (Expectativa ERRO) */}
        <marker
          id="flow-arrow-erro"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#ef4444" />
        </marker>
      </defs>

      {routes.map((route) => {
        const link = linkMap.get(route.edgeId);
        const isErro = link?.expectedStatus === "ERRO";
        const strokeColor = isErro ? "#ef4444" : "#10b981";
        const markerUrl = isErro ? "url(#flow-arrow-erro)" : "url(#flow-arrow-ok)";
        const strokeDasharray = isErro ? "7 4" : undefined;

        return (
          <g key={route.edgeId} className="flow-link-group">
            {/* Halo de fundo para contraste e legibilidade (6px) */}
            <path
              d={route.svgPath}
              fill="none"
              stroke="var(--bg-app, #0f172a)"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Traço principal da aresta ortogonal */}
            <path
              d={route.svgPath}
              fill="none"
              stroke={strokeColor}
              strokeWidth={2}
              strokeDasharray={strokeDasharray}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={markerUrl}
            />

            {/* Pontos de junção desenhados no início do tronco quando múltiplos */}
            {route.junctionPoints &&
              route.junctionPoints.map((pt, pIdx) => (
                <circle
                  key={`jp-${route.edgeId}-${pIdx}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5}
                  fill={strokeColor}
                  stroke="var(--bg-app, #0f172a)"
                  strokeWidth={1}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
};
