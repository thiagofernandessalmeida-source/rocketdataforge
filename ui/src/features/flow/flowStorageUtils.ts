/**
 * RocketDataForge — Utilidades de persistência da View de Fluxo em localStorage
 * Todas as operações utilizam try/catch com fallback resiliente para modo privado.
 */

const STORAGE_PREFIX = "cellflow_flow_expanded_";

export function getExpandedCellsPreference(jobId: string): Set<string> {
  if (!jobId) return new Set();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${jobId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    }
  } catch (_) {}
  return new Set();
}

export function setExpandedCellsPreference(jobId: string, expandedIds: Set<string>): void {
  if (!jobId) return;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const arr = Array.from(expandedIds);
      window.localStorage.setItem(`${STORAGE_PREFIX}${jobId}`, JSON.stringify(arr));
    }
  } catch (_) {}
}
