import React from "react";
import { SchemaColumn } from "../../store/jobStore";
import { FieldOption, syncFieldOptionsWithSchema, validateSinkKeys } from "./utils/fieldOptionsUtils";

export interface AdvancedSettingsTabProps {
  config: Record<string, any>;
  schema: SchemaColumn[];
  onChange: (key: string, val: any) => void;
  onMultipleChange: (updates: Record<string, any>) => void;
}

export const AdvancedSettingsTab: React.FC<AdvancedSettingsTabProps> = ({
  config,
  schema,
  onChange,
  onMultipleChange,
}) => {
  const dataAction = String(config.data_action || "insert").toLowerCase();
  const requiresKey = ["update", "update_or_insert", "insert_or_update", "upsert", "delete"].includes(dataAction);

  const rawFieldOptions = Array.isArray(config.field_options) ? config.field_options : [];
  const fieldOptions: FieldOption[] = syncFieldOptionsWithSchema(rawFieldOptions, schema);

  const useFieldOptions = Boolean(config.use_field_options);
  const validation = validateSinkKeys(
    dataAction,
    useFieldOptions,
    fieldOptions,
    schema,
    config.keys
  );

  // Master checkboxes status
  const allUpdateKeys = fieldOptions.length > 0 && fieldOptions.every((fo) => fo.update_key);
  const allDeletionKeys = fieldOptions.length > 0 && fieldOptions.every((fo) => fo.deletion_key);
  const allUpdatable = fieldOptions.length > 0 && fieldOptions.every((fo) => fo.updatable);
  const allInsertable = fieldOptions.length > 0 && fieldOptions.every((fo) => fo.insertable);

  const toggleAll = (prop: keyof FieldOption) => {
    const isAllChecked = fieldOptions.every((fo) => Boolean(fo[prop]));
    const nextVal = !isAllChecked;
    const updated = fieldOptions.map((fo) => ({
      ...fo,
      [prop]: nextVal,
    }));
    onChange("field_options", updated);
  };

  const toggleRow = (colName: string, prop: keyof FieldOption) => {
    const updated = fieldOptions.map((fo) => {
      if (fo.column === colName) {
        return { ...fo, [prop]: !fo[prop] };
      }
      return fo;
    });
    onChange("field_options", updated);
  };

  const handleShortcutMarkKeys = () => {
    const isDelete = dataAction === "delete";
    const pkCols = new Set(schema.filter((c) => c.isPrimaryKey).map((c) => c.name));
    // Se nenhuma coluna tem isPrimaryKey, usa a primeira
    if (pkCols.size === 0 && schema.length > 0) {
      pkCols.add(schema[0].name);
    }
    const updated = fieldOptions.map((fo) => ({
      ...fo,
      update_key: !isDelete && pkCols.has(fo.column),
      deletion_key: isDelete && pkCols.has(fo.column),
    }));
    onMultipleChange({
      use_field_options: true,
      field_options: updated,
    });
  };

  return (
    <div className="prop-content advanced-settings-tab">
      {/* ─── Aviso de Validação de Chaves DML ─── */}
      {!validation.isValid && (
        <div
          style={{
            background: "rgba(234, 179, 8, 0.12)",
            border: "1px solid rgba(234, 179, 8, 0.35)",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 14,
            fontSize: "0.72rem",
            color: "#facc15",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚠️</span>
            <span>{validation.warningMessage}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              alignSelf: "flex-start",
              fontSize: "0.68rem",
              padding: "2px 8px",
              background: "rgba(234, 179, 8, 0.2)",
              color: "#fef08a",
              border: "1px solid rgba(234, 179, 8, 0.5)",
            }}
            onClick={handleShortcutMarkKeys}
          >
            {dataAction === "delete"
              ? "Marcar chave primária do schema como Deletion Key"
              : "Marcar chave primária do schema como Update Key"}
          </button>
        </div>
      )}

      {/* ─── 1. Batch Mode & Batch Size (Movido da aba principal) ─── */}
      <div
        className="form-group"
        style={{
          background: "var(--bg-card)",
          padding: 10,
          borderRadius: 6,
          border: "1px solid var(--border-subtle)",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={config.use_batch_mode !== false}
              onChange={(e) => onChange("use_batch_mode", e.target.checked)}
            />
            <span>📦 Ativar Modo em Lote (Use Batch Mode)</span>
          </label>
        </div>
        {config.use_batch_mode !== false && (
          <div>
            <label className="form-label" style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
              <span>Tamanho do Lote de Escrita (Batch Size)</span>
              <span style={{ color: "var(--text-muted)" }}>Registros por Commit</span>
            </label>
            <input
              type="number"
              className="form-input"
              style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
              value={config.batch_size ?? 10000}
              placeholder="10000"
              onChange={(e) => onChange("batch_size", parseInt(e.target.value, 10) || 10000)}
            />
            <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4 }}>
              Agrupa instruções DML em lotes com commit intermediário para controle de transação e economia de memória.
            </div>
          </div>
        )}
      </div>

      {/* ─── 2. Fail on no match ─── */}
      {requiresKey && (
        <div
          className="form-group"
          style={{
            background: "var(--bg-card)",
            padding: 10,
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            marginBottom: 12,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={Boolean(config.fail_on_no_match)}
              onChange={(e) => onChange("fail_on_no_match", e.target.checked)}
            />
            <span>🛑 Falhar se nenhuma linha for afetada (Fail on no match)</span>
          </label>
          <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4, marginLeft: 24 }}>
            Interrompe a execução com erro se nenhuma linha correspondente às chaves for encontrada no destino.
          </div>
        </div>
      )}

      {/* ─── 3. Usar opções de campo (Use field options) ─── */}
      <div
        className="form-group"
        style={{
          background: "var(--bg-card)",
          padding: 10,
          borderRadius: 6,
          border: "1px solid var(--border-subtle)",
          marginBottom: 12,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={useFieldOptions}
            onChange={(e) => {
              const checked = e.target.checked;
              if (checked) {
                onMultipleChange({
                  use_field_options: true,
                  field_options: fieldOptions,
                });
              } else {
                onChange("use_field_options", false);
              }
            }}
          />
          <span>⚙️ Usar opções de campo (Use field options)</span>
        </label>
        <div style={{ fontSize: "0.66rem", color: "var(--text-muted)", marginTop: 4, marginLeft: 24 }}>
          Habilita controle granular estilo tDBOutput do Talend para chaves e colunas atualizáveis/inseríveis.
        </div>
      </div>

      {/* ─── 4. Tabela de Opções de Campo ─── */}
      {useFieldOptions && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
              Opções de Campo por Coluna ({fieldOptions.length})
            </label>
            {requiresKey && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "0.66rem", padding: "2px 6px" }}
                onClick={handleShortcutMarkKeys}
                title="Marca as colunas com chave primária do schema"
              >
                Atribuir PKs do Schema
              </button>
            )}
          </div>

          {fieldOptions.length === 0 ? (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", padding: "12px 6px", fontStyle: "italic" }}>
              Nenhuma coluna definida no Schema deste componente. Adicione colunas na aba Schema para configurar as opções de campo.
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Coluna</th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>
                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="Marcar/Desmarcar todas">
                        <input
                          type="checkbox"
                          checked={allUpdateKeys}
                          onChange={() => toggleAll("update_key")}
                        />
                        <span>Update Key</span>
                      </label>
                    </th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>
                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="Marcar/Desmarcar todas">
                        <input
                          type="checkbox"
                          checked={allDeletionKeys}
                          onChange={() => toggleAll("deletion_key")}
                        />
                        <span>Deletion Key</span>
                      </label>
                    </th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>
                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="Marcar/Desmarcar todas">
                        <input
                          type="checkbox"
                          checked={allUpdatable}
                          onChange={() => toggleAll("updatable")}
                        />
                        <span>Updatable</span>
                      </label>
                    </th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>
                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="Marcar/Desmarcar todas">
                        <input
                          type="checkbox"
                          checked={allInsertable}
                          onChange={() => toggleAll("insertable")}
                        />
                        <span>Insertable</span>
                      </label>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fieldOptions.map((fo) => {
                    const isPk = schema.some((c) => c.name === fo.column && c.isPrimaryKey);
                    return (
                      <tr
                        key={fo.column}
                        style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          background: fo.update_key || fo.deletion_key ? "rgba(0, 229, 255, 0.04)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {fo.column}
                            {isPk && (
                              <span
                                style={{
                                  fontSize: "0.6rem",
                                  padding: "1px 4px",
                                  borderRadius: 3,
                                  background: "rgba(234, 179, 8, 0.2)",
                                  color: "#facc15",
                                }}
                              >
                                PK
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={fo.update_key}
                            onChange={() => toggleRow(fo.column, "update_key")}
                          />
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={fo.deletion_key}
                            onChange={() => toggleRow(fo.column, "deletion_key")}
                          />
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={fo.updatable}
                            onChange={() => toggleRow(fo.column, "updatable")}
                          />
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={fo.insertable}
                            onChange={() => toggleRow(fo.column, "insertable")}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
