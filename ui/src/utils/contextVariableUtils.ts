/**
 * Utilitários puros para manipulação e tipagem de variáveis de contexto (Tarefa 1).
 */

export interface ContextVarItem {
  id?: string;
  key: string;
  type: "string" | "number" | "boolean" | "secret";
  scope: "global" | "local";
  jobId?: string;
  values: Record<string, string>;
  isSecret?: boolean;
}

export function buildContextVariablesMap(
  contextVariables: ContextVarItem[],
  activeEnv: string = "dev",
  jobId?: string
): Record<string, any> {
  const vars = jobId
    ? contextVariables.filter((cv) => cv.scope === "global" || cv.jobId === jobId)
    : contextVariables;

  const result: Record<string, any> = {};

  for (const cv of vars) {
    const rawVal = cv.values?.[activeEnv] ?? cv.values?.["dev"] ?? "";
    if (cv.type === "number") {
      const num = Number(rawVal);
      result[cv.key] = isNaN(num) ? 0 : num;
    } else if (cv.type === "boolean") {
      result[cv.key] = String(rawVal).toLowerCase() === "true" || rawVal === "1";
    } else {
      result[cv.key] = String(rawVal);
    }
  }

  return result;
}

export function applyContextVarUpdates(
  contextVariables: ContextVarItem[],
  updates: Record<string, any>,
  activeEnv: string = "dev"
): { updatedVars: ContextVarItem[]; modified: boolean } {
  if (!updates || typeof updates !== "object") {
    return { updatedVars: contextVariables, modified: false };
  }

  let modified = false;
  const updatedVars = contextVariables.map((cv) => {
    if (cv.key in updates) {
      modified = true;
      return {
        ...cv,
        values: {
          ...cv.values,
          [activeEnv]: String(updates[cv.key]),
        },
      };
    }
    return cv;
  });

  return { updatedVars, modified };
}
