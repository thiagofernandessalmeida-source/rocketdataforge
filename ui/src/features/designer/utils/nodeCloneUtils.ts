/**
 * Utilitário canônico de clonagem profunda e isolamento de nós e arestas (Tarefa 3).
 * Garante que cópia, colagem, duplicação de componente e duplicação de célula
 * compartilhem zero referências em memória, atribuam IDs únicos e limpem referências externas.
 */

export interface Edge {
  id: string;
  source: string;
  target: string;
  [key: string]: any;
}

export function generateRocketNodeId(typeId: string, existingNodes: any[] = []): string {
  let prefix = "node";
  if (typeId.includes("postgresql.output") || typeId.includes("postgres.output")) prefix = "postgres_sink";
  else if (typeId.includes("postgresql") || typeId.includes("postgres") || typeId.includes("database.source")) prefix = "postgres_source";
  else if (typeId.includes("duckdb.output")) prefix = "duckdb_sink";
  else if (typeId.includes("duckdb")) prefix = "duckdb_source";
  else if (typeId.includes("oracle.output")) prefix = "oracle_sink";
  else if (typeId.includes("oracle")) prefix = "oracle_source";
  else if (typeId.includes("sqlserver.output")) prefix = "sqlserver_sink";
  else if (typeId.includes("sqlserver")) prefix = "sqlserver_source";
  else if (typeId.includes("mysql.output")) prefix = "mysql_sink";
  else if (typeId.includes("mysql")) prefix = "mysql_source";
  else if (typeId.includes("file.source.csv") || typeId.includes(".csv")) prefix = "csv_source";
  else if (typeId.includes("file.source.parquet") || typeId.includes(".parquet")) prefix = "parquet_source";
  else if (typeId.includes("file.source.json") || typeId.includes(".json")) prefix = "json_source";
  else if (typeId.includes("file.source.excel") || typeId.includes(".excel")) prefix = "excel_source";
  else if (typeId.includes("file.target")) prefix = "file_sink";
  else if (typeId.includes("file.source")) prefix = "file_source";
  else if (typeId.includes("tmap") || typeId.includes("mapper")) prefix = "data_mapper";
  else if (typeId.includes("filter")) prefix = "filter";
  else if (typeId.includes("select")) prefix = "project";
  else if (typeId.includes("join")) prefix = "join";
  else if (typeId.includes("aggregate")) prefix = "aggregate";
  else if (typeId.includes("sort")) prefix = "sort";
  else if (typeId.includes("deduplicate")) prefix = "dedup";
  else if (typeId.includes("lookup")) prefix = "lookup";
  else if (typeId.includes("union")) prefix = "union";
  else if (typeId.includes("pivot")) prefix = "pivot";
  else {
    const last = typeId.split(".").pop() || "node";
    prefix = last.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  }

  const existingIds = new Set(existingNodes.map((n) => n.id));
  let counter = 1;
  while (existingIds.has(`${prefix}_${counter}`)) {
    counter++;
  }
  return `${prefix}_${counter}`;
}

export function remapNodeReferences<T = any>(obj: T, idMap: Record<string, string>): T {
  if (!obj || Object.keys(idMap).length === 0) return obj;

  if (typeof obj === "string") {
    let result: string = obj;
    for (const [oldId, newId] of Object.entries(idMap)) {
      if (result === oldId) return newId as any;
      const re = new RegExp(`\\b${oldId}\\b`, "g");
      result = result.replace(re, newId);
    }
    return result as any;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => remapNodeReferences(item, idMap)) as any;
  }

  if (typeof obj === "object") {
    const copy: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (idMap[k]) {
        copy[idMap[k]] = remapNodeReferences(v, idMap);
      } else {
        copy[k] = remapNodeReferences(v, idMap);
      }
    }
    return copy as any;
  }

  return obj;
}

export interface CloneNodesOptions {
  targetCellId: string;
  existingNodes: any[];
  sourceNodeSchemas?: Record<string, any[]>;
  offset?: { x: number; y: number };
}

export interface CloneResult {
  clonedNodes: any[];
  clonedEdges: any[];
  clonedSchemas: Record<string, any[]>;
  idMap: Record<string, string>;
}

export function cloneNodes(
  nodesToClone: any[],
  edgesToClone: any[] = [],
  options: CloneNodesOptions
): CloneResult {
  if (!nodesToClone || nodesToClone.length === 0) {
    return { clonedNodes: [], clonedEdges: [], clonedSchemas: {}, idMap: {} };
  }

  // 1. Clone profundo de nós e arestas para isolamento absoluto de referências
  const rawNodes: any[] = JSON.parse(JSON.stringify(nodesToClone));
  const rawEdges: Edge[] = JSON.parse(JSON.stringify(edgesToClone || []));

  const sourceNodeIds = new Set(rawNodes.map((n) => n.id));
  const idMap: Record<string, string> = {};
  const accumulatedForIdGen: any[] = [...options.existingNodes];

  // 2. Geração determinística de IDs canônicos
  for (const n of rawNodes) {
    const compType = n.data?.componentType || "node";
    const newId = generateRocketNodeId(compType, accumulatedForIdGen);
    idMap[n.id] = newId;
    accumulatedForIdGen.push({ ...n, id: newId });
  }

  // 3. Filtragem de arestas: apenas arestas cujos dois extremos estão dentro da seleção
  const internalEdges = rawEdges.filter(
    (e) => sourceNodeIds.has(e.source) && sourceNodeIds.has(e.target)
  );

  // 4. Clonagem e remapeamento de nós
  const clonedNodes: any[] = rawNodes.map((n, idx) => {
    const newId = idMap[n.id];
    const deepData = remapNodeReferences(n.data || {}, idMap);

    // Limpa referências a nós que não fazem parte do conjunto clonado
    if (deepData.config) {
      const origMainInput = n.data?.config?.main_input_id;
      if (origMainInput) {
        if (sourceNodeIds.has(origMainInput)) {
          deepData.config.main_input_id = idMap[origMainInput];
        } else {
          delete deepData.config.main_input_id;
        }
      }
      if (Array.isArray(n.data?.config?.lookups)) {
        deepData.config.lookups = n.data.config.lookups
          .filter((lk: any) => lk.node_id && sourceNodeIds.has(lk.node_id))
          .map((lk: any) => ({
            ...remapNodeReferences(lk, idMap),
            node_id: idMap[lk.node_id] || lk.node_id,
          }));
      }
    }

    // Zera estados efêmeros e ajusta cellId
    deepData.status = undefined;
    deepData.metrics = undefined;
    deepData.cellId = options.targetCellId;

    // Resolução de nomes: adiciona '(Cópia)' somente se houver colisão de label na célula de destino
    const hasLabelCollision = options.existingNodes.some(
      (en) =>
        en.data?.cellId === options.targetCellId &&
        en.data?.label === deepData.label
    );
    if (hasLabelCollision) {
      deepData.label = `${deepData.label || newId} (Cópia)`;
    }

    const offsetX = (options.offset?.x ?? 35) * (idx + 1);
    const offsetY = (options.offset?.y ?? 35) * (idx + 1);

    return {
      ...n,
      id: newId,
      position: {
        x: n.position.x + offsetX,
        y: n.position.y + offsetY,
      },
      selected: false,
      data: deepData,
    };
  });

  // 5. Clonagem e remapeamento de arestas internas
  const clonedEdges: any[] = internalEdges.map((e) => {
    const deepData = remapNodeReferences(e.data || {}, idMap);
    return {
      ...e,
      id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      source: idMap[e.source] || e.source,
      target: idMap[e.target] || e.target,
      selected: false,
      data: deepData,
    };
  });

  // 6. Cópia profunda dos schemas das colunas
  const clonedSchemas: Record<string, any[]> = {};
  if (options.sourceNodeSchemas) {
    for (const [oldId, schema] of Object.entries(options.sourceNodeSchemas)) {
      if (idMap[oldId]) {
        clonedSchemas[idMap[oldId]] = JSON.parse(JSON.stringify(schema));
      }
    }
  }

  return {
    clonedNodes,
    clonedEdges,
    clonedSchemas,
    idMap,
  };
}
