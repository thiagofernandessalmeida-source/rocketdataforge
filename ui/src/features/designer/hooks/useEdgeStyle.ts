import { useState, useEffect, useCallback } from "react";

export type EdgeStyle = "curva" | "ortogonal";

const STORAGE_KEY = "cellflow_edge_style";
const DEFAULT_STYLE: EdgeStyle = "ortogonal";
const EVENT_NAME = "cellflow_edge_style_change";

/**
 * Lê a preferência de estilo de aresta do localStorage com proteção estrita de try/catch.
 */
export function getEdgeStylePreference(): EdgeStyle {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "curva" || saved === "ortogonal") {
        return saved;
      }
    }
  } catch (_) {}
  return DEFAULT_STYLE;
}

/**
 * Persiste a preferência de estilo no localStorage e emite evento customizado para sincronia.
 */
export function setEdgeStylePreference(style: EdgeStyle): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, style);
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: style }));
      }
    }
  } catch (_) {}
}

/**
 * Hook reativo para leitura e alternância do estilo de aresta ("curva" | "ortogonal").
 */
export function useEdgeStyle(): [EdgeStyle, (newStyle: EdgeStyle) => void] {
  const [style, setStyle] = useState<EdgeStyle>(getEdgeStylePreference);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setStyle(getEdgeStylePreference());
      }
    };

    const handleCustom = (e: any) => {
      if (e?.detail === "curva" || e?.detail === "ortogonal") {
        setStyle(e.detail);
      } else {
        setStyle(getEdgeStylePreference());
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_NAME, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_NAME, handleCustom);
    };
  }, []);

  const changeStyle = useCallback((newStyle: EdgeStyle) => {
    setStyle(newStyle);
    setEdgeStylePreference(newStyle);
  }, []);

  return [style, changeStyle];
}
