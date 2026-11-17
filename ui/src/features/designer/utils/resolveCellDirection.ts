import { Node, Position } from "reactflow";
import { CanvasNodeData } from "../../../types/index";

export type LayoutDirection = "LR" | "TB";

/**
 * Resolve a orientação de layout para uma célula / canvas com base na seguinte prioridade:
 * 1. layoutDirection explícito da célula ("LR" ou "TB")
 * 2. data.layoutDirection do primeiro nó existente que o possua
 * 3. Dedução a partir de targetPosition / sourcePosition dos nós existentes
 * 4. Padrão horizontal "LR"
 */
export function resolveCellDirection(
  cellDirection?: "LR" | "TB" | null,
  nodes?: Array<Partial<Node<Partial<CanvasNodeData>>>> | null
): "LR" | "TB" {
  // (a) layoutDirection da célula tem precedência máxima
  if (cellDirection === "LR" || cellDirection === "TB") {
    return cellDirection;
  }

  if (nodes && nodes.length > 0) {
    // (b) data.layoutDirection do primeiro nó existente
    for (const n of nodes) {
      const dir = (n?.data as any)?.layoutDirection;
      if (dir === "LR" || dir === "TB") {
        return dir;
      }
    }

    // (c) Deduz de targetPosition / sourcePosition dos nós existentes
    for (const n of nodes) {
      if (n?.targetPosition === Position.Top || n?.sourcePosition === Position.Bottom) {
        return "TB";
      }
      if (n?.targetPosition === Position.Left || n?.sourcePosition === Position.Right) {
        return "LR";
      }
    }
  }

  // (d) Padrão do sistema é Horizontal (LR)
  return "LR";
}

/**
 * Retorna as portas de entrada (targetPosition) e saída (sourcePosition)
 * correspondentes à orientação selecionada.
 */
export function getHandlePositions(direction: "LR" | "TB"): {
  targetPosition: Position;
  sourcePosition: Position;
} {
  return direction === "TB"
    ? { targetPosition: Position.Top, sourcePosition: Position.Bottom }
    : { targetPosition: Position.Left, sourcePosition: Position.Right };
}
