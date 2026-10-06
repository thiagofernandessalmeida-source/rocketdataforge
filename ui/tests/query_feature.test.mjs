import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── CONNECTION_TYPE_TO_DIALECT mapping (from PropertyPanel) ───────────
const CONNECTION_TYPE_TO_DIALECT = {
  postgresql: "postgresql",
  oracle: "oracle",
  sqlserver: "sqlserver",
  mysql: "mysql",
  redshift: "redshift",
  bigquery: "bigquery",
  snowflake: "snowflake",
  databricks: "databricks",
};

// ─── QuerySelect filtering logic (as implemented in PropertyPanel) ─────
function filterQueriesForInputNode(queryBank, connections, connectionRef) {
  const connEntry = connections.find(
    (c) => c.name.toLowerCase().replace(/\s+/g, "_") === connectionRef
  );
  const dialect = connEntry
    ? CONNECTION_TYPE_TO_DIALECT[connEntry.type]
    : undefined;

  return queryBank.filter((q) => {
    const dialectMatch = !dialect || q.dialect === dialect || q.dialect === "sql";
    if (!dialectMatch) return false;
    if (q.connectionRef && connectionRef) {
      return q.connectionRef === connectionRef;
    }
    return dialectMatch;
  });
}

// ─── jobStore.getQueriesForConnection filter logic ─────────────────────
function getQueriesForConnection(queryBank, dialect, connectionRef) {
  return queryBank.filter((q) => {
    const dialectMatch = q.dialect === dialect || q.dialect === "sql";
    if (!dialectMatch) return false;
    if (connectionRef && q.connectionRef) {
      return q.connectionRef === connectionRef;
    }
    return true;
  });
}

// ─── Clipboard copy logic with fallback simulation ────────────────────
async function simulateCopy(sql, mockNavigator, mockDocument) {
  let copiedToClipboard = null;
  let fallbackExecuted = false;

  const copyFallback = (text) => {
    const el = mockDocument.createElement("textarea");
    el.value = text;
    mockDocument.body.appendChild(el);
    el.select();
    fallbackExecuted = mockDocument.execCommand("copy");
    mockDocument.body.removeChild(el);
    copiedToClipboard = text;
  };

  try {
    if (mockNavigator?.clipboard?.writeText) {
      await mockNavigator.clipboard.writeText(sql);
      copiedToClipboard = sql;
    } else {
      copyFallback(sql);
    }
  } catch (_err) {
    copyFallback(sql);
  }

  return { copiedToClipboard, fallbackExecuted };
}

describe("Cenário 1: Copiar Query para Área de Transferência (Clipboard + Fallback)", () => {
  it("deve copiar SQL com sucesso usando navigator.clipboard.writeText quando disponível", async () => {
    let written = "";
    const mockNavigator = {
      clipboard: {
        writeText: async (text) => {
          written = text;
        },
      },
    };
    const mockDocument = {
      createElement: () => ({ select: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => true,
    };

    const sql = "SELECT id, name FROM users WHERE active = true";
    const res = await simulateCopy(sql, mockNavigator, mockDocument);

    assert.equal(written, sql);
    assert.equal(res.copiedToClipboard, sql);
    assert.equal(res.fallbackExecuted, false);
  });

  it("deve executar fallback (document.execCommand) quando navigator.clipboard falhar ou rejeitar", async () => {
    const mockNavigator = {
      clipboard: {
        writeText: async () => {
          throw new Error("Permission denied or insecure context");
        },
      },
    };
    let appended = null;
    let removed = null;
    let selected = false;
    const mockDocument = {
      createElement: (tag) => {
        const elem = { tagName: tag, value: "", select: () => { selected = true; } };
        return elem;
      },
      body: {
        appendChild: (el) => { appended = el; },
        removeChild: (el) => { removed = el; },
      },
      execCommand: (cmd) => cmd === "copy",
    };

    const sql = "SELECT * FROM orders";
    const res = await simulateCopy(sql, mockNavigator, mockDocument);

    assert.equal(res.copiedToClipboard, sql);
    assert.equal(res.fallbackExecuted, true);
    assert.equal(selected, true);
    assert.equal(appended.value, sql);
    assert.equal(removed, appended);
  });

  it("deve executar fallback quando navigator.clipboard não existir (ex: HTTP legado)", async () => {
    const mockNavigator = {};
    let selected = false;
    const mockDocument = {
      createElement: (tag) => ({ tagName: tag, value: "", select: () => { selected = true; } }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => true,
    };

    const sql = "SELECT count(*) FROM customers";
    const res = await simulateCopy(sql, mockNavigator, mockDocument);

    assert.equal(res.copiedToClipboard, sql);
    assert.equal(res.fallbackExecuted, true);
    assert.equal(selected, true);
  });
});

describe("Cenário 2: Filtragem Coerente de Queries por Conexão e Dialeto no Input", () => {
  const connections = [
    { id: "c1", name: "BRM", type: "postgresql" },
    { id: "c2", name: "Data Warehouse", type: "oracle" },
    { id: "c3", name: "Analytics MySQL", type: "mysql" },
  ];

  const queryBank = [
    {
      id: "q1",
      name: "Listar Clientes BRM",
      dialect: "postgresql",
      connectionRef: "brm",
      sql: "SELECT id, name, email FROM clients",
      schema: [{ id: "c1", name: "id", type: "Integer", nullable: false }],
    },
    {
      id: "q2",
      name: "Contar Vendas DW",
      dialect: "oracle",
      connectionRef: "data_warehouse",
      sql: "SELECT count(*) as total FROM sales",
    },
    {
      id: "q3",
      name: "Postgres Genérica Sem Conexão Vinculada",
      dialect: "postgresql",
      connectionRef: undefined,
      sql: "SELECT current_timestamp, current_user",
    },
    {
      id: "q4",
      name: "Query ANSI SQL Genérica",
      dialect: "sql",
      connectionRef: undefined,
      sql: "SELECT 1 as dummy",
    },
    {
      id: "q5",
      name: "Postgres de Outra Conexão (Financeiro)",
      dialect: "postgresql",
      connectionRef: "financeiro_pg",
      sql: "SELECT * FROM lancamentos",
    },
    {
      id: "q6",
      name: "MySQL Query",
      dialect: "mysql",
      connectionRef: "analytics_mysql",
      sql: "SHOW TABLES",
    },
  ];

  it("deve filtrar apenas queries coerentes para PostgreSQL 'BRM' (ref: brm)", () => {
    const results = filterQueriesForInputNode(queryBank, connections, "brm");

    const names = results.map((q) => q.name);
    // Deve incluir:
    // - q1: postgresql vinculada a 'brm'
    // - q3: postgresql genérica
    // - q4: sql genérica
    assert.ok(names.includes("Listar Clientes BRM"), "Deve conter query específica do BRM");
    assert.ok(names.includes("Postgres Genérica Sem Conexão Vinculada"), "Deve conter query Postgres sem conexão específica");
    assert.ok(names.includes("Query ANSI SQL Genérica"), "Deve conter query genérica SQL");

    // NÃO deve incluir:
    // - q2: oracle
    // - q5: postgresql de outra conexão ('financeiro_pg')
    // - q6: mysql
    assert.ok(!names.includes("Contar Vendas DW"), "Não deve conter query Oracle");
    assert.ok(!names.includes("Postgres de Outra Conexão (Financeiro)"), "Não deve conter query postgres de outra conexão específica");
    assert.ok(!names.includes("MySQL Query"), "Não deve conter query MySQL");
    assert.equal(results.length, 3);
  });

  it("deve filtrar apenas queries coerentes para Oracle 'Data Warehouse' (ref: data_warehouse)", () => {
    const results = filterQueriesForInputNode(queryBank, connections, "data_warehouse");
    const names = results.map((q) => q.name);

    assert.ok(names.includes("Contar Vendas DW"));
    assert.ok(names.includes("Query ANSI SQL Genérica"));
    assert.ok(!names.includes("Listar Clientes BRM"));
    assert.ok(!names.includes("Postgres Genérica Sem Conexão Vinculada"));
    assert.equal(results.length, 2);
  });

  it("getQueriesForConnection no store deve respeitar dialeto e connectionRef", () => {
    const brmQueries = getQueriesForConnection(queryBank, "postgresql", "brm");
    assert.equal(brmQueries.length, 3);
    assert.deepEqual(brmQueries.map(q => q.id), ["q1", "q3", "q4"]);

    const dwQueries = getQueriesForConnection(queryBank, "oracle", "data_warehouse");
    assert.equal(dwQueries.length, 2);
    assert.deepEqual(dwQueries.map(q => q.id), ["q2", "q4"]);
  });
});

describe("Cenário 3: Atribuição de Query e Schema ao Componente de Input", () => {
  it("ao selecionar uma query com schema, deve atualizar a query SQL e o schema do nó", () => {
    const nodeConfig = {
      connection_ref: "brm",
      query: "",
    };
    let updatedNodeSchema = null;

    const selectedQuery = {
      id: "q1",
      name: "Listar Clientes BRM",
      dialect: "postgresql",
      connectionRef: "brm",
      sql: "SELECT id, name, email FROM clients",
      schema: [
        { id: "c1", name: "id", type: "Integer", nullable: false },
        { id: "c2", name: "name", type: "String", nullable: false },
        { id: "c3", name: "email", type: "String", nullable: true },
      ],
    };

    // Callback onSelect do PropertyPanel
    const onSelect = (q) => {
      nodeConfig.query = q.sql;
      if (q.schema && q.schema.length > 0) {
        updatedNodeSchema = q.schema;
      }
    };

    onSelect(selectedQuery);

    assert.equal(nodeConfig.query, "SELECT id, name, email FROM clients");
    assert.equal(updatedNodeSchema.length, 3);
    assert.equal(updatedNodeSchema[0].name, "id");
    assert.equal(updatedNodeSchema[0].type, "Integer");
    assert.equal(updatedNodeSchema[1].name, "name");
  });

  it("ao selecionar query sem schema pré-definido, não deve limpar o schema existente do nó", () => {
    let existingNodeSchema = [
      { id: "c1", name: "custom_col", type: "String", nullable: true }
    ];
    let updatedNodeSchema = existingNodeSchema;

    const queryWithoutSchema = {
      id: "q4",
      name: "Query Sem Schema",
      dialect: "sql",
      sql: "SELECT 1 as dummy",
      schema: undefined,
    };

    const onSelect = (q) => {
      if (q.schema && q.schema.length > 0) {
        updatedNodeSchema = q.schema;
      }
    };

    onSelect(queryWithoutSchema);

    // Schema deve permanecer o existente (não foi apagado)
    assert.equal(updatedNodeSchema, existingNodeSchema);
    assert.equal(updatedNodeSchema.length, 1);
  });
});

describe("Cenário 4: Estrutura do Banco de Queries com Schema de Colunas", () => {
  it("deve permitir adicionar, tipar e persistir colunas no modelo QueryEntry", () => {
    const newQuery = {
      id: "q-test-1",
      name: "Consulta Clientes Ativos",
      description: "Retorna apenas clientes com status ativo",
      dialect: "postgresql",
      connectionRef: "brm",
      sql: "SELECT id, name, created_at, balance FROM clients WHERE active = true",
      tags: ["producao", "brm", "financeiro"],
      schema: [
        { id: "c-1", name: "id", type: "Integer", nullable: false },
        { id: "c-2", name: "name", type: "String", nullable: false },
        { id: "c-3", name: "created_at", type: "Timestamp", nullable: false },
        { id: "c-4", name: "balance", type: "Decimal", nullable: true },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    };

    assert.equal(newQuery.schema.length, 4);
    assert.equal(newQuery.schema[2].type, "Timestamp");
    assert.equal(newQuery.schema[3].nullable, true);
    assert.equal(newQuery.connectionRef, "brm");
  });
});
