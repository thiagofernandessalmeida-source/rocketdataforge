export interface SchemaColumn {
  id: string;
  name: string;
  type: any;
  nullable: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  [key: string]: any;
}

export interface TMapLookupConfig {
  node_id: string;
  label: string;
  alias?: string;
  join_type?: string;
  join_model?: string;
  lookup_model?: string;
  match_model?: string;
  left_keys?: string[];
  right_keys?: string[];
  join_keys?: { expr_key: string; column: string }[];
  filter_expression?: string;
  join_filter?: string;
  schema?: SchemaColumn[];
}

export interface UpstreamNodeInfo {
  id: string;
  label: string;
  alias?: string;
  schema?: SchemaColumn[];
}

export interface DerivedLookupsResult {
  lookups: TMapLookupConfig[];
  disconnectedWarnings: string[];
  mainNodeId: string;
}

/**
 * Retorna o nó upstream que representa o Main Stream.
 * Prioriza explicitamente config.main_input_id; fallback para o primeiro nó upstream.
 */
export function getMainInputNode(
  availableUpstreamNodes: UpstreamNodeInfo[] = [],
  mainInputId?: string
): UpstreamNodeInfo | undefined {
  if (mainInputId) {
    const found = availableUpstreamNodes.find((n) => n.id === mainInputId);
    if (found) return found;
  }
  return availableUpstreamNodes[0];
}

/**
 * Retorna o schema efetivo de um lookup:
 * 1. Schema ao vivo do nó conectado (se length > 0)
 * 2. Schema de lookupSchemas cacheado no parent (se length > 0)
 * 3. Schema salvo no config do lookup (se length > 0)
 * 4. [] fallback vazio
 */
export function getLookupEffectiveSchema(
  lookup: { node_id: string; schema?: SchemaColumn[] },
  connectedNode?: { id: string; schema?: SchemaColumn[] } | null,
  lookupSchemas: Record<string, SchemaColumn[]> = {}
): SchemaColumn[] {
  if (connectedNode?.schema && Array.isArray(connectedNode.schema) && connectedNode.schema.length > 0) {
    return connectedNode.schema;
  }
  const fromLookupSchemas = lookupSchemas[lookup.node_id];
  if (fromLookupSchemas && Array.isArray(fromLookupSchemas) && fromLookupSchemas.length > 0) {
    return fromLookupSchemas;
  }
  if (lookup.schema && Array.isArray(lookup.schema) && lookup.schema.length > 0) {
    return lookup.schema;
  }
  return [];
}

/**
 * Normaliza tipo e modelo de junção para consistência.
 */
export function normalizeJoinType(joinType?: string, joinModel?: string): "left" | "inner" {
  if (joinType === "inner" || joinModel === "inner") return "inner";
  return "left";
}

export function normalizeMatchModel(matchModel?: string): "first" | "last" | "all" {
  if (matchModel === "first" || matchModel === "last") return matchModel;
  return "all";
}

/**
 * 1.1: Deriva os lookups dos nós conectados que não são o main.
 * Mescla as configurações salvas pelo node_id real.
 * Não cria cartões fantasmas para lookups desconectados; reporta avisos visíveis.
 */
export function deriveTMapLookups(
  availableUpstreamNodes: UpstreamNodeInfo[] = [],
  savedLookups: TMapLookupConfig[] = [],
  lookupSchemas: Record<string, SchemaColumn[]> = {},
  mainInputId?: string
): DerivedLookupsResult {
  const mainNode = getMainInputNode(availableUpstreamNodes, mainInputId);
  const mainNodeId = mainNode?.id || "";

  // Nós conectados que são candidatos a lookups (todos exceto o main)
  const connectedLookupNodes = availableUpstreamNodes.filter((n) => n.id && n.id !== mainNodeId);
  const connectedNodeIds = new Set(connectedLookupNodes.map((n) => n.id));

  // Detecta lookups que estavam salvos mas não estão mais conectados ao tMap
  const disconnectedWarnings: string[] = [];
  savedLookups.forEach((saved) => {
    if (saved.node_id && !connectedNodeIds.has(saved.node_id)) {
      const name = saved.alias || saved.label || saved.node_id;
      disconnectedWarnings.push(
        `Aviso: O lookup "${name}" (ID: ${saved.node_id}) não possui mais nó conectado no Canvas.`
      );
    }
  });

  // Para cada nó conectado como lookup, mescla com as configs salvas ou edições anteriores
  const derivedLookups: TMapLookupConfig[] = connectedLookupNodes.map((un, idx) => {
    const existing = savedLookups.find((sl) => sl.node_id === un.id);
    const effectiveSchema = getLookupEffectiveSchema(
      existing || { node_id: un.id },
      un,
      lookupSchemas
    );

    const alias = existing?.alias || un.alias || `row${idx + 2}`;
    const label = un.label || existing?.label || `lkp${idx + 1}`;

    const join_type = normalizeJoinType(existing?.join_type, existing?.join_model);
    const join_model = join_type === "inner" ? "inner" : "left_outer";
    const match_model = normalizeMatchModel(existing?.match_model);
    const lookup_model = existing?.lookup_model || "Load once";

    const join_keys =
      existing?.join_keys && existing.join_keys.length > 0
        ? existing.join_keys
        : existing?.left_keys && existing.left_keys.length > 0
        ? existing.left_keys.map((k, i) => ({
            expr_key: k,
            column: existing.right_keys?.[i] || "",
          }))
        : [{ expr_key: "", column: "" }];

    return {
      node_id: un.id,
      label,
      alias,
      join_type,
      join_model,
      match_model,
      lookup_model,
      left_keys: existing?.left_keys || [],
      right_keys: existing?.right_keys || [],
      join_keys,
      filter_expression: existing?.filter_expression || "",
      join_filter: existing?.join_filter || existing?.filter_expression || "",
      schema: effectiveSchema,
    };
  });

  return {
    lookups: derivedLookups,
    disconnectedWarnings,
    mainNodeId,
  };
}
