import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildJobFlowModel } from "../src/features/flow/jobFlowModel.ts";
import { computeJobFlowLayout } from "../src/features/flow/jobFlowLayout.ts";

describe("FASE 3: Modelo e Layout da View de Fluxo (jobFlowModel & jobFlowLayout)", () => {
  const sampleCells = [
    {
      id: "c1",
      name: "Célula de Entrada",
      cellType: "CANVAS",
      order: 1,
      status: "success",
      metrics: { durationMs: 120, rowsIn: 0, rowsOut: 5000 },
      is_active: true,
      nodes: [{ id: "n1", name: "CSV Input" }, { id: "n2", name: "Filter" }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
      preconditions: [],
    },
    {
      id: "c2",
      name: "Transformacao_Python",
      cellType: "PYTHON",
      order: 2,
      status: "idle",
      codeSnippet: "import pandas as pd\ndf = pd.DataFrame({'a': [1, 2]})\nprint(df)",
      is_active: true,
      preconditions: [
        { id: "p1", targetCellId: "c1", expectedStatus: "OK" },
      ],
      preconditionOperator: "AND",
    },
    {
      id: "c3",
      name: "Célula Carga",
      cellType: "CANVAS",
      order: 2,
      status: "idle",
      is_active: true,
      preconditions: [
        // Resolvido por NOME ao invés de ID
        { id: "p2", targetCellId: "Célula de Entrada", expectedStatus: "OK" },
      ],
      preconditionOperator: "AND",
    },
    {
      id: "c4",
      name: "Célula Final",
      cellType: "CANVAS",
      order: 3,
      status: "idle",
      is_active: true,
      preconditions: [
        { id: "p3", targetCellId: "c2", expectedStatus: "OK" },
        { id: "p4", targetCellId: "c3", expectedStatus: "ERROR" },
        // Referência inexistente (não deve quebrar)
        { id: "p5", targetCellId: "celula_fantasma_xyz", expectedStatus: "OK" },
      ],
      preconditionOperator: "OR",
    },
  ];

  test("3.1: Modelo extrai nós e links resolvendo targetCellId por id e por nome", () => {
    const model = buildJobFlowModel(sampleCells);

    assert.strictEqual(model.nodes.length, 4);
    assert.strictEqual(model.nodes[0].name, "Célula de Entrada");
    assert.strictEqual(model.nodes[0].order, 1);
    assert.strictEqual(model.nodes[1].name, "Transformacao_Python");

    // 4 links válidos: c1->c2 (id), c1->c3 (nome), c2->c4 (id), c3->c4 (id)
    assert.strictEqual(model.links.length, 4);

    const linkNome = model.links.find((l) => l.target === "c3");
    assert.ok(linkNome, "Link para c3 deve existir");
    assert.strictEqual(linkNome.source, "c1", "targetCellId por nome deve resolver para o id da c1");
    assert.strictEqual(linkNome.expectedStatus, "OK");

    const linkErro = model.links.find((l) => l.target === "c4" && l.expectedStatus === "ERRO");
    assert.ok(linkErro, "Link com status ERROR deve ser mapeado para ERRO");
    assert.strictEqual(linkErro.source, "c3");

    // Aviso para a referência inexistente
    const warningFantasma = model.warnings.find((w) => w.includes("celula_fantasma_xyz"));
    assert.ok(warningFantasma, "Deve gerar warning para referência inexistente");
  });

  test("3.1: Modelo detecta ciclos e conflito de ordem gerando avisos", () => {
    const cyclicCells = [
      {
        id: "a",
        name: "A",
        cellType: "CANVAS",
        order: 1,
        preconditions: [{ id: "p1", targetCellId: "b", expectedStatus: "OK" }],
      },
      {
        id: "b",
        name: "B",
        cellType: "CANVAS",
        order: 1, // Mesma ordem + dependência = conflito de paralelismo e ciclo
        preconditions: [{ id: "p2", targetCellId: "a", expectedStatus: "OK" }],
      },
    ];

    const model = buildJobFlowModel(cyclicCells);
    assert.ok(model.warnings.some((w) => w.toLowerCase().includes("ciclo") || w.toLowerCase().includes("paralel")));
  });

  test("3.2 e 3.3: Layout para 1, 2 e 3 colunas e alinhamento centralizado", () => {
    const model = buildJobFlowModel(sampleCells);
    const layout = computeJobFlowLayout(model, new Set());

    assert.strictEqual(layout.columns.length, 3);
    const col1 = layout.columns[0];
    const col2 = layout.columns[1];
    const col3 = layout.columns[2];

    assert.strictEqual(col1.order, 1);
    assert.strictEqual(col1.nodeIds.length, 1);
    assert.strictEqual(col1.isParallel, false);
    assert.strictEqual(col1.title, "ORDEM 1");

    assert.strictEqual(col2.order, 2);
    assert.strictEqual(col2.nodeIds.length, 2);
    assert.strictEqual(col2.isParallel, true);
    assert.strictEqual(col2.title, "ORDEM 2 (paralelo)");

    assert.strictEqual(col3.order, 3);
    assert.strictEqual(col3.nodeIds.length, 1);
    assert.strictEqual(col3.isParallel, false);

    // Medidas e distâncias
    assert.strictEqual(col1.x, 56);
    assert.strictEqual(col1.width, 200);
    // col2.x = 56 + 200 + 64 = 320
    assert.strictEqual(col2.x, 320);
    assert.strictEqual(col2.width, 200);
    // col3.x = 320 + 200 + 64 = 584
    assert.strictEqual(col3.x, 584);
    assert.strictEqual(col3.width, 200);

    // Altura da coluna 2 com 2 células empilhadas:
    // nó 1 (120) + gap (28) + nó 2 (120) = 268 px
    assert.strictEqual(col2.height, 268);

    // Colunas de nó único (col1 e col3) centralizam na altura máxima (268)
    const nodeC1 = layout.nodes.find((n) => n.id === "c1");
    const nodeC4 = layout.nodes.find((n) => n.id === "c4");
    assert.ok(nodeC1 && nodeC4);
    const expectedCenterY = layout.marginTop + (268 - 120) / 2;
    assert.strictEqual(nodeC1.y, expectedCenterY);
    assert.strictEqual(nodeC4.y, expectedCenterY);
  });

  test("3.2: Expandir uma célula desloca somente a coluna dela e as seguintes", () => {
    const model = buildJobFlowModel(sampleCells);

    // Recolhido
    const layoutCollapsed = computeJobFlowLayout(model, new Set());
    assert.strictEqual(layoutCollapsed.columns[0].x, 56);
    assert.strictEqual(layoutCollapsed.columns[1].x, 320);
    assert.strictEqual(layoutCollapsed.columns[2].x, 584);

    // Expandir célula c2 (coluna 2)
    const layoutExpanded = computeJobFlowLayout(model, new Set(["c2"]));
    // Coluna 1 não muda
    assert.strictEqual(layoutExpanded.columns[0].x, 56);
    assert.strictEqual(layoutExpanded.columns[0].width, 200);

    // Coluna 2 expande para 540 px
    assert.strictEqual(layoutExpanded.columns[1].x, 320);
    assert.strictEqual(layoutExpanded.columns[1].width, 540);

    // Coluna 3 desloca: 320 + 540 + 64 = 924
    assert.strictEqual(layoutExpanded.columns[2].x, 924);
  });

  test("3.4: Portas de ligação diferenciam ícone recolhido vs expandido", () => {
    const model = buildJobFlowModel(sampleCells);
    const layoutCollapsed = computeJobFlowLayout(model, new Set());
    const c1Col = layoutCollapsed.nodes.find((n) => n.id === "c1");
    // Recolhido: centro do lado (y + h / 2)
    assert.strictEqual(c1Col.ports.output.y, c1Col.y + 120 / 2);
    assert.strictEqual(c1Col.ports.output.x, c1Col.x + 200);

    const layoutExpanded = computeJobFlowLayout(model, new Set(["c1"]));
    const c1Exp = layoutExpanded.nodes.find((n) => n.id === "c1");
    // Expandido: 26 px do topo
    assert.strictEqual(c1Exp.ports.output.y, c1Exp.y + 26);
    assert.strictEqual(c1Exp.ports.output.x, c1Exp.x + 540);
  });

  test("3.6: Células sem ordem ou com ordem repetida não quebram o layout", () => {
    const disorderedCells = [
      { id: "x1", name: "Sem Ordem 1", cellType: "CANVAS", preconditions: [] },
      { id: "x2", name: "Sem Ordem 2", cellType: "CANVAS", preconditions: [] },
      { id: "x3", name: "Ordem 5", order: 5, cellType: "PYTHON", preconditions: [] },
    ];
    const model = buildJobFlowModel(disorderedCells);
    const layout = computeJobFlowLayout(model, new Set());

    assert.ok(layout.columns.length > 0);
    assert.strictEqual(layout.nodes.length, 3);
  });

  test("3.6: Benchmark de performance: 100 células calculam layout em menos de 25ms", () => {
    const manyCells = [];
    for (let i = 0; i < 100; i++) {
      const order = Math.floor(i / 5) + 1; // 20 colunas de 5 células cada
      const pre = i > 0 ? [{ id: `p_${i}`, targetCellId: `cell_${i - 1}`, expectedStatus: "OK" }] : [];
      manyCells.push({
        id: `cell_${i}`,
        name: `Célula ${i}`,
        cellType: i % 2 === 0 ? "CANVAS" : "PYTHON",
        order,
        status: "idle",
        codeSnippet: "x = 10\ny = 20",
        preconditions: pre,
      });
    }

    const t0 = performance.now();
    const model = buildJobFlowModel(manyCells);
    const layout = computeJobFlowLayout(model, new Set(["cell_2", "cell_10", "cell_50"]));
    const duration = performance.now() - t0;

    console.log(`\n[BENCHMARK] Layout de 100 células executado em ${duration.toFixed(2)} ms`);
    assert.ok(duration < 25, `Layout deve calcular em menos de 25ms, levou ${duration.toFixed(2)}ms`);
    assert.strictEqual(layout.nodes.length, 100);
    assert.strictEqual(layout.columns.length, 20);
  });
});
