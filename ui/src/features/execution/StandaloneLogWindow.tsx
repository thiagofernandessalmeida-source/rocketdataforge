import React, { useState, useEffect, useCallback } from "react";
import { Terminal, Pin, ArrowDownLeft } from "lucide-react";
import { executionLogStore } from "../../store/executionLogStore";
import { LogViewerContent } from "./LogViewerContent";

export const StandaloneLogWindow: React.FC = () => {
  const [alwaysOnTop, setAlwaysOnTopState] = useState<boolean>(false);

  useEffect(() => {
    const logsApi = (window as any).cellflowLogs;
    if (!logsApi) return;

    // Obtém estado inicial de fixar por cima
    logsApi.getAlwaysOnTop?.().then?.((val: boolean) => {
      setAlwaysOnTopState(Boolean(val));
    });

    // Inscreve ouvintes de IPC vindos do processo principal
    const unsubChunk = logsApi.onSnapshotChunk?.((chunk: any[]) => {
      if (Array.isArray(chunk) && chunk.length > 0) {
        executionLogStore.addLogs(chunk);
      }
    });

    const unsubAppend = logsApi.onAppend?.((items: any[]) => {
      if (Array.isArray(items) && items.length > 0) {
        executionLogStore.addLogs(items);
      }
    });

    const unsubClear = logsApi.onClear?.(() => {
      executionLogStore.clearLogs();
    });

    // Notifica que a janela está pronta e solicita snapshot inicial
    logsApi.ready?.();
    logsApi.requestSnapshot?.();

    return () => {
      unsubChunk?.();
      unsubAppend?.();
      unsubClear?.();
    };
  }, []);

  const handleToggleAlwaysOnTop = useCallback(async () => {
    const logsApi = (window as any).cellflowLogs;
    if (!logsApi?.setAlwaysOnTop) return;
    const next = !alwaysOnTop;
    await logsApi.setAlwaysOnTop(next);
    setAlwaysOnTopState(next);
  }, [alwaysOnTop]);

  const handleReattach = useCallback(() => {
    const logsApi = (window as any).cellflowLogs;
    logsApi?.reattach?.();
  }, []);

  const handleFocusNode = useCallback((nodeId: string, cellId?: string) => {
    const logsApi = (window as any).cellflowLogs;
    logsApi?.focusNode?.(nodeId, cellId);
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#070a12",
        color: "#f8fafc",
        overflow: "hidden",
      }}
    >
      {/* ─── Topbar Nativo da Janela de Logs ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 14px",
          background: "#0f172a",
          borderBottom: "1px solid #1e293b",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Terminal size={15} color="var(--accent-purple)" />
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f8fafc" }}>
            CellFlow - Log Geral (Sessão)
          </span>
          <span
            style={{
              fontSize: "0.65rem",
              color: "#38bdf8",
              background: "rgba(56, 189, 248, 0.12)",
              padding: "2px 6px",
              borderRadius: 10,
            }}
          >
            Janela Nativa
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Manter por cima */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleToggleAlwaysOnTop}
            style={{
              fontSize: "0.7rem",
              padding: "3px 8px",
              display: "flex",
              alignItems: "center",
              gap: 5,
              borderColor: alwaysOnTop ? "var(--accent-cyan)" : undefined,
              color: alwaysOnTop ? "var(--accent-cyan)" : undefined,
              background: alwaysOnTop ? "rgba(0, 229, 255, 0.1)" : undefined,
            }}
            title={alwaysOnTop ? "Desativar sempre visível por cima" : "Manter janela sempre visível por cima de outras"}
          >
            <Pin size={12} style={{ transform: alwaysOnTop ? "rotate(45deg)" : "none" }} />
            <span>{alwaysOnTop ? "Fixado por cima" : "Manter por cima"}</span>
          </button>

          {/* Reacoplar */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReattach}
            style={{ fontSize: "0.7rem", padding: "3px 8px", display: "flex", alignItems: "center", gap: 5 }}
            title="Fechar esta janela e reexibir os logs na barra lateral do app principal"
          >
            <ArrowDownLeft size={12} />
            <span>Reacoplar</span>
          </button>
        </div>
      </div>

      {/* ─── Corpo: LogViewerContent em tela cheia ─── */}
      <div style={{ flex: 1, minHeight: 0, height: "calc(100% - 38px)", display: "flex", flexDirection: "column" }}>
        <LogViewerContent
          onFocusNode={handleFocusNode}
          onExpandPopOut={undefined}
        />
      </div>
    </div>
  );
};

