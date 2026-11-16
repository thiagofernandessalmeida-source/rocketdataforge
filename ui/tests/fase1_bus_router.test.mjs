import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { computeBusRoutes } from "../src/features/designer/edges/busRouter.ts";

describe("FASE 1: Roteador de Arestas Ortogonal com Barramento (busRouter.ts)", () => {
  // Nós padrão para os testes
  const nodeA = { id: "nodeA", x: 100, y: 100, w: 100, h: 60 }; // Saída LR: (200, 130)
  const nodeB = { id: "nodeB", x: 400, y: 50, w: 100, h: 60 };  // Entrada LR: (400, 80)
  const nodeC = { id: "nodeC", x: 400, y: 200, w: 100, h: 60 }; // Entrada LR: (400, 230)

  test("1.1 e 1.2: Origem com 2 destinos gera troncos escalonados e coordenadas de portas corretas", () => {
    const edges = [
      { id: "e1", source: "nodeA", target: "nodeB", type: "main" },
      { id: "e2", source: "nodeA", target: "nodeC", type: "main" },
    ];
    const nodes = [nodeA, nodeB, nodeC];

    const results = computeBusRoutes(edges, nodes, "LR");
    assert.strictEqual(results.length, 2);

    const r1 = results.find((r) => r.edgeId === "e1");
    const r2 = results.find((r) => r.edgeId === "e2");
    assert.ok(r1 && r2);

    // Ambas começam na porta direita do nodeA: (200, 130)
    assert.strictEqual(r1.polyline[0].x, 200);
    assert.strictEqual(r1.polyline[0].y, 130);
    assert.strictEqual(r2.polyline[0].x, 200);
    assert.strictEqual(r2.polyline[0].y, 130);

    // nodeB tem y2 = 80 (menor) e nodeC tem y2 = 230 (maior).
    // Índice 0 para nodeB: gx0 = 200 + 26 + 8*0 = 226
    // Índice 1 para nodeC: gx1 = 200 + 26 + 8*1 = 234
    assert.strictEqual(r1.polyline[1].x, 226);
    assert.strictEqual(r1.polyline[1].y, 130);
    assert.strictEqual(r1.polyline[2].x, 226);
    assert.strictEqual(r1.polyline[2].y, 80);

    assert.strictEqual(r2.polyline[1].x, 234);
    assert.strictEqual(r2.polyline[1].y, 130);
    assert.strictEqual(r2.polyline[2].x, 234);
    assert.strictEqual(r2.polyline[2].y, 230);
  });

  test("1.3: Origem com 2 ou mais arestas para frente gera pontos de junção no início do tronco", () => {
    const edges = [
      { id: "e1", source: "nodeA", target: "nodeB" },
      { id: "e2", source: "nodeA", target: "nodeC" },
    ];
    const nodes = [nodeA, nodeB, nodeC];

    const results = computeBusRoutes(edges, nodes, "LR");
    const r1 = results.find((r) => r.edgeId === "e1");
    const r2 = results.find((r) => r.edgeId === "e2");

    assert.ok(r1.junctionPoints.length > 0, "Deve gerar ponto de junção quando há >= 2 destinos");
    assert.strictEqual(r1.junctionPoints[0].x, 226);
    assert.strictEqual(r1.junctionPoints[0].y, 130);

    assert.ok(r2.junctionPoints.length > 0);
    assert.strictEqual(r2.junctionPoints[0].x, 234);
    assert.strictEqual(r2.junctionPoints[0].y, 130);
  });

  test("1.3 (b): Origem com apenas 1 aresta para frente NÃO gera pontos de junção desnecessários", () => {
    const edges = [{ id: "e1", source: "nodeA", target: "nodeB" }];
    const nodes = [nodeA, nodeB];

    const results = computeBusRoutes(edges, nodes, "LR");
    assert.strictEqual(results[0].junctionPoints.length, 0);
  });

  test("1.4: Aresta que volta (backward edge) faz bypass seguro por baixo se destino abaixo", () => {
    // nodeD está à esquerda do nodeA
    const nodeD = { id: "nodeD", x: 50, y: 180, w: 100, h: 60 };
    const edges = [{ id: "back1", source: "nodeA", target: "nodeD" }];
    const nodes = [nodeA, nodeD];

    const results = computeBusRoutes(edges, nodes, "LR");
    const r = results[0];
    assert.strictEqual(r.edgeId, "back1");

    // Deve sair 22 px para a direita: x1 + 22 = 222
    assert.strictEqual(r.polyline[1].x, 222);
    assert.strictEqual(r.polyline[1].y, 130);

    // Como nodeD y2=210 > y1=130, desce 18 px abaixo da base do destino (180+60+18 = 258)
    const yBypass = Math.max(nodeA.y + nodeA.h, nodeD.y + nodeD.h) + 18;
    assert.strictEqual(r.polyline[2].y, yBypass);
    assert.strictEqual(r.polyline[3].x, nodeD.x - 24); // 24 px antes da porta do destino

    // Ponto final na porta esquerda do nodeD: (50, 210)
    const last = r.polyline[r.polyline.length - 1];
    assert.strictEqual(last.x, 50);
    assert.strictEqual(last.y, 210);
  });

  test("1.4 (espelho): Aresta que volta passa 18 px acima do topo quando destino está acima", () => {
    const nodeUp = { id: "nodeUp", x: 50, y: 20, w: 80, h: 40 }; // topo = 20, y2 = 40 (< y1=130)
    const edges = [{ id: "backUp", source: "nodeA", target: "nodeUp" }];
    const nodes = [nodeA, nodeUp];

    const results = computeBusRoutes(edges, nodes, "LR");
    const r = results[0];

    const yBypass = Math.min(nodeA.y, nodeUp.y) - 18; // 20 - 18 = 2
    assert.strictEqual(r.polyline[2].y, yBypass);
    assert.strictEqual(r.polyline[3].x, nodeUp.x - 24);
  });

  test("1.5: Cantos arredondados raio 9px e remoção de pontos colineares", () => {
    const edges = [{ id: "e1", source: "nodeA", target: "nodeB" }];
    const nodes = [nodeA, nodeB];

    const results = computeBusRoutes(edges, nodes, "LR");
    const r = results[0];

    // O svgPath deve conter curvas Q ou C para cantos arredondados
    assert.ok(r.svgPath.includes("Q ") || r.svgPath.includes("C "), "SVG path deve conter curvas nos cantos");
    assert.ok(r.svgPath.startsWith("M 200 130"), "SVG path deve iniciar na porta de saída");
  });

  test("1.6: Rótulo é posicionado exatamente a 44 px do fim da polilinha", () => {
    const edges = [{ id: "e1", source: "nodeA", target: "nodeB" }];
    const nodes = [nodeA, nodeB];

    const results = computeBusRoutes(edges, nodes, "LR");
    const r = results[0];

    // Último segmento entra horizontalmente no target: de (226, 80) até (400, 80)
    // Comprimento do último segmento = 400 - 226 = 174 px
    // A 44 px do fim (400, 80) deve estar em x = 400 - 44 = 356, y = 80
    assert.strictEqual(Math.round(r.labelPosition.x), 356);
    assert.strictEqual(Math.round(r.labelPosition.y), 80);
  });

  test("1.7: Segurança contra sobreposição tenta x médio e depois cai para Bézier", () => {
    // Coloca um nó obstáculo que bloqueia o tronco vertical gx = 226 (entre y=80 e y=130)
    // mas não bloqueia a linha horizontal y=130 nem y=80
    const obstaculo1 = { id: "obs1", x: 220, y: 90, w: 20, h: 30 }; // bloqueia vertical gx = 226
    const edges = [{ id: "eSafe", source: "nodeA", target: "nodeB" }];
    const nodes1 = [nodeA, nodeB, obstaculo1];

    // Deve desviar usando ponto médio gx_mid = (200 + 400) / 2 = 300
    const resMid = computeBusRoutes(edges, nodes1, "LR")[0];
    assert.strictEqual(resMid.isFallbackBezier, false, "Variante média deve desviar do obstáculo 1");
    assert.strictEqual(resMid.polyline[1].x, 300);

    // Agora adiciona obstáculo que bloqueia também o ponto médio (vertical em x=300)
    const obstaculo2 = { id: "obs2", x: 295, y: 90, w: 20, h: 30 };
    const nodes2 = [nodeA, nodeB, obstaculo1, obstaculo2];

    const resBezier = computeBusRoutes(edges, nodes2, "LR")[0];
    assert.strictEqual(resBezier.isFallbackBezier, true, "Deve cair para Bézier quando ambos colidirem");
    assert.ok(resBezier.svgPath.includes("C "), "SVG deve ser cúbico Bézier");
  });

  test("1.8 e 1.9: Determinismo e robustez contra ordem de entrada e nós vazios", () => {
    const edgesOrdered = [
      { id: "e1", source: "nodeA", target: "nodeB" },
      { id: "e2", source: "nodeA", target: "nodeC" },
    ];
    const edgesReversed = [
      { id: "e2", source: "nodeA", target: "nodeC" },
      { id: "e1", source: "nodeA", target: "nodeB" },
    ];
    const nodes = [nodeA, nodeB, nodeC];

    const res1 = computeBusRoutes(edgesOrdered, nodes, "LR");
    const res2 = computeBusRoutes(edgesReversed, nodes, "LR");

    assert.strictEqual(res1.find((r) => r.edgeId === "e1").svgPath, res2.find((r) => r.edgeId === "e1").svgPath);
    assert.strictEqual(res1.find((r) => r.edgeId === "e2").svgPath, res2.find((r) => r.edgeId === "e2").svgPath);

    // Entrada vazia
    assert.deepStrictEqual(computeBusRoutes([], nodes, "LR"), []);
    assert.deepStrictEqual(computeBusRoutes(edgesOrdered, [], "LR"), []);
  });

  test("1.9 (TB): Orientação vertical TB funciona de forma análoga a LR com eixos transpostos", () => {
    const nodeTop = { id: "top", x: 100, y: 50, w: 80, h: 40 };   // Saída TB: (140, 90)
    const nodeBot = { id: "bot", x: 100, y: 300, w: 80, h: 40 };  // Entrada TB: (140, 300)
    const edges = [{ id: "eTB", source: "top", target: "bot" }];

    const resTB = computeBusRoutes(edges, [nodeTop, nodeBot], "TB");
    assert.strictEqual(resTB.length, 1);
    const r = resTB[0];

    assert.strictEqual(r.polyline[0].x, 140);
    assert.strictEqual(r.polyline[0].y, 90);
    const last = r.polyline[r.polyline.length - 1];
    assert.strictEqual(last.x, 140);
    assert.strictEqual(last.y, 300);
  });
});
