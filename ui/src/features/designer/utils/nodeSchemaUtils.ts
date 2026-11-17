import { Node, Edge } from "reactflow";
import { CanvasNodeData } from "../../../types/index";
import { SchemaColumn, jobStore } from "../../../store/jobStore";

export interface TMapOutputSchemaOption {
  outputId: string;
  outputName: string;
  schema: SchemaColumn[];
}

/**
 * Converte colunas de saída de um tMap (TMapOutputColumn) para o formato padrão SchemaColumn.
 */
export function convertTMapColumnsToSchema(columns: any[]): SchemaColumn[] {
  if (!Array.isArray(columns) || columns.length === 0) return [];
  return columns.map((c: any) => ({
    id: c.id || `col-${c.target || c.name || Math.random().toString(36).slice(2, 6)}`,
    name: c.target || c.name || "",
    type: c.type || "String",
    nullable: c.nullable ?? true,
    key: Boolean(c.key),
    comment: c.comment,
    pattern: c.pattern,
    length: typeof c.length === "number" ? c.length : undefined,
    precision: typeof c.precision === "number" ? c.precision : undefined,
  }));
}

/**
 * Retorna todos os fluxos de saída de um nó tMap com seus schemas convertidos.
 */
export function getTMapOutputSchemas(node: Node<CanvasNodeData> | undefined): TMapOutputSchemaOption[] {
  if (!node) return [];
  const ct = node.data?.componentType || (node.data as any)?.type || "";
  if (ct !== "core.tmap" && ct !== "transform.tmap") return [];

  const outputs: any[] = (node.data?.config as any)?.outputs || [];
  const result: TMapOutputSchemaOption[] = [];

  for (const out of outputs) {
    if (Array.isArray(out.columns) && out.columns.length > 0) {
      result.push({
        outputId: out.id || "out",
        outputName: out.name || out.id || "out",
        schema: convertTMapColumnsToSchema(out.columns),
      });
    }
  }

  return result;
}

/**
 * Extrai o schema efetivo de qualquer nó do Canvas (incluindo tMap, fontes, transformações ou sinks),
 * levando em consideração conexões upstream (arestas), saídas mapeadas e schemas armazenados na célula.
 */
export function extractNodeSchema(
  node: Node<CanvasNodeData> | undefined,
  incomingEdge?: Edge,
  targetNodeId?: string
): SchemaColumn[] {
  if (!node) return [];

  const ct = node.data?.componentType || (node.data as any)?.type || "";
  const isTMap = ct === "core.tmap" || ct === "transform.tmap";

  if (isTMap) {
    const outputs: any[] = (node.data?.config as any)?.outputs || [];
    if (outputs.length > 0) {
      const edgeFlowName =
        incomingEdge?.data?.flowName ||
        (typeof incomingEdge?.label === "string" ? incomingEdge.label : "") ||
        "";

      // 1. Tenta casar pelo targetNodeId explícito na saída do tMap
      let targetFlow = outputs.find(
        (o) =>
          (targetNodeId && o.targetId === targetNodeId) ||
          (incomingEdge?.target && o.targetId === incomingEdge.target)
      );

      // 2. Tenta casar pelo nome/ID do fluxo na aresta (ex: "out1")
      if (!targetFlow && edgeFlowName) {
        targetFlow = outputs.find(
          (o) => o.id === edgeFlowName || o.name === edgeFlowName
        );
      }

      // 3. Tenta casar pelo sourceHandle da aresta
      if (!targetFlow && incomingEdge?.sourceHandle) {
        targetFlow = outputs.find(
          (o) => o.id === incomingEdge.sourceHandle || o.name === incomingEdge.sourceHandle
        );
      }

      // 4. Fallback: primeira saída configurada com colunas
      if (!targetFlow) {
        targetFlow = outputs.find((o) => Array.isArray(o.columns) && o.columns.length > 0) || outputs[0];
      }

      if (targetFlow && Array.isArray(targetFlow.columns) && targetFlow.columns.length > 0) {
        return convertTMapColumnsToSchema(targetFlow.columns);
      }
    }
  }

  // Verifica data.schema direto no nó
  if (Array.isArray((node.data as any)?.schema) && (node.data as any).schema.length > 0) {
    return (node.data as any).schema;
  }

  // Verifica cell.nodeSchemas ou activeJob.nodeSchemas
  try {
    const activeJob = jobStore.getActiveJob();
    const cellId = (node.data as any)?.cellId;
    const cell = activeJob?.cells?.find((c) => c.id === cellId);
    const cellSchemas = cell?.nodeSchemas || activeJob?.nodeSchemas || {};
    if (cellSchemas[node.id] && cellSchemas[node.id].length > 0) {
      return cellSchemas[node.id];
    }
  } catch (_) {}

  return [];
}
