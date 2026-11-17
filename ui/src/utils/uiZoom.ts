/**
 * uiZoom.ts — Gerenciador de Zoom Geral da Interface ("Zoom da Interface")
 *
 * Suporta escalonamento nativo via Electron (webContents.setZoomFactor)
 * para a Janela Principal e Janela de Logs com persistência em disco.
 *
 * NOTA ARQUITETURAL IMPORTANTE:
 * No navegador (modo desenvolvimento / Vite puro), aplicamos o zoom ajustando
 * document.documentElement.style.fontSize.
 * NÃO usar CSS 'zoom' nem 'transform: scale' no document.body ou containers raiz,
 * pois isso corrompe a matriz de coordenadas do React Flow (screenToFlowPosition)
 * e inutiliza o drag-and-drop de componentes da paleta para o canvas.
 */

export const ZOOM_LEVELS: readonly number[] = [
  0.5,
  0.67,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
];

const STORAGE_KEY = "cellflow_ui_zoom";
const BASE_FONT_SIZE_PX = 16;

export interface CellflowZoomBridge {
  get: () => Promise<number>;
  set: (factor: number) => Promise<number>;
  onChange: (callback: (factor: number) => void) => () => void;
}

declare global {
  interface Window {
    cellflowZoom?: CellflowZoomBridge;
  }
}

let currentZoomFactor: number = 1.0;
const listeners = new Set<(factor: number) => void>();

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb(currentZoomFactor);
    } catch (err) {
      console.error("[uiZoom] Erro em listener de zoom:", err);
    }
  });
}

function applyBrowserFallback(factor: number) {
  if (typeof document !== "undefined" && document.documentElement) {
    try {
      document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * factor}px`;
    } catch (_) {}
  }
}

// Inicialização automática do estado de zoom
if (typeof window !== "undefined") {
  if (window.cellflowZoom?.get) {
    window.cellflowZoom
      .get()
      .then((val) => {
        if (typeof val === "number" && !isNaN(val)) {
          currentZoomFactor = val;
          notifyListeners();
        }
      })
      .catch(() => {});

    window.cellflowZoom.onChange?.((factor) => {
      if (typeof factor === "number" && !isNaN(factor)) {
        currentZoomFactor = factor;
        notifyListeners();
      }
    });
  } else {
    // Fallback de navegador (desenvolvimento web)
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 2.0) {
          currentZoomFactor = Math.round(parsed * 100) / 100;
          applyBrowserFallback(currentZoomFactor);
        }
      }
    } catch (_) {}
  }
}

/**
 * Retorna o fator de zoom atual (ex: 1.0 para 100%, 1.25 para 125%)
 */
export function getCurrentZoom(): number {
  return currentZoomFactor;
}

/**
 * Retorna o percentual arredondado de zoom para exibição na UI (ex: 100, 110, 125)
 */
export function getCurrentPercent(): number {
  return Math.round(currentZoomFactor * 100);
}

/**
 * Inscreve um callback para ser notificado sempre que o zoom mudar
 */
export function subscribeZoom(callback: (factor: number) => void): () => void {
  listeners.add(callback);
  callback(currentZoomFactor);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Localiza o índice do nível de zoom mais próximo no array discreto ZOOM_LEVELS
 */
function findClosestLevelIndex(current: number): number {
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(ZOOM_LEVELS[i] - current);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return closestIdx;
}

/**
 * Aplica um novo fator de zoom (clamped entre 0.5 e 2.0)
 */
export async function setZoom(rawFactor: number): Promise<number> {
  const clamped = Math.min(2.0, Math.max(0.5, Math.round(rawFactor * 100) / 100));

  if (typeof window !== "undefined" && window.cellflowZoom?.set) {
    try {
      const updated = await window.cellflowZoom.set(clamped);
      currentZoomFactor = updated;
      notifyListeners();
      return updated;
    } catch (err) {
      console.warn("[uiZoom] Falha ao comunicar com IPC Electron:", err);
    }
  }

  // Fallback navegador
  currentZoomFactor = clamped;
  applyBrowserFallback(clamped);
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch (_) {}

  notifyListeners();
  return clamped;
}

/**
 * Aumenta o zoom para o próximo patamar discreto de ZOOM_LEVELS
 */
export async function zoomIn(): Promise<number> {
  const currentIdx = findClosestLevelIndex(currentZoomFactor);
  const nextIdx = Math.min(ZOOM_LEVELS.length - 1, currentIdx + 1);
  return setZoom(ZOOM_LEVELS[nextIdx]);
}

/**
 * Diminui o zoom para o patamar discreto anterior de ZOOM_LEVELS
 */
export async function zoomOut(): Promise<number> {
  const currentIdx = findClosestLevelIndex(currentZoomFactor);
  const prevIdx = Math.max(0, currentIdx - 1);
  return setZoom(ZOOM_LEVELS[prevIdx]);
}

/**
 * Redefine o zoom para o padrão 100% (fator 1.0)
 */
export async function resetZoom(): Promise<number> {
  return setZoom(1.0);
}
