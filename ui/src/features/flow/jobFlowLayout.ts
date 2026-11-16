/**
 * RocketDataForge — Job Flow Layout (Layout Colunar Puro da View de Fluxo)
 * Organiza células em colunas por ordem de execução, calcula dimensões
 * e roteia barramentos entre as portas.
 */

import type { JobFlowModel, FlowNodeModel } from "./jobFlowModel.ts";
import type {
  RouterEdgeResult,
  RouterEdgeInput,
  NodeRect,
} from "../designer/edges/busRouter.ts";
import { computeBusRoutes } from "../designer/edges/busRouter.ts";

export interface FlowLayoutColumn {
  order: number;
  title: string;
  isParallel: boolean;
  x: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface FlowLayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isExpanded: boolean;
  model: FlowNodeModel;
  ports: {
    input: { x: number; y: number };
    output: { x: number; y: number };
  };
}

export interface JobFlowLayout {
  columns: FlowLayoutColumn[];
  nodes: FlowLayoutNode[];
  routes: RouterEdgeResult[];
  totalWidth: number;
  totalHeight: number;
  marginLeft: number;
  marginTop: number;
  gapX: number;
  gapY: number;
}

const COLLAPSED_WIDTH = 200;
const COLLAPSED_HEIGHT = 120;
const EXPANDED_WIDTH = 540;

const HEADER_HEIGHT = 52;
const FOOTER_HEIGHT = 36;
const MARGINS_HEIGHT = 28;
const BASE_EXPANDED_HEIGHT = HEADER_HEIGHT + FOOTER_HEIGHT + MARGINS_HEIGHT; // 116 px

const GAP_X = 64;
const GAP_Y = 28;
const MARGIN_LEFT = 56;
const MARGIN_TOP = 48;

/**
 * Calcula a altura de uma célula expandida conforme o tipo e conteúdo (Regra 3.2).
 */
export function calculateExpandedCellHeight(node: FlowNodeModel): number {
  if (node.cellType === "PYTHON") {
    const rawSnippet = node.codeSnippet || "";
    const lines = rawSnippet.length > 0 ? rawSnippet.split("\n") : [""];
    const visibleLines = Math.min(12, Math.max(1, lines.length));
    const bodyHeight = visibleLines * 21 + 20;
    return BASE_EXPANDED_HEIGHT + bodyHeight;
  }

  // Célula Canvas: lista de componentes
  const compCount = node.nodes?.length || 0;
  const visibleComps = Math.min(12, Math.max(1, compCount));
  const bodyHeight = visibleComps * 28 + 20;
  return BASE_EXPANDED_HEIGHT + bodyHeight;
}

/**
 * Calcula o layout completo da View de Fluxo em colunas por ordem de execução.
 */
export function computeJobFlowLayout(
  model: JobFlowModel,
  expandedCellIds: Set<string> = new Set()
): JobFlowLayout {
  const { nodes: flowNodes, links } = model;

  if (!flowNodes || flowNodes.length === 0) {
    return {
      columns: [],
      nodes: [],
      routes: [],
      totalWidth: MARGIN_LEFT * 2,
      totalHeight: MARGIN_TOP * 2,
      marginLeft: MARGIN_LEFT,
      marginTop: MARGIN_TOP,
      gapX: GAP_X,
      gapY: GAP_Y,
    };
  }

  // 1. Agrupar nós por ordem de execução ordenada
  const orderGroups = new Map<number, FlowNodeModel[]>();
  for (const node of flowNodes) {
    const ord = typeof node.order === "number" && !isNaN(node.order) ? node.order : 1;
    if (!orderGroups.has(ord)) {
      orderGroups.set(ord, []);
    }
    orderGroups.get(ord)!.push(node);
  }

  const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);

  // 2. Determinar largura e alturas preliminares por coluna
  interface ColTemp {
    order: number;
    nodes: Array<{
      model: FlowNodeModel;
      isExpanded: boolean;
      w: number;
      h: number;
    }>;
    width: number;
    height: number;
  }

  const colsTemp: ColTemp[] = [];
  let maxColumnHeight = 0;

  for (const ord of sortedOrders) {
    const group = orderGroups.get(ord)!;
    let colWidth = COLLAPSED_WIDTH;
    const colNodes: ColTemp["nodes"] = [];
    let sumHeights = 0;

    for (const node of group) {
      const isExpanded = expandedCellIds.has(node.id);
      const w = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
      const h = isExpanded ? calculateExpandedCellHeight(node) : COLLAPSED_HEIGHT;

      if (isExpanded) {
        colWidth = EXPANDED_WIDTH;
      }

      colNodes.push({ model: node, isExpanded, w, h });
      sumHeights += h;
    }

    const totalColHeight = sumHeights + Math.max(0, colNodes.length - 1) * GAP_Y;
    if (totalColHeight > maxColumnHeight) {
      maxColumnHeight = totalColHeight;
    }

    colsTemp.push({
      order: ord,
      nodes: colNodes,
      width: colWidth,
      height: totalColHeight,
    });
  }

  // 3. Posicionar colunas no eixo X e nós no eixo Y
  let currentX = MARGIN_LEFT;
  const layoutColumns: FlowLayoutColumn[] = [];
  const layoutNodes: FlowLayoutNode[] = [];
  const routingBoxes: NodeRect[] = [];

  for (const col of colsTemp) {
    const isParallel = col.nodes.length >= 2;
    const title = `ORDEM ${col.order}${isParallel ? " (paralelo)" : ""}`;

    layoutColumns.push({
      order: col.order,
      title,
      isParallel,
      x: currentX,
      width: col.width,
      height: col.height,
      nodeIds: col.nodes.map((n) => n.model.id),
    });

    if (col.nodes.length === 1) {
      // Regra 3.3: Colunas com um só nó ficam centralizadas na altura da maior coluna
      const single = col.nodes[0];
      const centeredY = MARGIN_TOP + (maxColumnHeight - single.h) / 2;

      const layoutNode: FlowLayoutNode = {
        id: single.model.id,
        x: currentX,
        y: centeredY,
        w: single.w,
        h: single.h,
        isExpanded: single.isExpanded,
        model: single.model,
        ports: {
          input: {
            x: currentX,
            y: single.isExpanded ? centeredY + 26 : centeredY + single.h / 2,
          },
          output: {
            x: currentX + single.w,
            y: single.isExpanded ? centeredY + 26 : centeredY + single.h / 2,
          },
        },
      };

      layoutNodes.push(layoutNode);

      // Caixa para o busRouter (usa altura 52 centralizada nas portas para expandidos)
      routingBoxes.push({
        id: single.model.id,
        x: currentX,
        y: single.isExpanded ? centeredY : centeredY,
        w: single.w,
        h: single.isExpanded ? 52 : single.h,
      });
    } else {
      // Múltiplos nós na coluna: empilhamento vertical top-to-bottom
      let nodeY = MARGIN_TOP;

      for (const item of col.nodes) {
        const layoutNode: FlowLayoutNode = {
          id: item.model.id,
          x: currentX,
          y: nodeY,
          w: item.w,
          h: item.h,
          isExpanded: item.isExpanded,
          model: item.model,
          ports: {
            input: {
              x: currentX,
              y: item.isExpanded ? nodeY + 26 : nodeY + item.h / 2,
            },
            output: {
              x: currentX + item.w,
              y: item.isExpanded ? nodeY + 26 : nodeY + item.h / 2,
            },
          },
        };

        layoutNodes.push(layoutNode);

        routingBoxes.push({
          id: item.model.id,
          x: currentX,
          y: nodeY,
          w: item.w,
          h: item.isExpanded ? 52 : item.h,
        });

        nodeY += item.h + GAP_Y;
      }
    }

    currentX += col.width + GAP_X;
  }

  // 4. Calcular rotas de arestas com o busRouter puro (Regra 3.5)
  const edgeInputs: RouterEdgeInput[] = (links || []).map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    type: l.expectedStatus === "ERRO" ? "reject" : "main",
  }));

  const routes = computeBusRoutes(edgeInputs, routingBoxes, "LR");

  const totalWidth = currentX + MARGIN_LEFT;
  const totalHeight = maxColumnHeight + MARGIN_TOP * 2;

  return {
    columns: layoutColumns,
    nodes: layoutNodes,
    routes,
    totalWidth,
    totalHeight,
    marginLeft: MARGIN_LEFT,
    marginTop: MARGIN_TOP,
    gapX: GAP_X,
    gapY: GAP_Y,
  };
}
