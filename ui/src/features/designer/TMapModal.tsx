import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  X, Check, Plus, Trash2, GitMerge, ArrowRight, ArrowLeft,
  Table2, Layers, Play, Wand2, Search, Maximize2, Minimize2,
  ChevronDown, ChevronUp, Key, Filter, HelpCircle, AlertCircle,
  Copy, RefreshCw, ChevronsRight, FileCode, CheckSquare, Sparkles,
  Sliders, Link2, Info, Zap
} from "lucide-react";
import { SchemaColumn, SchemaColumnType } from "../../store/jobStore";

// ─── Interfaces ────────────────────────────────────────────────

export interface TMapJoinKey {
  expr_key: string; // Ex: "row1.directorID"
  column: string;   // Ex: "ID"
}

export interface TMapLookupConfig {
  node_id: string;
  label?: string;
  alias?: string;
  join_type: "left" | "inner";
  join_model?: string;
  lookup_model?: "Load once" | "Reload at each row" | string;
  match_model?: "All matches" | "Unique match" | "First match" | string;
  left_keys: string[];
  right_keys: string[];
  join_keys?: TMapJoinKey[];
  filter_expression?: string;
  join_filter?: string;
  schema?: SchemaColumn[];
}

export interface TMapVariable {
  id: string;
  name: string;
  type?: SchemaColumnType;
  expression: string;
  comment?: string;
}

export interface TMapOutputColumn {
  id: string;
  target: string;
  expression: string;
  type?: SchemaColumnType;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  length?: number;
  precision?: number;
  pattern?: string;
  comment?: string;
}

export interface DownstreamNodeInfo {
  edgeId: string;
  flowName: string;
  targetId: string;
  targetLabel: string;
  targetCategory?: string;
  targetComponentType?: string;
  targetSchema?: SchemaColumn[];
}

export interface TargetSchemaUpdate {
  nodeId: string;
  schema: SchemaColumn[];
}

export interface TMapOutputFlow {
  id: string;
  name: string;
  targetId?: string;
  targetLabel?: string;
  filter_expression?: string;
  catch_output_reject?: boolean;
  catch_lookup_reject?: boolean;
  catch_inner_join_reject?: boolean;
  schema_type?: "Built-in" | "Repository";
  is_reject?: boolean;
  columns: TMapOutputColumn[];
}

export interface TMapConfig {
  main_alias?: string;
  lookups?: TMapLookupConfig[];
  variables?: TMapVariable[];
  outputs?: TMapOutputFlow[];
}

interface TMapModalProps {
  nodeId: string;
  nodeLabel: string;
  config: TMapConfig;
  mainSchema: SchemaColumn[];
  lookupSchemas: Record<string, SchemaColumn[]>;
  availableUpstreamNodes?: { id: string; label: string; alias?: string; schema?: SchemaColumn[] }[];
  downstreamNodes?: DownstreamNodeInfo[];
  onSave: (newConfig: TMapConfig, targetSchemaUpdates?: TargetSchemaUpdate[]) => void;
  onClose: () => void;
}

const COLUMN_TYPES: SchemaColumnType[] = [
  "String", "Integer", "Long", "Float", "Double", "Decimal",
  "Boolean", "Date", "DateTime", "Timestamp", "Time",
  "Bytes", "JSON", "Array", "Object"
];

// ─── Function Helper Catalog ───────────────────────────────────

interface FunctionDoc {
  category: string;
  name: string;
  syntax: string;
  description: string;
  example: string;
}

const FUNCTION_CATALOG: FunctionDoc[] = [
  // Texto
  { category: "Texto / String", name: "UPPER", syntax: "UPPER(str)", description: "Converte para letras maiúsculas", example: "UPPER(row1.nome)" },
  { category: "Texto / String", name: "LOWER", syntax: "LOWER(str)", description: "Converte para letras minúsculas", example: "LOWER(row1.email)" },
  { category: "Texto / String", name: "TRIM", syntax: "TRIM(str)", description: "Remove espaços em branco das extremidades", example: "TRIM(row1.titulo)" },
  { category: "Texto / String", name: "CONCAT", syntax: "CONCAT(s1, s2, ...)", description: "Concatena duas ou mais strings", example: "CONCAT(row1.primeiro_nome, ' ', row1.sobrenome)" },
  { category: "Texto / String", name: "SUBSTRING", syntax: "SUBSTRING(str, pos, len)", description: "Extrai parte de uma string", example: "SUBSTRING(row1.codigo, 1, 3)" },
  { category: "Texto / String", name: "REPLACE", syntax: "REPLACE(str, from, to)", description: "Substitui ocorrências de um caractere ou texto", example: "REPLACE(row1.telefone, '-', '')" },
  { category: "Texto / String", name: "COALESCE", syntax: "COALESCE(v1, v2, ...)", description: "Retorna o primeiro valor não nulo", example: "COALESCE(row1.apelido, row1.nome, 'N/A')" },
  
  // Numérico / Math
  { category: "Numérico / Math", name: "ROUND", syntax: "ROUND(num, casas)", description: "Arredonda o número para as casas decimais informadas", example: "ROUND(row1.valor * 1.15, 2)" },
  { category: "Numérico / Math", name: "ABS", syntax: "ABS(num)", description: "Retorna o valor absoluto positivo", example: "ABS(row1.diferenca)" },
  { category: "Numérico / Math", name: "CEIL", syntax: "CEIL(num)", description: "Arredonda para cima para o inteiro mais próximo", example: "CEIL(row1.quantidade)" },
  { category: "Numérico / Math", name: "FLOOR", syntax: "FLOOR(num)", description: "Arredonda para baixo para o inteiro mais próximo", example: "FLOOR(row1.taxa)" },

  // Data & Hora
  { category: "Data & Hora", name: "CURRENT_DATE", syntax: "CURRENT_DATE", description: "Retorna a data atual do sistema", example: "CURRENT_DATE" },
  { category: "Data & Hora", name: "DATE_FORMAT", syntax: "STRFTIME(date, '%Y-%m-%d')", description: "Formata uma data para string com padrão", example: "STRFTIME(row1.data_criacao, '%d/%m/%Y')" },
  { category: "Data & Hora", name: "DATEDIFF", syntax: "DATE_DIFF('day', d1, d2)", description: "Calcula a diferença em dias/meses entre duas datas", example: "DATE_DIFF('day', row1.data_inicio, row1.data_fim)" },
  { category: "Data & Hora", name: "YEAR", syntax: "EXTRACT(YEAR FROM date)", description: "Extrai o ano de uma data", example: "EXTRACT(YEAR FROM row1.data_nasc)" },

  // Condicional / Lógica
  { category: "Condicional / Lógica", name: "CASE WHEN", syntax: "CASE WHEN cond THEN v1 ELSE v2 END", description: "Expressão condicional se/senão", example: "CASE WHEN row1.idade >= 18 THEN 'ADULTO' ELSE 'MENOR' END" },
  { category: "Condicional / Lógica", name: "IFNULL", syntax: "IFNULL(expr, padrao)", description: "Retorna valor padrão caso a expressão seja nula", example: "IFNULL(row1.status, 'INATIVO')" },
  { category: "Condicional / Lógica", name: "CAST", syntax: "CAST(expr AS VARCHAR)", description: "Converte explicitamente o tipo do dado", example: "CAST(row1.id AS VARCHAR)" },
];

const normalizeMatchModel = (val?: string): "all" | "unique" | "first" => {
  const s = (val || "").toLowerCase();
  if (s.includes("unique")) return "unique";
  if (s.includes("first")) return "first";
  return "all";
};

const normalizeJoinType = (type?: string, model?: string): "left" | "inner" => {
  const s = (type || model || "").toLowerCase();
  if (s.includes("inner")) return "inner";
  return "left";
};

// ─── Main Component ────────────────────────────────────────────

export const TMapModal: React.FC<TMapModalProps> = ({
  nodeId,
  nodeLabel,
  config,
  mainSchema = [],
  lookupSchemas = {},
  availableUpstreamNodes = [],
  downstreamNodes = [],
  onSave,
  onClose,
}) => {
  // ─── States ───
  const [isMaximized, setIsMaximized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"canvas" | "schema" | "expression">("canvas");
  const [bottomTab, setBottomTab] = useState<"schema" | "expression">("schema");
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [showUpstreamChips, setShowUpstreamChips] = useState(true);
  const [copiedChipToken, setCopiedChipToken] = useState<string | null>(null);

  // Main Alias state (row1 / main)
  const initialMainAlias = config.main_alias || availableUpstreamNodes[0]?.alias || "main1";
  const [mainAlias, setMainAlias] = useState<string>(initialMainAlias);

  // Lookups state with fallback keys, aliases and auto-sync with upstream nodes
  const [lookups, setLookups] = useState<TMapLookupConfig[]>(() => {
    const rawLookups = config.lookups || [];
    const upstreamLookups = availableUpstreamNodes.slice(1);

    if (upstreamLookups.length > 0 && rawLookups.length === 0) {
      return upstreamLookups.map((un, idx) => ({
        node_id: un.id,
        label: un.label || `lkp${idx + 1}`,
        alias: un.alias || `row${idx + 2}`,
        join_type: "left",
        join_model: "left_outer",
        lookup_model: "Load once",
        match_model: "all",
        left_keys: [],
        right_keys: [],
        join_keys: [{ expr_key: "", column: "" }],
        filter_expression: "",
        join_filter: "",
        schema: un.schema || lookupSchemas[un.id] || [],
      }));
    }

    return rawLookups.map((lk, idx) => ({
      ...lk,
      alias: lk.alias || lk.label || `row${idx + 2}`,
      lookup_model: lk.lookup_model || "Load once",
      match_model: normalizeMatchModel(lk.match_model),
      join_type: normalizeJoinType(lk.join_type, lk.join_model),
      join_model: normalizeJoinType(lk.join_type, lk.join_model) === "inner" ? "inner" : "left_outer",
      join_keys:
        lk.join_keys ||
        (lk.left_keys && lk.left_keys.length > 0
          ? lk.left_keys.map((k, i) => ({ expr_key: k, column: lk.right_keys?.[i] || "" }))
          : [{ expr_key: "", column: "" }]),
      filter_expression: lk.filter_expression || "",
      join_filter: lk.join_filter || lk.filter_expression || "",
      schema: lk.schema || lookupSchemas[lk.node_id] || [],
    }));
  });

  // Variables state (inicia vazio para novos mappers - sem mocks fantasmas como row1.Title)
  const [variables, setVariables] = useState<TMapVariable[]>(
    config.variables && config.variables.length > 0
      ? config.variables
      : []
  );

  // Outputs state auto-synced with downstream connections
  const [outputs, setOutputs] = useState<TMapOutputFlow[]>(() => {
    const rawOutputs = config.outputs || [];

    // Se temos nós conectados a jusante (downstream), sincronizamos cada um deles
    if (downstreamNodes && downstreamNodes.length > 0) {
      const synced: TMapOutputFlow[] = downstreamNodes.map((dn, idx) => {
        const flowName = dn.flowName || `out${idx + 1}`;
        // Procura se já existia configuração para esse output
        const existing = rawOutputs.find(
          (o) =>
            o.id === flowName ||
            o.name === flowName ||
            (o.targetId && o.targetId === dn.targetId) ||
            (idx === 0 && (o.id === "out1" || o.name === "out1")) ||
            o.id === `out${idx + 1}`
        );

        let cols: TMapOutputColumn[] = [];
        if (existing && existing.columns && existing.columns.length > 0) {
          cols = existing.columns.map((c) => ({
            ...c,
            type: c.type || "String",
            nullable: c.nullable ?? true,
          }));
        } else if (dn.targetSchema && dn.targetSchema.length > 0) {
          cols = dn.targetSchema.map((c) => ({
            id: c.id || `col-${c.name}`,
            target: c.name,
            expression: mainSchema.some((m) => m.name === c.name) ? `${initialMainAlias}.${c.name}` : "",
            type: c.type || "String",
            nullable: c.nullable ?? true,
            isPrimaryKey: c.isPrimaryKey,
            length: c.length,
            precision: c.precision,
            pattern: c.format,
          }));
        } else {
          cols = mainSchema.map((c) => ({
            id: `col-${c.name}`,
            target: c.name,
            expression: `${initialMainAlias}.${c.name}`,
            type: c.type || "String",
            nullable: c.nullable ?? true,
            isPrimaryKey: c.isPrimaryKey,
            length: c.length,
            precision: c.precision,
            pattern: c.format,
          }));
        }

        return {
          id: existing?.id || flowName,
          name: existing?.name || flowName,
          targetId: dn.targetId,
          targetLabel: dn.targetLabel,
          filter_expression: existing?.filter_expression || "",
          catch_output_reject: existing?.catch_output_reject ?? false,
          catch_lookup_reject: existing?.catch_lookup_reject ?? false,
          catch_inner_join_reject: existing?.catch_inner_join_reject ?? false,
          schema_type: existing?.schema_type || "Built-in",
          is_reject: existing?.is_reject ?? false,
          columns: cols,
        };
      });

      // Preserva saídas de reject ou adicionais que não correspondam aos nós conectados
      const rejectOutputs = rawOutputs
        .filter((o) => o.is_reject && !synced.some((s) => s.id === o.id))
        .map((o) => ({
          ...o,
          catch_output_reject: o.catch_output_reject ?? true,
          catch_lookup_reject: o.catch_lookup_reject ?? false,
          columns: o.columns.map((c) => ({ ...c, type: c.type || "String", nullable: c.nullable ?? true })),
        }));

      return [...synced, ...rejectOutputs];
    }

    if (rawOutputs.length > 0) {
      return rawOutputs.map((o) => ({
        ...o,
        catch_output_reject: o.catch_output_reject ?? false,
        catch_lookup_reject: o.catch_lookup_reject ?? false,
        schema_type: o.schema_type || "Built-in",
        columns: o.columns.map((c) => ({
          ...c,
          type: c.type || "String",
          nullable: c.nullable ?? true,
        })),
      }));
    }

    return [
      {
        id: "out1",
        name: "out1",
        filter_expression: "",
        catch_output_reject: false,
        catch_lookup_reject: false,
        schema_type: "Built-in",
        columns: mainSchema.map((c) => ({
          id: `col-${c.name}`,
          target: c.name,
          expression: `${initialMainAlias}.${c.name}`,
          type: c.type,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
        })),
      },
    ];
  });

  const [activeOutputId, setActiveOutputId] = useState<string>(outputs[0]?.id || "out1");
  const [activeInputId, setActiveInputId] = useState<string>("main"); // "main" or lookup node_id
  const [selectedFuncCategory, setSelectedFuncCategory] = useState<string>("Texto / String");
  const [hoveredMapping, setHoveredMapping] = useState<{ source: string; target: string } | null>(null);

  // Expanded card toggles
  const [showLookupSettings, setShowLookupSettings] = useState<Record<string, boolean>>({});
  const [showOutputSettings, setShowOutputSettings] = useState<Record<string, boolean>>({});

  const activeOutput = outputs.find((o) => o.id === activeOutputId) || outputs[0];

  // Lista unificada de nós e colunas a montante para a barra de sugestões (estilo Iterate)
  const upstreamSourcesForChips = useMemo(() => {
    if (availableUpstreamNodes && availableUpstreamNodes.length > 0) {
      return availableUpstreamNodes.map((un, idx) => ({
        id: un.id,
        label: un.label || un.id,
        alias: un.alias || (idx === 0 ? mainAlias : `row${idx + 1}`),
        schema: un.schema && un.schema.length > 0 ? un.schema : (idx === 0 ? mainSchema : (lookupSchemas[un.id] || [])),
        isMain: idx === 0,
      }));
    }
    const list = [
      {
        id: "main",
        label: "Entrada Principal (Main)",
        alias: mainAlias,
        schema: mainSchema,
        isMain: true,
      },
    ];
    lookups.forEach((lk, idx) => {
      list.push({
        id: lk.node_id,
        label: lk.label || lk.node_id,
        alias: lk.alias || lk.label || `row${idx + 2}`,
        schema: lk.schema || lookupSchemas[lk.node_id] || [],
        isMain: false,
      });
    });
    return list;
  }, [availableUpstreamNodes, mainAlias, mainSchema, lookups, lookupSchemas]);

  // ─── Direct Mapping / Click-to-Map Handler ───────────────────
  const handleAddOrMapColumnToActiveOutput = (
    first: string,
    second: string,
    colType?: SchemaColumnType
  ) => {
    // Normaliza os argumentos caso venham invertidos (expr vs colName)
    const expr = first.includes(".") || first.startsWith("Var.") ? first : second;
    const baseColName = (!first.includes(".") && !first.startsWith("Var.")) ? first : second;

    setOutputs((prevOutputs) =>
      prevOutputs.map((out) => {
        if (out.id !== activeOutputId) return out;

        // 1. Procura se tem uma linha com expression vazia para preencher
        const emptyIdx = out.columns.findIndex((c) => !c.expression || !c.expression.trim());
        if (emptyIdx >= 0) {
          const updated = [...out.columns];
          const curr = updated[emptyIdx];
          let target = curr.target.startsWith("col_") || !curr.target.trim() ? baseColName : curr.target;

          // Se já existir outra coluna com esse target, desambigua
          const otherTargets = new Set(
            updated.filter((_, i) => i !== emptyIdx).map((c) => c.target.toLowerCase())
          );
          if (otherTargets.has(target.toLowerCase())) {
            const dotParts = expr.split(".");
            const aliasPrefix = dotParts.length > 1 ? dotParts[0].trim() : "";
            if (aliasPrefix && !otherTargets.has(`${aliasPrefix}_${baseColName}`.toLowerCase())) {
              target = `${aliasPrefix}_${baseColName}`;
            } else {
              let counter = 1;
              while (otherTargets.has(`${baseColName}_${counter}`.toLowerCase())) {
                counter++;
              }
              target = `${baseColName}_${counter}`;
            }
          }

          updated[emptyIdx] = {
            ...curr,
            expression: expr,
            target,
            type: colType || curr.type || "String",
          };
          return { ...out, columns: updated };
        }

        // 2. Se já existir uma coluna com o mesmo target cuja expressão está vazia, atualiza-a
        const existingIdx = out.columns.findIndex(
          (c) => c.target.toLowerCase() === baseColName.toLowerCase()
        );
        if (
          existingIdx >= 0 &&
          (!out.columns[existingIdx].expression || !out.columns[existingIdx].expression.trim())
        ) {
          const updated = [...out.columns];
          updated[existingIdx] = {
            ...updated[existingIdx],
            expression: expr,
            type: colType || updated[existingIdx].type || "String",
          };
          return { ...out, columns: updated };
        }

        // 3. Se já existe uma coluna com esse target e já possui expressão, sugere nome desambiguado
        const existingTargets = new Set(out.columns.map((c) => c.target.toLowerCase()));
        let finalTarget = baseColName;
        if (existingTargets.has(finalTarget.toLowerCase())) {
          const dotParts = expr.split(".");
          const aliasPrefix = dotParts.length > 1 ? dotParts[0].trim() : "";
          if (aliasPrefix && !existingTargets.has(`${aliasPrefix}_${baseColName}`.toLowerCase())) {
            finalTarget = `${aliasPrefix}_${baseColName}`;
          } else {
            let counter = 1;
            while (existingTargets.has(`${baseColName}_${counter}`.toLowerCase())) {
              counter++;
            }
            finalTarget = `${baseColName}_${counter}`;
          }
        }

        const newCol: TMapOutputColumn = {
          id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          target: finalTarget,
          expression: expr,
          type: colType || "String",
          nullable: true,
        };
        return { ...out, columns: [...out.columns, newCol] };
      })
    );
  };

  // ─── Auto Map Handler ─────────────────────────────────────────
  const handleAutoMap = (outId: string) => {
    const availableSources: { name: string; expr: string; type: SchemaColumnType; prefix: string }[] = [];
    mainSchema.forEach((c) =>
      availableSources.push({ name: c.name, expr: `${mainAlias}.${c.name}`, type: c.type, prefix: mainAlias })
    );
    lookups.forEach((lk, idx) => {
      const lkCols = lookupSchemas[lk.node_id] || lk.schema || [];
      const prefix = lk.alias || lk.label || `row${idx + 2}`;
      lkCols.forEach((c) =>
        availableSources.push({ name: c.name, expr: `${prefix}.${c.name}`, type: c.type, prefix })
      );
    });
    variables.forEach((v) => {
      if (v.name) availableSources.push({ name: v.name, expr: `Var.${v.name}`, type: v.type || "String", prefix: "Var" });
    });

    const usedTargets = new Set<string>();
    const newCols: TMapOutputColumn[] = [];

    availableSources.forEach((s) => {
      let targetName = s.name;
      if (usedTargets.has(targetName.toLowerCase())) {
        if (s.prefix && !usedTargets.has(`${s.prefix}_${s.name}`.toLowerCase())) {
          targetName = `${s.prefix}_${s.name}`;
        } else {
          let counter = 1;
          while (usedTargets.has(`${s.name}_${counter}`.toLowerCase())) {
            counter++;
          }
          targetName = `${s.name}_${counter}`;
        }
      }
      usedTargets.add(targetName.toLowerCase());

      newCols.push({
        id: `col-${Date.now()}-${targetName}-${Math.random().toString(36).slice(2, 5)}`,
        target: targetName,
        expression: s.expr,
        type: s.type,
        nullable: true,
      });
    });

    setOutputs((outs) =>
      outs.map((o) => {
        if (o.id !== outId) return o;
        return { ...o, columns: newCols };
      })
    );
  };

  // ─── Variable Actions ─────────────────────────────────────────
  const handleAddVariable = () => {
    const newV: TMapVariable = {
      id: `v_${Date.now().toString(36)}`,
      name: `var_${variables.length + 1}`,
      type: "String",
      expression: "",
    };
    setVariables([...variables, newV]);
  };

  const handleRemoveVariable = (id: string) => {
    setVariables(variables.filter((v) => v.id !== id));
  };

  // ─── Output Flow Actions ──────────────────────────────────────
  const handleAddOutput = (isReject = false) => {
    const count = outputs.length + 1;
    const newId = isReject ? `reject_${count}` : `out_${count}`;
    const newOut: TMapOutputFlow = {
      id: newId,
      name: isReject ? `reject_${count}` : `out${count}`,
      filter_expression: "",
      catch_output_reject: isReject,
      catch_lookup_reject: isReject,
      schema_type: "Built-in",
      is_reject: isReject,
      columns: [],
    };
    setOutputs([...outputs, newOut]);
    setActiveOutputId(newId);
  };

  const handleRemoveOutput = (id: string) => {
    if (outputs.length <= 1) return;
    const remaining = outputs.filter((o) => o.id !== id);
    setOutputs(remaining);
    setActiveOutputId(remaining[0].id);
  };

  // ─── Lookup Actions ───────────────────────────────────────────
  const handleAddLookup = () => {
    const count = lookups.length + 1;
    const newLk: TMapLookupConfig = {
      node_id: `row${count + 1}`,
      label: `row${count + 1}`,
      join_type: "left",
      join_model: "left_outer",
      lookup_model: "Load once",
      match_model: "all",
      left_keys: [],
      right_keys: [],
      join_keys: [{ expr_key: "", column: "" }],
      filter_expression: "",
    };
    setLookups([...lookups, newLk]);
  };

  const handleRemoveLookup = (nodeId: string) => {
    setLookups(lookups.filter((lk) => lk.node_id !== nodeId));
  };

  // ─── Save & Sync ──────────────────────────────────────────────
  const handleSaveAll = () => {
    // Normaliza os join_keys para left_keys e right_keys para o backend
    const normalizedLookups = lookups.map((lk, idx) => {
      const left_keys: string[] = [];
      const right_keys: string[] = [];
      (lk.join_keys || []).forEach((jk) => {
        if (jk.expr_key && jk.column) {
          left_keys.push(jk.expr_key.trim());
          let cleanRight = jk.column.trim();
          if (cleanRight.includes(".")) {
            cleanRight = cleanRight.split(".").pop()!.trim();
          }
          cleanRight = cleanRight.replace(/["'{}]/g, "").trim();
          right_keys.push(cleanRight);
        }
      });
      const isInner = lk.join_type === "inner" || lk.join_model === "inner";
      const joinType = isInner ? "inner" : "left";
      const joinModel = isInner ? "inner" : "left_outer";
      let matchModel = "all";
      if (lk.match_model?.toLowerCase().includes("first")) matchModel = "first";
      else if (lk.match_model?.toLowerCase().includes("unique")) matchModel = "unique";

      const flowAlias = lk.alias || lk.label || `row${idx + 2}`;

      return {
        ...lk,
        alias: flowAlias,
        label: flowAlias,
        join_type: joinType as "left" | "inner",
        join_model: joinModel,
        match_model: matchModel,
        join_filter: lk.join_filter || lk.filter_expression || "",
        left_keys: left_keys.length > 0 ? left_keys : lk.left_keys,
        right_keys: right_keys.length > 0 ? right_keys : lk.right_keys,
      };
    });

    const normalizedOutputs = outputs.map((o) => ({
      ...o,
      catch_output_reject: o.catch_output_reject ?? false,
      catch_inner_join_reject: o.catch_inner_join_reject ?? o.catch_lookup_reject ?? false,
      catch_lookup_reject: o.catch_inner_join_reject ?? o.catch_lookup_reject ?? false,
    }));

    // Cria os schemas atualizados para os nós de destino downstream
    const schemaUpdates: TargetSchemaUpdate[] = [];
    outputs.forEach((out) => {
      if (out.targetId && out.columns && out.columns.length > 0) {
        const schemaCols: SchemaColumn[] = out.columns.map((c, idx) => ({
          id: c.id || `col-${out.targetId}-${idx}`,
          name: c.target,
          type: (c.type || "String") as SchemaColumnType,
          nullable: c.nullable ?? true,
          isPrimaryKey: c.isPrimaryKey ?? false,
          length: c.length,
          precision: c.precision,
          format: c.pattern,
          comment: c.comment,
        }));
        schemaUpdates.push({
          nodeId: out.targetId,
          schema: schemaCols,
        });
      }
    });

    onSave(
      {
        main_alias: mainAlias,
        lookups: normalizedLookups,
        variables,
        outputs: normalizedOutputs,
      },
      schemaUpdates
    );
    onClose();
  };

  // ─── Filtering helper ─────────────────────────────────────────
  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-container data-mapper-modal ${isMaximized ? "maximized" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── Top Header ─── */}
        <div className="data-mapper-header">
          <div className="data-mapper-title">
            <GitMerge size={18} color="var(--accent-cyan)" />
            <span className="title-text">Data Mapper Studio</span>
            <span className="node-badge">{nodeLabel || nodeId}</span>
          </div>

          {/* Quick Search / Find bar */}
          <div className="data-mapper-search-bar">
            <Search size={13} className="search-icon" />
            <input
              className="search-input"
              value={searchQuery}
              placeholder="Find: buscar colunas, variáveis e expressões..."
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery("")}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Top Actions */}
          <div className="data-mapper-actions">
            <button
              className="btn btn-secondary btn-sm"
              title="Mapear colunas automaticamente por correspondência de nome"
              onClick={() => handleAutoMap(activeOutputId)}
            >
              <Wand2 size={13} color="var(--accent-cyan)" />
              <span>Auto map!</span>
            </button>

            <button className="btn btn-secondary btn-sm" onClick={handleAddVariable}>
              <Plus size={13} />
              <span>+ Var</span>
            </button>

            <button className="btn btn-secondary btn-sm" onClick={() => handleAddOutput(false)}>
              <Plus size={13} />
              <span>+ Saída</span>
            </button>

            <button className="btn btn-secondary btn-sm" onClick={() => handleAddOutput(true)} title="Adicionar fluxo de rejeitados">
              <AlertCircle size={13} color="var(--status-danger)" />
              <span>+ Reject</span>
            </button>

            <button
              className={`btn ${showUpstreamChips ? "btn-primary" : "btn-secondary"} btn-sm`}
              title="Exibir ou ocultar sugestões de colunas dos nós a montante (estilo Iterate)"
              onClick={() => setShowUpstreamChips(!showUpstreamChips)}
            >
              <Zap size={13} color={showUpstreamChips ? "var(--accent-yellow, #ffd700)" : "currentColor"} />
              <span>Sugestões ({upstreamSourcesForChips.reduce((acc, s) => acc + (s.schema?.length || 0), 0)})</span>
            </button>

            <button
              className="icon-btn btn-sm"
              title={isMaximized ? "Restaurar tamanho" : "Maximizar"}
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            <button className="btn btn-success btn-sm" onClick={handleSaveAll}>
              <Check size={14} />
              <span>Aplicar</span>
            </button>

            <button className="modal-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ─── Upstream Suggestion Chips Bar (Lógica de sugestão de colunas idêntica ao Iterate) ─── */}
        {showUpstreamChips && upstreamSourcesForChips.some((s) => s.schema && s.schema.length > 0) && (
          <div className="tmap-upstream-suggestions-bar">
            <div className="suggestions-bar-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Zap size={14} color="var(--accent-yellow, #ffd700)" />
                <span className="suggestions-title">⚡ Colunas de Nós a Montante (Mapeamento & Tokens)</span>
                <span className="suggestions-subtitle">
                  Clique em qualquer coluna para mapear direto na saída ativa ({activeOutput?.name || activeOutputId}) ou copiar a expressão
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {copiedChipToken && (
                  <span className="copied-badge">✓ Copiado: {copiedChipToken}</span>
                )}
                <button
                  type="button"
                  className="icon-btn btn-xs"
                  onClick={() => setShowUpstreamChips(false)}
                  title="Ocultar barra de sugestões"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            <div className="suggestions-sources-container">
              {upstreamSourcesForChips.map((src) => {
                const cols = src.schema || [];
                if (cols.length === 0) return null;
                return (
                  <div key={src.id} className="suggestions-source-group">
                    <div className="suggestions-source-tag">
                      <span className="src-alias-badge">{src.alias}</span>
                      <span className="src-label-text" title={src.id}>{src.label} ({src.id}):</span>
                      <span className="src-count">({cols.length})</span>
                    </div>
                    <div className="suggestions-chips-row">
                      {cols.map((col) => {
                        const token = `{{${src.id}.${col.name}}}`;
                        const exprToken = `${src.alias}.${col.name}`;
                        return (
                          <button
                            key={col.id || col.name}
                            type="button"
                            className="token-chip tmap-chip"
                            title={`Clique para mapear na saída '${activeOutput?.name || activeOutputId}' e copiar '${exprToken}'`}
                            onClick={() => {
                              navigator.clipboard?.writeText?.(token).catch(() => {});
                              setCopiedChipToken(token);
                              setTimeout(() => setCopiedChipToken(null), 2500);
                              handleAddOrMapColumnToActiveOutput(exprToken, col.name, col.type);
                            }}
                          >
                            <span className="chip-alias">{src.alias}.</span>
                            <span className="chip-colname">{col.name}</span>
                            <span className="chip-type">{col.type}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Main 3-Column Studio Workspace ─── */}
        <div className="data-mapper-body">
          {/* ─── LEFT COLUMN: Inputs (row1 Main + Lookups) ─── */}
          <div className="mapper-pane mapper-inputs-pane">
            <div className="mapper-pane-header">
              <div className="pane-title">
                <Layers size={14} color="var(--cat-source)" />
                <span>Entradas (Main & Lookups)</span>
              </div>
              <button className="btn btn-ghost btn-xs" onClick={handleAddLookup} title="Adicionar tabela Lookup">
                <Plus size={12} /> Lookup
              </button>
            </div>

            <div className="mapper-pane-scroll">
              {/* Main Input Table (row1 / main) */}
              <div className="mapper-table-card main-stream">
                <div className="table-card-header">
                  <div className="card-title-group">
                    <input
                      className="card-tag-input main"
                      style={{ width: 60, padding: "2px 6px", fontSize: "0.75rem", fontWeight: 700, borderRadius: 4, background: "rgba(0, 212, 255, 0.15)", border: "1px solid var(--accent-cyan)", color: "var(--accent-cyan)", textAlign: "center" }}
                      value={mainAlias}
                      title="Namespace / Alias do Main (ex: row1, main)"
                      onChange={(e) => setMainAlias(e.target.value.trim() || "row1")}
                    />
                    <span className="card-name">Fluxo Principal</span>
                  </div>
                  <span className="card-badge">{mainSchema.length} colunas</span>
                </div>

                <div className="table-card-columns">
                  {mainSchema.length > 0 ? (
                    mainSchema
                      .filter((c) => matchesSearch(c.name) || matchesSearch(mainAlias))
                      .map((c) => (
                        <div
                          key={c.id || c.name}
                          className="col-row-item draggable-source"
                          draggable
                          onDragStart={(e) => {
                            const qualified = `${mainAlias}.${c.name}`;
                            e.dataTransfer.setData("text/plain", qualified);
                            e.dataTransfer.setData("application/json", JSON.stringify({ flow: mainAlias, col: c.name, type: c.type }));
                          }}
                          title={`Clique para mapear no output ativo ou arraste: ${mainAlias}.${c.name}`}
                          onClick={() => handleAddOrMapColumnToActiveOutput(`${mainAlias}.${c.name}`, c.name, c.type)}
                        >
                          <span className="col-name">{c.name}</span>
                          <span className="col-type-tag">{c.type}</span>
                          <span className="col-anchor" title="Arraste para mapear na saída" />
                        </div>
                      ))
                  ) : (
                    <div className="empty-hint">Nenhuma coluna inferida no nó de entrada</div>
                  )}
                </div>
              </div>

              {/* Lookup Tables (row2, row3...) */}
              {lookups.map((lk, lkIdx) => {
                const lkCols = lookupSchemas[lk.node_id] || lk.schema || [];
                const isSettingsOpen = showLookupSettings[lk.node_id] ?? true;
                const prefix = lk.alias || lk.label || `row${lkIdx + 2}`;

                return (
                  <div key={lk.node_id || lkIdx} className="mapper-table-card lookup-stream">
                    {/* Header */}
                    <div className="table-card-header lookup">
                      <div className="card-title-group">
                        <input
                          className="card-tag-input lookup"
                          style={{ width: 75, padding: "2px 6px", fontSize: "0.75rem", fontWeight: 700, borderRadius: 4, background: "rgba(168, 85, 247, 0.15)", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", textAlign: "center" }}
                          value={prefix}
                          title="Namespace / Alias do Lookup (ex: row2, lk_regiao)"
                          onChange={(e) => {
                            const newAlias = e.target.value.trim();
                            setLookups(
                              lookups.map((l) =>
                                l.node_id === lk.node_id ? { ...l, alias: newAlias, label: newAlias } : l
                              )
                            );
                          }}
                        />
                        <span className="card-name">{lk.label || lk.node_id} ({lk.join_type === "left" ? "Left" : "Inner"})</span>
                      </div>
                      <div className="card-header-actions">
                        <button
                          className="icon-btn btn-xs"
                          title="Configurações de Join e Modelo"
                          onClick={() =>
                            setShowLookupSettings((prev) => ({
                              ...prev,
                              [lk.node_id]: !isSettingsOpen,
                            }))
                          }
                        >
                          <Sliders size={12} />
                        </button>
                        <button
                          className="icon-btn danger btn-xs"
                          title="Remover lookup"
                          onClick={() => handleRemoveLookup(lk.node_id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Lookup Model & Match Properties */}
                    {isSettingsOpen && (
                      <div className="lookup-properties-grid">
                        <div className="prop-row">
                          <span className="prop-label">Lookup Model</span>
                          <select
                            className="prop-select"
                            value={lk.lookup_model || "Load once"}
                            onChange={(e) =>
                              setLookups(
                                lookups.map((l) =>
                                  l.node_id === lk.node_id
                                    ? { ...l, lookup_model: e.target.value as any }
                                    : l
                                )
                              )
                            }
                          >
                            <option value="Load once">Load once</option>
                            <option value="Reload at each row">Reload at each row</option>
                          </select>
                        </div>

                        <div className="prop-row">
                          <span className="prop-label">Match Model</span>
                          <select
                            className="prop-select"
                            value={normalizeMatchModel(lk.match_model)}
                            onChange={(e) =>
                              setLookups(
                                lookups.map((l) =>
                                  l.node_id === lk.node_id
                                    ? { ...l, match_model: e.target.value as any }
                                    : l
                                )
                              )
                            }
                          >
                            <option value="all">All matches (all)</option>
                            <option value="unique">Unique match (unique)</option>
                            <option value="first">First match (first)</option>
                          </select>
                        </div>

                        <div className="prop-row">
                          <span className="prop-label">Join Model</span>
                          <select
                            className="prop-select"
                            value={normalizeJoinType(lk.join_type, lk.join_model)}
                            onChange={(e) => {
                              const newJoin = e.target.value as "left" | "inner";
                              setLookups(
                                lookups.map((l) =>
                                  l.node_id === lk.node_id
                                    ? {
                                        ...l,
                                        join_type: newJoin,
                                        join_model: newJoin === "inner" ? "inner" : "left_outer",
                                      }
                                    : l
                                )
                              );
                            }}
                          >
                            <option value="left">Left Outer Join (left)</option>
                            <option value="inner">Inner Join (inner)</option>
                          </select>
                        </div>

                        {/* Join Keys List */}
                        <div className="join-keys-section">
                          <div className="join-keys-header">
                            <span className="join-keys-title">
                              <Key size={11} color="var(--accent-purple)" /> Chaves de Junção (Expr. key → Column)
                            </span>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                const newJks = [...(lk.join_keys || []), { expr_key: "", column: "" }];
                                setLookups(
                                  lookups.map((l) => (l.node_id === lk.node_id ? { ...l, join_keys: newJks } : l))
                                );
                              }}
                            >
                              <Plus size={10} /> Chave
                            </button>
                          </div>

                          {(lk.join_keys || []).map((jk, jkIdx) => (
                            <div key={jkIdx} className="join-key-row">
                              <input
                                className="join-key-input"
                                value={jk.expr_key}
                                placeholder="row1.chave_id"
                                onChange={(e) => {
                                  const newJks = [...(lk.join_keys || [])];
                                  newJks[jkIdx] = { ...jk, expr_key: e.target.value };
                                  setLookups(
                                    lookups.map((l) =>
                                      l.node_id === lk.node_id ? { ...l, join_keys: newJks } : l
                                    )
                                  );
                                }}
                              />
                              <span className="join-arrow">→</span>
                              <input
                                className="join-key-input"
                                value={jk.column}
                                placeholder="ID_coluna"
                                list={`datalist-lk-${lk.node_id}`}
                                onChange={(e) => {
                                  const newJks = [...(lk.join_keys || [])];
                                  newJks[jkIdx] = { ...jk, column: e.target.value };
                                  setLookups(
                                    lookups.map((l) =>
                                      l.node_id === lk.node_id ? { ...l, join_keys: newJks } : l
                                    )
                                  );
                                }}
                              />
                              <datalist id={`datalist-lk-${lk.node_id}`}>
                                {(lk.schema || lookupSchemas[lk.node_id] || []).map((c) => (
                                  <option key={c.id || c.name} value={c.name} />
                                ))}
                              </datalist>
                              <button
                                className="icon-btn danger btn-xs"
                                onClick={() => {
                                  const newJks = (lk.join_keys || []).filter((_, i) => i !== jkIdx);
                                  setLookups(
                                    lookups.map((l) =>
                                      l.node_id === lk.node_id ? { ...l, join_keys: newJks } : l
                                    )
                                  );
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Join Filter Section */}
                        <div className="prop-row" style={{ marginTop: 8 }}>
                          <span className="prop-label">Join Filter</span>
                          <input
                            className="prop-input expr-font"
                            value={lk.join_filter || lk.filter_expression || ""}
                            placeholder="ex: lk.ativo == true && lk.validade >= row1.data"
                            title="Filtro condicional avaliado diretamente na cláusula ON do Join"
                            onChange={(e) => {
                              const val = e.target.value;
                              setLookups(
                                lookups.map((l) =>
                                  l.node_id === lk.node_id ? { ...l, join_filter: val, filter_expression: val } : l
                                )
                              );
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Columns List */}
                    <div className="table-card-columns">
                      {lkCols.map((c) => (
                        <div
                          key={c.id || c.name}
                          className="col-row-item draggable-source"
                          draggable
                          onDragStart={(e) => {
                            const qualified = `${prefix}.${c.name}`;
                            e.dataTransfer.setData("text/plain", qualified);
                            e.dataTransfer.setData("application/json", JSON.stringify({ flow: prefix, col: c.name, type: c.type }));
                          }}
                          title={`Clique para mapear no output ativo ou arraste: ${prefix}.${c.name}`}
                          onClick={() => handleAddOrMapColumnToActiveOutput(`${prefix}.${c.name}`, c.name, c.type)}
                        >
                          <span className="col-name">{c.name}</span>
                          <span className="col-type-tag">{c.type}</span>
                          <span className="col-anchor" title="Arraste para mapear na saída" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── CENTER COLUMN: Variables (Var) ─── */}
          <div className="mapper-pane mapper-vars-pane">
            <div className="mapper-pane-header">
              <div className="pane-title">
                <FileCode size={14} color="var(--accent-purple)" />
                <span>Var (Variáveis Intermediárias)</span>
              </div>
              <button className="btn btn-secondary btn-xs" onClick={handleAddVariable}>
                <Plus size={11} /> Var
              </button>
            </div>

            <div className="mapper-pane-scroll">
              <div className="mapper-vars-table-container">
                <table className="mapper-var-grid">
                  <thead>
                    <tr>
                      <th style={{ width: "50%" }}>Expression</th>
                      <th style={{ width: "22%" }}>Type</th>
                      <th style={{ width: "28%" }}>Var</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variables.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <input
                            className="var-cell-input expr-font"
                            value={v.expression}
                            placeholder="row1.col * 1.1"
                            onChange={(e) =>
                              setVariables(
                                variables.map((item) =>
                                  item.id === v.id ? { ...item, expression: e.target.value } : item
                                )
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="var-cell-select"
                            value={v.type || "String"}
                            onChange={(e) =>
                              setVariables(
                                variables.map((item) =>
                                  item.id === v.id ? { ...item, type: e.target.value as any } : item
                                )
                              )
                            }
                          >
                            {COLUMN_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="var-name-cell">
                          <input
                            className="var-cell-input"
                            value={v.name}
                            placeholder="var_nome"
                            onChange={(e) =>
                              setVariables(
                                variables.map((item) =>
                                  item.id === v.id ? { ...item, name: e.target.value } : item
                                )
                              )
                            }
                          />
                          <button
                            className="icon-btn danger btn-xs"
                            onClick={() => handleRemoveVariable(v.id)}
                            title="Excluir variável"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ─── RIGHT COLUMN: Output Streams (out1, reject...) ─── */}
          <div className="mapper-pane mapper-outputs-pane">
            <div className="mapper-pane-header">
              <div className="pane-title">
                <Table2 size={14} color="var(--cat-target)" />
                <span>Saídas (Output Tables)</span>
              </div>
              <div className="output-tabs-strip">
                {outputs.map((out) => (
                  <button
                    key={out.id}
                    className={`output-tab-tag ${out.id === activeOutputId ? "active" : ""} ${out.is_reject ? "reject" : ""}`}
                    onClick={() => {
                      setActiveOutputId(out.id);
                      const el = document.getElementById(`output-card-${out.id}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }}
                    title={out.targetLabel ? `Destino: ${out.targetLabel} (${out.targetId || ""})` : out.name}
                  >
                    <span className="tab-name">{out.name}</span>
                    {out.targetLabel && (
                      <span className="tab-target-label">({out.targetLabel})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="mapper-pane-scroll">
              {outputs.map((out) => {
                const isSettingsOpen = showOutputSettings[out.id] ?? true;

                return (
                  <div
                    key={out.id}
                    id={`output-card-${out.id}`}
                    className={`mapper-table-card output-stream ${out.id === activeOutputId ? "active-focus" : ""} ${out.is_reject ? "reject-card" : ""}`}
                  >
                    {/* Header */}
                    <div className="table-card-header output">
                      <div className="card-title-group">
                        <span className={`card-tag ${out.is_reject ? "reject" : "output"}`}>
                          {out.is_reject ? "Reject" : "Output"}
                        </span>
                        <input
                          className="table-name-inline-input"
                          value={out.name}
                          onChange={(e) =>
                            setOutputs(
                              outputs.map((item) => (item.id === out.id ? { ...item, name: e.target.value } : item))
                            )
                          }
                        />
                        {out.targetLabel && (
                          <span className="card-target-badge" title={`Conectado ao componente: ${out.targetLabel}`}>
                            <ArrowRight size={10} />
                            <span>{out.targetLabel}</span>
                          </span>
                        )}
                      </div>

                      <div className="card-header-actions">
                        <button
                          className="icon-btn btn-xs"
                          title="Propriedades e Filtro do Output"
                          onClick={() =>
                            setShowOutputSettings((prev) => ({
                              ...prev,
                              [out.id]: !isSettingsOpen,
                            }))
                          }
                        >
                          <Filter size={12} />
                        </button>
                        {outputs.length > 1 && (
                          <button
                            className="icon-btn danger btn-xs"
                            title="Remover saída"
                            onClick={() => handleRemoveOutput(out.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Output Filter & Rejects Box */}
                    {isSettingsOpen && (
                      <div className="output-properties-box">
                        <div className="prop-row">
                          <span className="prop-label">Filtro de Saída</span>
                          <input
                            className="prop-input expr-font"
                            value={out.filter_expression || ""}
                            placeholder="ex: row1.ano > 2000"
                            onChange={(e) =>
                              setOutputs(
                                outputs.map((item) =>
                                  item.id === out.id ? { ...item, filter_expression: e.target.value } : item
                                )
                              )
                            }
                          />
                        </div>

                        <div className="prop-checkbox-row">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={out.catch_output_reject ?? false}
                              onChange={(e) =>
                                setOutputs(
                                  outputs.map((item) =>
                                    item.id === out.id ? { ...item, catch_output_reject: e.target.checked } : item
                                  )
                                )
                              }
                            />
                            <span>Catch output reject</span>
                          </label>

                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={out.catch_lookup_reject ?? false}
                              onChange={(e) =>
                                setOutputs(
                                  outputs.map((item) =>
                                    item.id === out.id ? { ...item, catch_lookup_reject: e.target.checked } : item
                                  )
                                )
                              }
                            />
                            <span>Catch lookup inner join reject</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Mappings Table */}
                    <div
                      className="output-mappings-table-container"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedExpr = e.dataTransfer.getData("text/plain");
                        if (draggedExpr) {
                          const colBaseName = draggedExpr.split(".").pop() || `col_${out.columns.length + 1}`;
                          handleAddOrMapColumnToActiveOutput(draggedExpr, colBaseName);
                        }
                      }}
                    >
                      <table className="mapper-out-grid">
                        <thead>
                          <tr>
                            <th style={{ width: "55%" }}>Expression / Origem</th>
                            <th style={{ width: "35%" }}>Column</th>
                            <th style={{ width: "10%" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {out.columns.map((col, idx) => (
                            <tr key={col.id || idx}>
                              <td>
                                <input
                                  className="out-cell-input expr-font"
                                  value={col.expression}
                                  placeholder="row1.coluna"
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const draggedExpr = e.dataTransfer.getData("text/plain");
                                    if (draggedExpr) {
                                      const newCols = [...out.columns];
                                      const colBaseName = draggedExpr.split(".").pop() || col.target;
                                      newCols[idx] = {
                                        ...col,
                                        expression: draggedExpr,
                                        target: col.target.startsWith("col_") || !col.target.trim() ? colBaseName : col.target,
                                      };
                                      setOutputs(
                                        outputs.map((item) =>
                                          item.id === out.id ? { ...item, columns: newCols } : item
                                        )
                                      );
                                    }
                                  }}
                                  onChange={(e) => {
                                    const newCols = [...out.columns];
                                    newCols[idx] = { ...col, expression: e.target.value };
                                    setOutputs(
                                      outputs.map((item) =>
                                        item.id === out.id ? { ...item, columns: newCols } : item
                                      )
                                    );
                                  }}
                                />
                              </td>
                              <td>
                                {(() => {
                                  const isDuplicateTarget = Boolean(
                                    col.target.trim() &&
                                      out.columns.filter(
                                        (c) => c.target.trim().toLowerCase() === col.target.trim().toLowerCase()
                                      ).length > 1
                                  );
                                  return (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                      <input
                                        className={`out-cell-input ${isDuplicateTarget ? "input-duplicate-warning" : ""}`}
                                        value={col.target}
                                        placeholder="nome_coluna"
                                        style={
                                          isDuplicateTarget
                                            ? { borderColor: "#f59e0b", color: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.08)" }
                                            : undefined
                                        }
                                        onChange={(e) => {
                                          const newCols = [...out.columns];
                                          newCols[idx] = { ...col, target: e.target.value };
                                          setOutputs(
                                            outputs.map((item) =>
                                              item.id === out.id ? { ...item, columns: newCols } : item
                                            )
                                          );
                                        }}
                                      />
                                      {isDuplicateTarget && (
                                        <span
                                          title="Aviso: Nome de coluna duplicado nesta saída! Renomeie para evitar erro no banco/Sink."
                                          style={{
                                            color: "#f59e0b",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            cursor: "help",
                                            flexShrink: 0,
                                          }}
                                        >
                                          <AlertCircle size={14} />
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td>
                                <button
                                  className="icon-btn danger btn-xs"
                                  onClick={() => {
                                    const newCols = out.columns.filter((_, i) => i !== idx);
                                    setOutputs(
                                      outputs.map((item) =>
                                        item.id === out.id ? { ...item, columns: newCols } : item
                                      )
                                    );
                                  }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="add-col-footer">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => {
                            const newCol: TMapOutputColumn = {
                              id: `col-${Date.now()}`,
                              target: `col_${out.columns.length + 1}`,
                              expression: "",
                              type: "String",
                              nullable: true,
                            };
                            setOutputs(
                              outputs.map((item) =>
                                item.id === out.id ? { ...item, columns: [...item.columns, newCol] } : item
                              )
                            );
                          }}
                        >
                          <Plus size={11} /> Adicionar Coluna
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── BOTTOM PANEL: Schema Editor & Expression Helper ─── */}
        <div className={`data-mapper-bottom-panel ${bottomExpanded ? "expanded" : "collapsed"}`}>
          {/* Bottom Tabs Bar */}
          <div className="bottom-tabs-bar">
            <div className="bottom-tabs-left">
              <button
                className={`bottom-tab-btn ${bottomTab === "schema" ? "active" : ""}`}
                onClick={() => setBottomTab("schema")}
              >
                <Table2 size={13} />
                <span>Schema Editor (Side-by-Side)</span>
              </button>

              <button
                className={`bottom-tab-btn ${bottomTab === "expression" ? "active" : ""}`}
                onClick={() => setBottomTab("expression")}
              >
                <Sparkles size={13} color="var(--accent-cyan)" />
                <span>Expression Editor & Functions</span>
              </button>
            </div>

            <div className="bottom-tabs-right">
              <button
                className="icon-btn btn-xs"
                title={bottomExpanded ? "Recolher painel" : "Expandir painel"}
                onClick={() => setBottomExpanded(!bottomExpanded)}
              >
                {bottomExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>

          {/* Bottom Tab 1: Schema Editor Side-by-Side */}
          {bottomExpanded && bottomTab === "schema" && (
            <div className="bottom-schema-editor-body">
              {/* Left Side: Input Schema */}
              <div className="schema-side left-side">
                <div className="schema-side-header">
                  <span className="side-title">
                    Origem:{" "}
                    <strong>
                      {activeInputId === "main"
                        ? `${mainAlias} (${availableUpstreamNodes[0]?.label || "Main"})`
                        : lookups.find((l) => l.node_id === activeInputId)?.alias ||
                          lookups.find((l) => l.node_id === activeInputId)?.label ||
                          activeInputId}
                    </strong>
                  </span>
                  <select
                    className="side-stream-picker"
                    value={activeInputId}
                    onChange={(e) => setActiveInputId(e.target.value)}
                  >
                    <option value="main">
                      {mainAlias} ({availableUpstreamNodes[0]?.label || "Main"})
                    </option>
                    {lookups.map((lk) => (
                      <option key={lk.node_id} value={lk.node_id}>
                        {lk.alias || lk.label || lk.node_id} ({lk.label || "Lookup"})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="schema-grid-wrapper">
                  <table className="schema-studio-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th style={{ width: 32 }}>K</th>
                        <th style={{ width: 85 }}>Type</th>
                        <th style={{ width: 32 }}>N</th>
                        <th>Pattern</th>
                        <th style={{ width: 45 }}>Len</th>
                        <th style={{ width: 45 }}>Prec</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeInputId === "main"
                        ? mainSchema
                        : lookupSchemas[activeInputId] || []
                      ).map((c, i) => (
                        <tr key={c.id || i}>
                          <td className="col-name-cell">{c.name}</td>
                          <td className="center-cell">{c.isPrimaryKey ? "🔑" : ""}</td>
                          <td>
                            <span className="type-badge">{c.type}</span>
                          </td>
                          <td className="center-cell">{c.nullable ? "✓" : ""}</td>
                          <td className="pattern-cell">{c.format || ""}</td>
                          <td className="num-cell">{c.length || ""}</td>
                          <td className="num-cell">{c.precision || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Center Transfer Buttons */}
              <div className="schema-transfer-center">
                <button
                  className="transfer-btn"
                  title="Copiar todas as colunas da entrada para a saída ativa (sem duplicar nomes)"
                  onClick={() => {
                    const src = activeInputId === "main" ? mainSchema : lookupSchemas[activeInputId] || [];
                    const prefix =
                      activeInputId === "main"
                        ? mainAlias
                        : lookups.find((l) => l.node_id === activeInputId)?.alias ||
                          lookups.find((l) => l.node_id === activeInputId)?.label ||
                          activeInputId;
                    const currentOut = outputs.find((o) => o.id === activeOutputId);
                    const usedTargets = new Set((currentOut?.columns || []).map((c) => c.target.toLowerCase()));

                    const addedCols: TMapOutputColumn[] = [];
                    src.forEach((c) => {
                      let targetName = c.name;
                      if (usedTargets.has(targetName.toLowerCase())) {
                        if (prefix && !usedTargets.has(`${prefix}_${c.name}`.toLowerCase())) {
                          targetName = `${prefix}_${c.name}`;
                        } else {
                          let counter = 1;
                          while (usedTargets.has(`${c.name}_${counter}`.toLowerCase())) {
                            counter++;
                          }
                          targetName = `${c.name}_${counter}`;
                        }
                      }
                      usedTargets.add(targetName.toLowerCase());
                      addedCols.push({
                        id: `col-${Date.now()}-${targetName}-${Math.random().toString(36).slice(2, 5)}`,
                        target: targetName,
                        expression: `${prefix}.${c.name}`,
                        type: c.type,
                        nullable: c.nullable,
                        isPrimaryKey: c.isPrimaryKey,
                      });
                    });

                    setOutputs(
                      outputs.map((o) => (o.id === activeOutputId ? { ...o, columns: [...o.columns, ...addedCols] } : o))
                    );
                  }}
                >
                  <ChevronsRight size={15} />
                </button>
              </div>

              {/* Right Side: Active Output Schema */}
              <div className="schema-side right-side">
                <div className="schema-side-header">
                  <span className="side-title">
                    Destino: <strong>{activeOutput?.name || "Saída"}</strong>
                    {activeOutput?.targetLabel && (
                      <span className="side-target-sub"> ({activeOutput.targetLabel})</span>
                    )}
                  </span>
                  <div className="schema-side-actions">
                    {outputs.length > 1 && (
                      <select
                        className="side-stream-picker"
                        value={activeOutputId}
                        onChange={(e) => setActiveOutputId(e.target.value)}
                        style={{ marginRight: 6 }}
                      >
                        {outputs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} {o.targetLabel ? `(${o.targetLabel})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        const existingTargets = new Set(
                          (activeOutput?.columns || []).map((c) => c.target.toLowerCase())
                        );
                        let counter = (activeOutput?.columns.length || 0) + 1;
                        while (existingTargets.has(`col_${counter}`.toLowerCase())) {
                          counter++;
                        }
                        const newCol: TMapOutputColumn = {
                          id: `col-${Date.now()}`,
                          target: `col_${counter}`,
                          expression: "",
                          type: "String",
                          nullable: true,
                        };
                        setOutputs(
                          outputs.map((o) =>
                            o.id === activeOutputId ? { ...o, columns: [...o.columns, newCol] } : o
                          )
                        );
                      }}
                    >
                      <Plus size={11} /> Coluna
                    </button>
                  </div>
                </div>

                <div className="schema-grid-wrapper">
                  <table className="schema-studio-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th style={{ width: 32 }}>K</th>
                        <th style={{ width: 95 }}>Type</th>
                        <th style={{ width: 32 }}>N</th>
                        <th>Pattern</th>
                        <th style={{ width: 50 }}>Len</th>
                        <th style={{ width: 50 }}>Prec</th>
                        <th style={{ width: 28 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeOutput?.columns || []).map((c, i) => (
                        <tr key={c.id || i}>
                          <td>
                            <input
                              className="table-cell-input"
                              value={c.target}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, target: e.target.value };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td className="center-cell">
                            <input
                              type="checkbox"
                              checked={c.isPrimaryKey ?? false}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, isPrimaryKey: e.target.checked };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td>
                            <select
                              className="table-cell-select"
                              value={c.type || "String"}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, type: e.target.value as any };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            >
                              {COLUMN_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="center-cell">
                            <input
                              type="checkbox"
                              checked={c.nullable ?? true}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, nullable: e.target.checked };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="table-cell-input"
                              value={c.pattern || ""}
                              placeholder="yyyy-MM-dd"
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, pattern: e.target.value };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="table-cell-input num"
                              value={c.length ?? ""}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, length: Number(e.target.value) || undefined };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="table-cell-input num"
                              value={c.precision ?? ""}
                              onChange={(e) => {
                                const newCols = [...activeOutput.columns];
                                newCols[i] = { ...c, precision: Number(e.target.value) || undefined };
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            />
                          </td>
                          <td>
                            <button
                              className="icon-btn danger btn-xs"
                              onClick={() => {
                                const newCols = activeOutput.columns.filter((_, idx) => idx !== i);
                                setOutputs(
                                  outputs.map((o) =>
                                    o.id === activeOutputId ? { ...o, columns: newCols } : o
                                  )
                                );
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Tab 2: Expression Editor & Function Catalog */}
          {bottomExpanded && bottomTab === "expression" && (
            <div className="bottom-expression-body">
              {/* Left: Categories */}
              <div className="func-categories-pane">
                <span className="func-pane-title">Categorias</span>
                {[
                  "Texto / String",
                  "Numérico / Math",
                  "Data & Hora",
                  "Condicional / Lógica",
                ].map((cat) => (
                  <button
                    key={cat}
                    className={`func-cat-btn ${selectedFuncCategory === cat ? "active" : ""}`}
                    onClick={() => setSelectedFuncCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Right: Function List with Doc & Copy */}
              <div className="func-list-pane">
                <span className="func-pane-title">Funções Disponíveis — {selectedFuncCategory}</span>
                <div className="func-cards-grid">
                  {FUNCTION_CATALOG.filter((f) => f.category === selectedFuncCategory).map((f) => (
                    <div
                      key={f.name}
                      className="func-doc-card"
                      title="Clique para copiar a sintaxe para a área de transferência"
                      onClick={() => navigator.clipboard.writeText(f.syntax)}
                    >
                      <div className="func-card-header">
                        <span className="func-name">{f.name}</span>
                        <code className="func-syntax">{f.syntax}</code>
                      </div>
                      <p className="func-desc">{f.description}</p>
                      <div className="func-example">
                        <span>Ex:</span> <code>{f.example}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
