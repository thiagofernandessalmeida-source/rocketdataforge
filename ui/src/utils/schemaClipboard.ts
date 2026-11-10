import { SchemaColumn, SchemaColumnType } from "../store/jobStore";

export const SCHEMA_MIME_TYPE = "application/x-rdf-schema+json";

export function generateColumnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `col-${crypto.randomUUID()}`;
  }
  return `col-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;
}

export type CollisionStrategy = "overwrite" | "skip" | "rename";

export interface SerializedSchemaResult {
  mime: string;
  json: string;
  tsv: string;
}

/**
 * Serializa colunas para payload JSON canônico e TSV de fallback.
 */
export function serializeSchemaColumns(columns: SchemaColumn[]): SerializedSchemaResult {
  if (!Array.isArray(columns) || columns.length === 0) {
    return { mime: SCHEMA_MIME_TYPE, json: "", tsv: "" };
  }

  const payload = {
    mime: SCHEMA_MIME_TYPE,
    version: 1,
    timestamp: new Date().toISOString(),
    columns: columns.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type || "String",
      nullable: c.nullable !== false,
      length: c.length,
      precision: c.precision,
      scale: c.scale,
      format: c.format,
      comment: c.comment,
      isPrimaryKey: !!c.isPrimaryKey,
      defaultValue: c.defaultValue,
      masking: c.masking,
      maskingSalt: c.maskingSalt
    }))
  };


  const jsonStr = JSON.stringify(payload, null, 2);

  const header = "name\ttype\tnullable\tisPrimaryKey\tcomment";
  const rows = columns.map(c => 
    `${c.name || ""}\t${c.type || "String"}\t${c.nullable !== false}\t${!!c.isPrimaryKey}\t${(c.comment || "").replace(/[\r\n\t]/g, " ")}`
  );
  const tsvStr = [header, ...rows].join("\n");

  return {
    mime: SCHEMA_MIME_TYPE,
    json: jsonStr,
    tsv: tsvStr
  };
}

/**
 * Desserializa dados da área de transferência gerando novos UUIDs para as colunas.
 */
export function deserializeSchemaColumns(data: string, mimeType?: string): SchemaColumn[] {
  if (!data || typeof data !== "string") {
    return [];
  }

  const trimmed = data.trim();
  if (!trimmed) return [];

  if (mimeType === SCHEMA_MIME_TYPE || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawCols = Array.isArray(parsed) ? parsed : (parsed.columns || []);
      if (Array.isArray(rawCols) && rawCols.length > 0) {
        return rawCols.map((c: any) => ({
          ...c,
          id: generateColumnId(), // RF-06.3: Sempre gera novos UUIDs para colunas coladas
          name: String(c.name || "col").trim(),
          type: (c.type as SchemaColumnType) || "String",
          nullable: c.nullable !== false,
          isPrimaryKey: !!c.isPrimaryKey
        }));
      }
    } catch {
      // Falha de parse JSON: prossegue para TSV
    }
  }

  // Parser de fallback para TSV
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  let startIdx = 0;
  const firstLineCols = lines[0].split("\t").map(s => s.trim().toLowerCase());
  if (firstLineCols.includes("name") || firstLineCols.includes("coluna") || firstLineCols.includes("type")) {
    startIdx = 1;
  }

  const result: SchemaColumn[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split("\t").map(s => s.trim());
    if (parts.length === 0 || !parts[0]) continue;

    const colName = parts[0];
    const colType = (parts[1] || "String") as SchemaColumnType;
    const nullable = parts[2] !== "false";
    const isPrimaryKey = parts[3] === "true" || parts[3] === "1";
    const comment = parts[4] || "";

    result.push({
      id: generateColumnId(),
      name: colName,
      type: colType,
      nullable,
      isPrimaryKey,
      comment
    });
  }

  return result;
}

/**
 * Resolve conflitos de colunas baseado na estratégia:
 * - 'overwrite': substitui colunas existentes com o mesmo nome
 * - 'skip': ignora colunas recebidas que já existam
 * - 'rename': renomeia colunas novas duplicadas adicionando sufixo _copy
 */
export function resolveSchemaCollisions(
  currentColumns: SchemaColumn[],
  incomingColumns: SchemaColumn[],
  strategy: CollisionStrategy = "overwrite"
): SchemaColumn[] {
  if (!incomingColumns || incomingColumns.length === 0) {
    return [...currentColumns];
  }

  if (strategy === "skip") {
    const existingNames = new Set(currentColumns.map(c => c.name.toLowerCase()));
    const toAdd = incomingColumns.filter(c => !existingNames.has(c.name.toLowerCase()));
    return [...currentColumns, ...toAdd];
  }

  if (strategy === "overwrite") {
    const incomingMap = new Map(incomingColumns.map(c => [c.name.toLowerCase(), c]));
    const result: SchemaColumn[] = [];

    for (const c of currentColumns) {
      const match = incomingMap.get(c.name.toLowerCase());
      if (match) {
        result.push({
          ...match,
          id: c.id // Mantém ID original para preservação de referências no componente
        });
        incomingMap.delete(c.name.toLowerCase());
      } else {
        result.push(c);
      }
    }

    // Adiciona as colunas restantes de entrada que não existiam previamente
    for (const remaining of incomingMap.values()) {
      result.push(remaining);
    }

    return result;
  }

  if (strategy === "rename") {
    const existingNames = new Set(currentColumns.map(c => c.name.toLowerCase()));
    const result = [...currentColumns];

    for (const inc of incomingColumns) {
      let finalName = inc.name;
      let counter = 1;

      while (existingNames.has(finalName.toLowerCase())) {
        finalName = `${inc.name}_copy${counter > 1 ? counter : ""}`;
        counter++;
      }

      existingNames.add(finalName.toLowerCase());
      result.push({
        ...inc,
        id: generateColumnId(),
        name: finalName
      });
    }

    return result;
  }

  return [...currentColumns, ...incomingColumns];
}

export async function copyColumnsToClipboard(columns: SchemaColumn[]): Promise<boolean> {
  if (!columns || columns.length === 0) return false;
  const { json, tsv } = serializeSchemaColumns(columns);

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      const jsonBlob = new Blob([json], { type: SCHEMA_MIME_TYPE });
      const textBlob = new Blob([tsv], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          [SCHEMA_MIME_TYPE]: jsonBlob,
          "text/plain": textBlob
        })
      ]);
      return true;
    }
  } catch {
    // Fallback para text puro via clipboard API
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      return true;
    }
  } catch {
    // Falha silenciosa de permissão
  }

  return false;
}

export async function readColumnsFromClipboard(): Promise<SchemaColumn[] | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes(SCHEMA_MIME_TYPE)) {
          const blob = await item.getType(SCHEMA_MIME_TYPE);
          const text = await blob.text();
          return deserializeSchemaColumns(text, SCHEMA_MIME_TYPE);
        }
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          return deserializeSchemaColumns(text, "text/plain");
        }
      }
    }
  } catch {
    // Fallback de permissão de leitura
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        return deserializeSchemaColumns(text);
      }
    }
  } catch {
    // Sem acesso ao clipboard
  }

  return null;
}
