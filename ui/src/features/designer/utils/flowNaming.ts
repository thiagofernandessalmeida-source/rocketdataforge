import { Node, Edge } from "reactflow";
import { CanvasNodeData } from "../../../types";

export type FlowType = "main" | "lkp" | "out" | "reject";

export interface FlowMeta {
  type: FlowType;
  labelPrefix: string;
  displayTitle: string;
  strokeColor: string;
  badgeBg: string;
  badgeBorder: string;
  badgeColor: string;
}

export const FLOW_CONFIG: Record<FlowType, FlowMeta> = {
  main: {
    type: "main",
    labelPrefix: "main",
    displayTitle: "Fluxo Principal (Main)",
    strokeColor: "#38bdf8",
    badgeBg: "rgba(12, 31, 56, 0.95)",
    badgeBorder: "#0284c7",
    badgeColor: "#38bdf8",
  },
  lkp: {
    type: "lkp",
    labelPrefix: "lkp",
    displayTitle: "Fluxo Lookup (Referência)",
    strokeColor: "#c084fc",
    badgeBg: "rgba(35, 14, 61, 0.95)",
    badgeBorder: "#9333ea",
    badgeColor: "#c084fc",
  },
  out: {
    type: "out",
    labelPrefix: "out",
    displayTitle: "Fluxo de Saída (Output)",
    strokeColor: "#fbbf24",
    badgeBg: "rgba(45, 27, 6, 0.95)",
    badgeBorder: "#d97706",
    badgeColor: "#fbbf24",
  },
  reject: {
    type: "reject",
    labelPrefix: "reject",
    displayTitle: "Fluxo de Rejeitados (Reject)",
    strokeColor: "#f87171",
    badgeBg: "rgba(48, 14, 14, 0.95)",
    badgeBorder: "#dc2626",
    badgeColor: "#f87171",
  },
};

/**
 * Determina o tipo de fluxo baseado no componente de origem, destino e conexões existentes.
 */
export function getFlowType(
  sourceNode?: Node<CanvasNodeData> | null,
  targetNode?: Node<CanvasNodeData> | null,
  existingEdges: Edge[] = [],
  targetHandle?: string | null,
  sourceHandle?: string | null
): FlowType {
  // Se a porta de origem for explicitamente reject
  if (sourceHandle === "reject" || sourceHandle === "reject_out") {
    return "reject";
  }

  const srcType = (sourceNode?.data?.componentType || "").toLowerCase();
  const tgtType = (targetNode?.data?.componentType || "").toLowerCase();

  // Se a origem for Data Mapper (tMap)
  if (srcType.includes("tmap") || srcType.includes("mapper")) {
    return "out";
  }

  // Se o destino for Data Mapper (tMap), Join ou Lookup
  if (tgtType.includes("tmap") || tgtType.includes("mapper") || tgtType.includes("join") || tgtType.includes("lookup")) {
    if (targetHandle === "lookup" || targetHandle === "right") {
      return "lkp";
    }
    // Se o nó de destino já possui pelo menos uma entrada conectada no job
    const incomingToTarget = existingEdges.filter(
      (e) => targetNode && e.target === targetNode.id
    );
    if (incomingToTarget.length > 0) {
      return "lkp";
    }
    return "main";
  }

  // Padrão para todos os fluxos de dados principais
  return "main";
}

/**
 * Gera um nome único e sequencial para a aresta de acordo com seu tipo no job (ex: main1, main2, lkp1, out1).
 */
export function generateFlowName(
  flowType: FlowType,
  existingEdges: Edge[] = [],
  excludeEdgeId?: string
): string {
  const prefix = FLOW_CONFIG[flowType].labelPrefix;
  const usedNames = new Set(
    existingEdges
      .filter((e) => e.id !== excludeEdgeId)
      .map((e) => (e.data?.flowName || e.label || "").trim().toLowerCase())
      .filter(Boolean)
  );

  let num = 1;
  while (usedNames.has(`${prefix}${num}`.toLowerCase())) {
    num++;
  }
  return `${prefix}${num}`;
}

/**
 * Verifica se um nome de fluxo informado pelo usuário é único no escopo de todo o job.
 */
export function isFlowNameUnique(
  name: string,
  existingEdges: Edge[] = [],
  excludeEdgeId?: string
): boolean {
  const clean = name.trim().toLowerCase();
  if (!clean) return false;

  const duplicate = existingEdges.some((e) => {
    if (e.id === excludeEdgeId) return false;
    const existingName = (e.data?.flowName || e.label || "").trim().toLowerCase();
    return existingName === clean;
  });

  return !duplicate;
}
