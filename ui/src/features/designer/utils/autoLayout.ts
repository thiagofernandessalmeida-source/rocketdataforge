import dagre from "dagre";
import { Node, Edge, Position } from "reactflow";
import { CanvasNodeData } from "../../../types/index";

export type LayoutDirection = "LR" | "TB";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

/**
 * Calcula as coordenadas X e Y de cada nó utilizando a biblioteca Dagre
 * para auto-layout horizontal (LR) ou vertical (TB).
 */
export function getLayoutedElements(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  direction: LayoutDirection = "LR"
): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges };
  }

  const isHorizontal = direction === "LR";
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: isHorizontal ? 50 : 60,
    ranksep: isHorizontal ? 90 : 70,
    marginx: 40,
    marginy: 40,
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  // Somente inclui arestas cujos source e target pertencem aos nós desta célula
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const x = nodeWithPosition ? nodeWithPosition.x - NODE_WIDTH / 2 : node.position.x;
    const y = nodeWithPosition ? nodeWithPosition.y - NODE_HEIGHT / 2 : node.position.y;

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: { x, y },
      data: {
        ...node.data,
        layoutDirection: direction,
      },
    } as Node<CanvasNodeData>;
  });

  return { nodes: layoutedNodes, edges };
}

