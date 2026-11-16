/**
 * busRouter.ts — Roteador Ortogonal com Barramento (Módulo Puro)
 *
 * Implementa roteamento determinístico estilo barramento (bus routing) com:
 * - Troncos verticais escalonados por origem (gx = x1 + 26 + 8*i);
 * - Junções visuais em círculo no início do tronco quando a origem tem múltiplos destinos;
 * - Detecção e desvio de arestas de retorno (backward edges) com contorno por cima ou por baixo;
 * - Cantos arredondados (raio de 9 px adaptativo);
 * - Posicionamento de rótulo a 44 px do término da polilinha;
 * - Detecção de colisão com nós intermediários (variante média -> fallback Bézier);
 * - Suporte simétrico a orientações Horizontal (LR) e Vertical (TB).
 */

export type Orientation = "LR" | "TB";

export interface NodeRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RouterEdgeInput {
  id: string;
  source: string;
  target: string;
  type?: string;
  [key: string]: any;
}

export interface Point {
  x: number;
  y: number;
}

export interface RouterEdgeResult {
  edgeId: string;
  svgPath: string;
  polyline: Point[];
  labelPosition: Point;
  junctionPoints: Point[];
  isFallbackBezier: boolean;
}

/**
 * Remove pontos repetidos e colineares intermediários.
 */
export function simplifyPolyline(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  // 1. Remove duplicatas consecutivas
  const nonDup: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = nonDup[nonDup.length - 1];
    const curr = points[i];
    if (Math.abs(curr.x - prev.x) > 0.001 || Math.abs(curr.y - prev.y) > 0.001) {
      nonDup.push(curr);
    }
  }

  if (nonDup.length <= 2) return nonDup;

  // 2. Remove intermediários colineares
  const result: Point[] = [nonDup[0]];
  for (let i = 1; i < nonDup.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = nonDup[i];
    const next = nonDup[i + 1];

    const isCollinearX = Math.abs(prev.x - curr.x) < 0.001 && Math.abs(curr.x - next.x) < 0.001;
    const isCollinearY = Math.abs(prev.y - curr.y) < 0.001 && Math.abs(curr.y - next.y) < 0.001;

    if (!isCollinearX && !isCollinearY) {
      result.push(curr);
    }
  }
  result.push(nonDup[nonDup.length - 1]);
  return result;
}

/**
 * Verifica se um segmento de reta ortogonal intersecta o interior de um nó (AABB).
 */
function isSegmentCollidingWithRect(p1: Point, p2: Point, rect: NodeRect): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  // Segmento horizontal
  if (Math.abs(p1.y - p2.y) < 0.001) {
    const y = p1.y;
    if (y > rect.y && y < rect.y + rect.h) {
      if (maxX > rect.x && minX < rect.x + rect.w) {
        return true;
      }
    }
  }
  // Segmento vertical
  else if (Math.abs(p1.x - p2.x) < 0.001) {
    const x = p1.x;
    if (x > rect.x && x < rect.x + rect.w) {
      if (maxY > rect.y && minY < rect.y + rect.h) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Verifica se qualquer segmento da polilinha colide com nós intermediários.
 */
function doesPolylineCollideWithObstacles(polyline: Point[], obstacles: NodeRect[]): boolean {
  for (let i = 0; i < polyline.length - 1; i++) {
    const p1 = polyline[i];
    const p2 = polyline[i + 1];
    for (const obs of obstacles) {
      if (isSegmentCollidingWithRect(p1, p2, obs)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Gera caminho SVG com cantos arredondados de raio especificado.
 */
export function generateRoundedSvgPath(points: Point[], targetRadius = 9): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len2 = Math.hypot(v2.x, v2.y);

    const r = Math.max(0, Math.min(targetRadius, len1 / 2, len2 / 2));

    if (r < 0.5 || len1 === 0 || len2 === 0) {
      path += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const q1 = {
      x: curr.x + (v1.x / len1) * r,
      y: curr.y + (v1.y / len1) * r,
    };
    const q2 = {
      x: curr.x + (v2.x / len2) * r,
      y: curr.y + (v2.y / len2) * r,
    };

    path += ` L ${q1.x} ${q1.y} Q ${curr.x} ${curr.y}, ${q2.x} ${q2.y}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

/**
 * Calcula a posição do rótulo a uma distância fixa (44 px) do final da polilinha.
 */
export function computeLabelPositionAtDistance(points: Point[], distFromEnd = 44): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };

  // Calcula comprimentos dos segmentos
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength <= distFromEnd) {
    // Se a aresta for muito curta, posiciona no meio da polilinha
    const midTarget = totalLength / 2;
    let accumulated = 0;
    for (let i = 0; i < segmentLengths.length; i++) {
      const segLen = segmentLengths[i];
      if (accumulated + segLen >= midTarget) {
        const ratio = segLen > 0 ? (midTarget - accumulated) / segLen : 0;
        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
          y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
        };
      }
      accumulated += segLen;
    }
    return { ...points[0] };
  }

  // Percorre de trás para a frente a partir do último ponto
  let remaining = distFromEnd;
  for (let i = points.length - 2; i >= 0; i--) {
    const segLen = segmentLengths[i];
    if (segLen >= remaining) {
      const ratio = remaining / segLen;
      // Caminha do fim do segmento (points[i+1]) em direção ao início (points[i])
      return {
        x: points[i + 1].x - (points[i + 1].x - points[i].x) * ratio,
        y: points[i + 1].y - (points[i + 1].y - points[i].y) * ratio,
      };
    }
    remaining -= segLen;
  }

  return { ...points[0] };
}

/**
 * Roteador Central: calcula caminhos ortogonais com barramento para uma lista de arestas e nós.
 */
export function computeBusRoutes(
  edges: RouterEdgeInput[],
  nodes: NodeRect[],
  orientation: Orientation = "LR"
): RouterEdgeResult[] {
  if (!edges || edges.length === 0 || !nodes || nodes.length === 0) {
    return [];
  }

  const nodeMap = new Map<string, NodeRect>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // Ordena arestas por ID para garantir determinismo (1.8)
  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));

  // Agrupa arestas válidas por origem
  const forwardEdgesBySource = new Map<string, RouterEdgeInput[]>();
  const backwardEdges: RouterEdgeInput[] = [];

  for (const edge of sortedEdges) {
    const srcNode = nodeMap.get(edge.source);
    const tgtNode = nodeMap.get(edge.target);
    if (!srcNode || !tgtNode) continue;

    if (orientation === "LR") {
      const x1 = srcNode.x + srcNode.w;
      const x2 = tgtNode.x;
      if (x2 < x1 + 10) {
        backwardEdges.push(edge);
      } else {
        const list = forwardEdgesBySource.get(edge.source) || [];
        list.push(edge);
        forwardEdgesBySource.set(edge.source, list);
      }
    } else {
      // Orientação TB
      const y1 = srcNode.y + srcNode.h;
      const y2 = tgtNode.y;
      if (y2 < y1 + 10) {
        backwardEdges.push(edge);
      } else {
        const list = forwardEdgesBySource.get(edge.source) || [];
        list.push(edge);
        forwardEdgesBySource.set(edge.source, list);
      }
    }
  }

  const results: RouterEdgeResult[] = [];

  // ─── Processa Arestas para Frente ──────────────────────────
  for (const [srcId, fwdEdges] of forwardEdgesBySource.entries()) {
    const srcNode = nodeMap.get(srcId)!;

    // Ordena arestas da mesma origem pelo eixo ortogonal do destino (y2 em LR; x2 em TB)
    const sortedFwd = [...fwdEdges].sort((a, b) => {
      const tgtA = nodeMap.get(a.target)!;
      const tgtB = nodeMap.get(b.target)!;
      if (orientation === "LR") {
        const diff = (tgtA.y + tgtA.h / 2) - (tgtB.y + tgtB.h / 2);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      } else {
        const diff = (tgtA.x + tgtA.w / 2) - (tgtB.x + tgtB.w / 2);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }
    });

    const hasMultipleDestinations = sortedFwd.length >= 2;

    sortedFwd.forEach((edge, index) => {
      const tgtNode = nodeMap.get(edge.target)!;

      // Obstáculos para checagem de colisão (todos os nós exceto origem e destino)
      const obstacles = nodes.filter((n) => n.id !== srcNode.id && n.id !== tgtNode.id);

      if (orientation === "LR") {
        const x1 = srcNode.x + srcNode.w;
        const y1 = srcNode.y + srcNode.h / 2;
        const x2 = tgtNode.x;
        const y2 = tgtNode.y + tgtNode.h / 2;

        // Tronco vertical em gx
        const gx = x1 + 26 + 8 * index;

        let polyline = [
          { x: x1, y: y1 },
          { x: gx, y: y1 },
          { x: gx, y: y2 },
          { x: x2, y: y2 },
        ];
        polyline = simplifyPolyline(polyline);

        let isFallback = false;
        let svgPath = "";

        // 1.7 Segurança contra sobreposição
        if (doesPolylineCollideWithObstacles(polyline, obstacles)) {
          // Tenta variante de ponto médio
          const gxMid = (x1 + x2) / 2;
          let polylineMid = [
            { x: x1, y: y1 },
            { x: gxMid, y: y1 },
            { x: gxMid, y: y2 },
            { x: x2, y: y2 },
          ];
          polylineMid = simplifyPolyline(polylineMid);

          if (!doesPolylineCollideWithObstacles(polylineMid, obstacles)) {
            polyline = polylineMid;
          } else {
            // Cai para Bézier cúbico suave
            isFallback = true;
            const dx = Math.abs(x2 - x1) * 0.5;
            svgPath = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          }
        }

        if (!isFallback) {
          svgPath = generateRoundedSvgPath(polyline, 9);
        }

        const labelPos = computeLabelPositionAtDistance(polyline, 44);
        const junctionPoints: Point[] = hasMultipleDestinations ? [{ x: gx, y: y1 }] : [];

        results.push({
          edgeId: edge.id,
          svgPath,
          polyline,
          labelPosition: labelPos,
          junctionPoints,
          isFallbackBezier: isFallback,
        });
      } else {
        // Orientação TB
        const x1 = srcNode.x + srcNode.w / 2;
        const y1 = srcNode.y + srcNode.h;
        const x2 = tgtNode.x + tgtNode.w / 2;
        const y2 = tgtNode.y;

        const gy = y1 + 26 + 8 * index;

        let polyline = [
          { x: x1, y: y1 },
          { x: x1, y: gy },
          { x: x2, y: gy },
          { x: x2, y: y2 },
        ];
        polyline = simplifyPolyline(polyline);

        let isFallback = false;
        let svgPath = "";

        if (doesPolylineCollideWithObstacles(polyline, obstacles)) {
          const gyMid = (y1 + y2) / 2;
          let polylineMid = [
            { x: x1, y: y1 },
            { x: x1, y: gyMid },
            { x: x2, y: gyMid },
            { x: x2, y: y2 },
          ];
          polylineMid = simplifyPolyline(polylineMid);

          if (!doesPolylineCollideWithObstacles(polylineMid, obstacles)) {
            polyline = polylineMid;
          } else {
            isFallback = true;
            const dy = Math.abs(y2 - y1) * 0.5;
            svgPath = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
          }
        }

        if (!isFallback) {
          svgPath = generateRoundedSvgPath(polyline, 9);
        }

        const labelPos = computeLabelPositionAtDistance(polyline, 44);
        const junctionPoints: Point[] = hasMultipleDestinations ? [{ x: x1, y: gy }] : [];

        results.push({
          edgeId: edge.id,
          svgPath,
          polyline,
          labelPosition: labelPos,
          junctionPoints,
          isFallbackBezier: isFallback,
        });
      }
    });
  }

  // ─── Processa Arestas de Retorno (Backward) ────────────────
  for (const edge of backwardEdges) {
    const srcNode = nodeMap.get(edge.source)!;
    const tgtNode = nodeMap.get(edge.target)!;
    const obstacles = nodes.filter((n) => n.id !== srcNode.id && n.id !== tgtNode.id);

    if (orientation === "LR") {
      const x1 = srcNode.x + srcNode.w;
      const y1 = srcNode.y + srcNode.h / 2;
      const x2 = tgtNode.x;
      const y2 = tgtNode.y + tgtNode.h / 2;

      // Se o destino estiver abaixo ou mesma altura: passa por baixo
      // Se estiver acima: espelho, passa 18 px acima do topo
      const isTargetBelow = y2 >= y1;
      const yBypass = isTargetBelow
        ? Math.max(srcNode.y + srcNode.h, tgtNode.y + tgtNode.h) + 18
        : Math.min(srcNode.y, tgtNode.y) - 18;

      const xBypass = tgtNode.x - 24;

      let polyline = [
        { x: x1, y: y1 },
        { x: x1 + 22, y: y1 },
        { x: x1 + 22, y: yBypass },
        { x: xBypass, y: yBypass },
        { x: xBypass, y: y2 },
        { x: x2, y: y2 },
      ];
      polyline = simplifyPolyline(polyline);

      let isFallback = false;
      let svgPath = "";

      if (doesPolylineCollideWithObstacles(polyline, obstacles)) {
        isFallback = true;
        const dx = Math.max(80, Math.abs(x2 - x1) * 0.5);
        svgPath = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      } else {
        svgPath = generateRoundedSvgPath(polyline, 9);
      }

      const labelPos = computeLabelPositionAtDistance(polyline, 44);

      results.push({
        edgeId: edge.id,
        svgPath,
        polyline,
        labelPosition: labelPos,
        junctionPoints: [],
        isFallbackBezier: isFallback,
      });
    } else {
      // Orientação TB
      const x1 = srcNode.x + srcNode.w / 2;
      const y1 = srcNode.y + srcNode.h;
      const x2 = tgtNode.x + tgtNode.w / 2;
      const y2 = tgtNode.y;

      const isTargetRight = x2 >= x1;
      const xBypass = isTargetRight
        ? Math.max(srcNode.x + srcNode.w, tgtNode.x + tgtNode.w) + 18
        : Math.min(srcNode.x, tgtNode.x) - 18;

      const yBypass = tgtNode.y - 24;

      let polyline = [
        { x: x1, y: y1 },
        { x: x1, y: y1 + 22 },
        { x: xBypass, y: y1 + 22 },
        { x: xBypass, y: yBypass },
        { x: x2, y: yBypass },
        { x: x2, y: y2 },
      ];
      polyline = simplifyPolyline(polyline);

      let isFallback = false;
      let svgPath = "";

      if (doesPolylineCollideWithObstacles(polyline, obstacles)) {
        isFallback = true;
        const dy = Math.max(80, Math.abs(y2 - y1) * 0.5);
        svgPath = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      } else {
        svgPath = generateRoundedSvgPath(polyline, 9);
      }

      const labelPos = computeLabelPositionAtDistance(polyline, 44);

      results.push({
        edgeId: edge.id,
        svgPath,
        polyline,
        labelPosition: labelPos,
        junctionPoints: [],
        isFallbackBezier: isFallback,
      });
    }
  }

  return results;
}
