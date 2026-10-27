/**
 * Utilitário de Cópia e Colagem de Schemas (Clipboard)
 * MIME type canônico: application/x-rdf-schema+json com fallback para TSV
 */

export const SCHEMA_MIME_TYPE = "application/x-rdf-schema+json";

export function generateColumnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `col-${crypto.randomUUID()}`;
  }
  return `col-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;
}

/**
 * Serializa colunas para payload JSON canônico e TSV de fallback.
 */
export function serializeSchemaColumns(columns) {
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
      defaultValue: c.defaultValue
    }))
  };

  const jsonStr = JSON.stringify(payload, null, 2);

  // Formato Tab-Separated Values (TSV) para colagem externa (Excel, Calc, Notepad)
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
export function deserializeSchemaColumns(data, mimeType) {
  if (!data || typeof data !== "string") {
    return [];
  }

  const trimmed = data.trim();
  if (!trimmed) return [];

  // 1. Tenta decodificar como JSON com MIME application/x-rdf-schema+json ou formato raw
  if (mimeType === SCHEMA_MIME_TYPE || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawCols = Array.isArray(parsed) ? parsed : (parsed.columns || []);
      if (Array.isArray(rawCols) && rawCols.length > 0) {
        return rawCols.map(c => ({
          ...c,
          id: generateColumnId(), // RF-06.3: Sempre gera novos UUIDs para colunas coladas
          name: String(c.name || "col").trim(),
          type: c.type || "String",
          nullable: c.nullable !== false,
          isPrimaryKey: !!c.isPrimaryKey
        }));
      }
    } catch {
      // Se falhar o parse JSON, prossegue para o parser de TSV
    }
  }

  // 2. Parser de fallback para TSV / Texto Tabulado
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  let startIdx = 0;
  // Detecta se a primeira linha é cabeçalho TSV
  const firstLineCols = lines[0].split("\t").map(s => s.trim().toLowerCase());
  if (firstLineCols.includes("name") || firstLineCols.includes("coluna") || firstLineCols.includes("type")) {
    startIdx = 1;
  }

  const result = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split("\t").map(s => s.trim());
    if (parts.length > 0 && parts[0]) {
      const name = parts[0];
      const type = parts[1] || "String";
      const nullable = parts[2] !== undefined ? parts[2].toLowerCase() !== "false" : true;
      const isPrimaryKey = parts[3] ? parts[3].toLowerCase() === "true" : false;
      const comment = parts[4] || undefined;

      result.push({
        id: generateColumnId(),
        name,
        type,
        nullable,
        isPrimaryKey,
        comment
      });
    }
  }

  return result;
}

/**
 * Resolve conflitos de colunas existentes vs novas colunas (overwrite, skip, rename).
 */
export function resolveSchemaCollisions(existing, incoming, strategy = "overwrite") {
  const existingList = Array.isArray(existing) ? [...existing] : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];

  if (incomingList.length === 0) return existingList;

  if (strategy === "skip") {
    const existingNames = new Set(existingList.map(c => c.name.toLowerCase()));
    const toAdd = incomingList.filter(c => !existingNames.has(c.name.toLowerCase()));
    return [...existingList, ...toAdd];
  }

  if (strategy === "rename") {
    const existingNames = new Set(existingList.map(c => c.name.toLowerCase()));
    const renamedIncoming = incomingList.map(inc => {
      let candidate = inc.name;
      if (existingNames.has(candidate.toLowerCase())) {
        let counter = 1;
        while (existingNames.has(`${inc.name}_${counter}`.toLowerCase())) {
          counter++;
        }
        candidate = `${inc.name}_${counter}`;
      }
      existingNames.add(candidate.toLowerCase());
      return { ...inc, name: candidate };
    });
    return [...existingList, ...renamedIncoming];
  }

  // Padrão: "overwrite"
  const resultMap = new Map();
  for (const c of existingList) {
    resultMap.set(c.name.toLowerCase(), { ...c });
  }
  for (const inc of incomingList) {
    const lower = inc.name.toLowerCase();
    if (resultMap.has(lower)) {
      // Sobrescreve mantendo o ID da coluna existente para estabilidade
      const prev = resultMap.get(lower);
      resultMap.set(lower, { ...inc, id: prev.id });
    } else {
      resultMap.set(lower, { ...inc });
    }
  }

  return Array.from(resultMap.values());
}

export async function copyColumnsToClipboard(columns) {
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
    // Fallback
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      return true;
    }
  } catch {
    // Falha silenciosa
  }

  return false;
}

export async function readColumnsFromClipboard() {
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
    // Fallback
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        return deserializeSchemaColumns(text);
      }
    }
  } catch {
    // Sem acesso
  }

  return null;
}

