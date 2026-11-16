import type { CSSProperties } from "react";

export type FlowType = "main" | "lkp" | "out" | "reject" | "iterate" | "trigger";

export interface FlowStrokeConfig {
  stroke: string;
  strokeDasharray?: string;
  strokeLinecap?: "round" | "butt" | "square";
  colorHex: string;
}

export const FLOW_TYPE_COLORS: Record<string, string> = {
  main: "#60a5fa",
  lkp: "#c4b0fb",
  reject: "#fb7185",
  out: "#5eead4",
  iterate: "#fbbf24",
  trigger: "#10b981",
};

/**
 * Retorna as propriedades de cor e padrão de traço para cada tipo de fluxo (Regra 2.6).
 * - main: contínuo, cor #60a5fa
 * - lkp: pontilhado ("2 5", ponta redonda), cor #c4b0fb
 * - reject: tracejado ("7 4"), cor #fb7185
 * - out: contínuo, cor #5eead4
 * - iterate: traço-ponto ("9 3 2 3"), cor #fbbf24
 */
export function getFlowStrokeStyle(flowType: FlowType | string = "main", selected = false): FlowStrokeConfig {
  const normType = (flowType || "main").toLowerCase();
  const baseColor = FLOW_TYPE_COLORS[normType] || "#60a5fa";
  const stroke = selected ? "var(--accent-cyan)" : `var(--flow-${normType}, ${baseColor})`;

  switch (normType) {
    case "lkp":
      return {
        stroke,
        strokeDasharray: "2 5",
        strokeLinecap: "round",
        colorHex: baseColor,
      };
    case "reject":
      return {
        stroke,
        strokeDasharray: "7 4",
        strokeLinecap: "butt",
        colorHex: baseColor,
      };
    case "iterate":
      return {
        stroke,
        strokeDasharray: "9 3 2 3",
        strokeLinecap: "butt",
        colorHex: baseColor,
      };
    case "trigger":
      return {
        stroke: selected ? "var(--accent-cyan)" : "#10b981",
        strokeDasharray: "5 5",
        strokeLinecap: "butt",
        colorHex: "#10b981",
      };
    case "out":
    case "main":
    default:
      return {
        stroke,
        strokeDasharray: undefined,
        strokeLinecap: "butt",
        colorHex: baseColor,
      };
  }
}
