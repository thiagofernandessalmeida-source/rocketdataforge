/**
 * Utilitários puros para Field Options (estilo tDBOutput do Talend) e validação de chaves DML.
 */

export interface FieldOption {
  column: string;
  update_key: boolean;
  deletion_key: boolean;
  updatable: boolean;
  insertable: boolean;
}

export function syncFieldOptionsWithSchema(
  currentFieldOptions: FieldOption[] | undefined,
  schema: Array<{ name: string; isPrimaryKey?: boolean; is_primary_key?: boolean }>
): FieldOption[] {
  const currentMap = new Map((currentFieldOptions || []).map((fo) => [fo.column, fo]));
  return (schema || []).map((col) => {
    const existing = currentMap.get(col.name);
    if (existing) {
      return {
        column: col.name,
        update_key: Boolean(existing.update_key),
        deletion_key: Boolean(existing.deletion_key),
        updatable: existing.updatable !== false,
        insertable: existing.insertable !== false,
      };
    }
    return {
      column: col.name,
      update_key: false,
      deletion_key: false,
      updatable: true,
      insertable: true,
    };
  });
}

export function validateSinkKeys(
  dataAction: string = "insert",
  useFieldOptions: boolean = false,
  fieldOptions: FieldOption[] | undefined = [],
  schema: Array<{ name: string; isPrimaryKey?: boolean; is_primary_key?: boolean }> = [],
  legacyKeys: string[] | undefined = []
): { isValid: boolean; missingKeyType: "update" | "delete" | null; warningMessage: string | null } {
  const act = (dataAction || "insert").toLowerCase().trim();

  if (["update", "update_or_insert", "insert_or_update", "upsert"].includes(act)) {
    let hasKey = false;
    if (useFieldOptions && fieldOptions && fieldOptions.length > 0) {
      hasKey = fieldOptions.some((fo) => fo.update_key);
    } else {
      hasKey = Boolean((legacyKeys && legacyKeys.length > 0) || (schema && schema.some((c) => c.isPrimaryKey || c.is_primary_key)));
    }
    if (!hasKey) {
      return {
        isValid: false,
        missingKeyType: "update",
        warningMessage: "Esta ação requer ao menos uma chave definida nas Configurações avançadas.",
      };
    }
  } else if (act === "delete") {
    let hasKey = false;
    if (useFieldOptions && fieldOptions && fieldOptions.length > 0) {
      hasKey = fieldOptions.some((fo) => fo.deletion_key);
    } else {
      hasKey = Boolean((legacyKeys && legacyKeys.length > 0) || (schema && schema.some((c) => c.isPrimaryKey || c.is_primary_key)));
    }
    if (!hasKey) {
      return {
        isValid: false,
        missingKeyType: "delete",
        warningMessage: "Esta ação requer ao menos uma chave definida nas Configurações avançadas.",
      };
    }
  }

  return { isValid: true, missingKeyType: null, warningMessage: null };
}

export function checkCellSinkKeys(cell: { nodes?: any[]; nodeSchemas?: Record<string, any> }): string | null {
  if (!cell.nodes || cell.nodes.length === 0) return null;
  for (const node of cell.nodes) {
    const data = node.data || {};
    const ct = (data.componentType || "").toLowerCase();
    const isTarget =
      ct.includes(".output") ||
      ct === "core.database.target" ||
      ct.includes("duckdb.output") ||
      data.category === "target";
    if (!isTarget) continue;

    const config = data.config || {};
    const dataAction = String(config.data_action || "insert").toLowerCase();
    if (!["update", "update_or_insert", "insert_or_update", "upsert", "delete"].includes(dataAction)) {
      continue;
    }

    const useFieldOptions = Boolean(config.use_field_options);
    const fieldOptions = Array.isArray(config.field_options) ? config.field_options : [];
    const schema = (cell.nodeSchemas && cell.nodeSchemas[node.id]) || data.schema || [];
    const validation = validateSinkKeys(dataAction, useFieldOptions, fieldOptions, schema, config.keys);

    if (!validation.isValid) {
      const nodeLabel = data.label || node.id;
      const keyDesc = validation.missingKeyType === "delete" ? "Deletion Key" : "Update Key";
      return `Componente de saída '${nodeLabel}' usa ação '${dataAction}' mas não possui nenhuma ${keyDesc} configurada. Configure nas Configurações avançadas ou marque a PK no Schema.`;
    }
  }
  return null;
}
