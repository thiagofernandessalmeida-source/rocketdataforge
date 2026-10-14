import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import {
  RotateCcw,
  Terminal,
  Table,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Code2,
} from "lucide-react";
import { CanvasCellData, jobStore } from "../../../store/jobStore";
import { getBaseApiUrl } from "../../../api/client";

interface PythonCellEditorProps {
  cell: CanvasCellData;
  jobId: string;
  allCells: CanvasCellData[];
  onUpdateCode: (code: string) => void;
  onExecutionFinished?: (result: any) => void;
}

export const PythonCellEditor: React.FC<PythonCellEditorProps> = ({
  cell,
  jobId,
  allCells,
  onUpdateCode,
  onExecutionFinished,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [stdout, setStdout] = useState<string>("");
  const [stderr, setStderr] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outputPreview, setOutputPreview] = useState<any>(null);
  const [durationMs, setDurationMs] = useState<number | null>(cell.metrics?.durationMs ?? null);
  const [activeTab, setActiveTab] = useState<"console" | "table">("console");
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  const editorRef = useRef<any>(null);
  const codeRef = useRef<string>(cell.codeSnippet || "");
  const debounceTimerRef = useRef<any>(null);
  const currentCellIdRef = useRef<string>(cell.id);

  // Se trocar de célula (ID diferente), atualiza o editor com o novo snippet
  useEffect(() => {
    if (cell.id !== currentCellIdRef.current) {
      currentCellIdRef.current = cell.id;
      codeRef.current = cell.codeSnippet || "";
      if (editorRef.current) {
        editorRef.current.setValue(cell.codeSnippet || "");
      }
      setStdout("");
      setStderr("");
      setErrorMsg(null);
      setOutputPreview(null);
      setDurationMs(cell.metrics?.durationMs ?? null);
    }
  }, [cell.id, cell.codeSnippet, cell.metrics]);

  // Se a célula foi executada pelo botão do cabeçalho superior, reflete os logs
  useEffect(() => {
    if (cell.logs && cell.logs.length > 0) {
      const stdOutEntries = cell.logs.filter((l: any) => l.level === "INFO").map((l: any) => l.message).join("\n");
      const errEntries = cell.logs.filter((l: any) => l.level === "ERROR" || l.level === "WARN").map((l: any) => l.message).join("\n");
      if (stdOutEntries) setStdout(stdOutEntries);
      if (errEntries) setStderr(errEntries);
    }
    if (cell.metrics?.durationMs !== undefined) {
      setDurationMs(cell.metrics.durationMs);
    }
  }, [cell.logs, cell.metrics, cell.status]);

  // Atualização debounced para o jobStore: evita re-render do React a cada caractere digitado
  const handleEditorChange = (value: string | undefined) => {
    const val = value ?? "";
    codeRef.current = val;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onUpdateCode(val);
    }, 350);
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Configura o valor inicial
    if (cell.codeSnippet) {
      editor.setValue(cell.codeSnippet);
    }

    // Atalho Ctrl+Enter ou Cmd+Enter para executar o código
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRun();
    });
  };

  const handleRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setErrorMsg(null);

    // Garante que o código mais recente do editor foi persistido
    const latestCode = editorRef.current ? editorRef.current.getValue() : codeRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    onUpdateCode(latestCode);

    // Coleta as saídas das células anteriores para o State Handoff
    const sharedOutputs: Record<string, any> = {};
    for (const c of allCells) {
      if (c.id !== cell.id && c.metrics?.rowsOut !== undefined) {
        sharedOutputs[c.id] = c.id;
        sharedOutputs[c.name] = c.name;
      }
    }

    try {
      const res = await fetch(`${getBaseApiUrl()}/pipelines/cells/python/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: latestCode,
          cell_id: cell.id,
          cell_name: cell.name,
          shared_outputs: sharedOutputs,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Erro HTTP ${res.status}`);
      }

      const data = await res.json();
      setStdout(data.stdout || "");
      setStderr(data.stderr || "");
      setErrorMsg(data.error || null);
      setOutputPreview(data.output_preview || null);
      setDurationMs(data.duration_ms ?? null);

      if (data.output_preview && data.output_preview.type === "dataframe") {
        setActiveTab("table");
      } else {
        setActiveTab("console");
      }

      const status = data.success ? "success" : "failed";
      jobStore.setCellStatus(jobId, cell.id, status);

      const logs: any[] = [];
      if (data.stdout) {
        logs.push({ timestamp: new Date().toISOString(), level: "INFO", message: data.stdout });
      }
      if (data.stderr || data.error) {
        logs.push({ timestamp: new Date().toISOString(), level: "ERROR", message: data.stderr || data.error });
      }

      if (data.duration_ms !== undefined) {
        jobStore.setCellExecutionResults(
          jobId,
          cell.id,
          status,
          {
            durationMs: data.duration_ms,
            rowsIn: 0,
            rowsOut: data.rows_out || 0,
          },
          logs,
          true
        );
      }

      onExecutionFinished?.(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Falha na comunicação com o runner Python.");
      jobStore.setCellStatus(jobId, cell.id, "failed");
    } finally {
      setIsRunning(false);
    }
  };

  const handleClearOutput = () => {
    setStdout("");
    setStderr("");
    setErrorMsg(null);
    setOutputPreview(null);
    setDurationMs(null);
  };

  return (
    <div
      className="python-cell-container"
      onKeyDown={(e) => {
        // Evita que o ReactFlow ou o container pai intercepte espaço, backspace ou delete
        e.stopPropagation();
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyPress={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "#0d1117",
        position: "relative",
      }}
    >
      {/* ─── Top Code Editor Sub-Bar (Informativa, sem botão duplicado) ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 14px",
          background: "#161b22",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#38bdf8",
              background: "rgba(56, 189, 248, 0.12)",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid rgba(56, 189, 248, 0.25)",
            }}
          >
            <Code2 size={13} />
            <span>Python 3.12 Engine</span>
          </div>

          <span style={{ fontSize: "0.72rem", color: "rgba(148, 163, 184, 0.8)" }}>
            Escopo: <code style={{ color: "#facc15" }}>context</code>, <code style={{ color: "#38bdf8" }}>pl</code> (Polars), <code style={{ color: "#ec4899" }}>duckdb</code>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {durationMs !== null && (
            <span style={{ fontSize: "0.7rem", color: "#10b981", marginRight: 4 }}>
              ⚡ {durationMs}ms
            </span>
          )}

          <span style={{ fontSize: "0.68rem", color: "rgba(148, 163, 184, 0.6)" }}>
            Atalho: <kbd style={{ padding: "1px 4px", background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>Ctrl + Enter</kbd>
          </span>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.72rem", padding: "3px 8px" }}
            onClick={handleClearOutput}
            title="Limpar saídas e console"
          >
            <RotateCcw size={12} /> Limpar Saída
          </button>
        </div>
      </div>

      {/* ─── Monaco Code Editor ─── */}
      <div
        style={{
          flex: isPanelExpanded ? 1 : 2,
          minHeight: 180,
          position: "relative",
        }}
      >
        <Editor
          height="100%"
          language="python"
          theme="vs-dark"
          defaultValue={cell.codeSnippet || ""}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
          options={{
            fontSize: 13,
            fontFamily: "var(--font-mono, 'Fira Code', monospace)",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: "on",
            tabSize: 4,
            wordWrap: "on",
            padding: { top: 8, bottom: 8 },
            suggestOnTriggerCharacters: true,
            folding: true,
            acceptSuggestionOnEnter: "on",
            quickSuggestions: true,
            tabCompletion: "on",
          }}
        />
      </div>

      {/* ─── Output & State Handoff Panel ─── */}
      <div
        style={{
          flex: isPanelExpanded ? 2 : 1,
          minHeight: 120,
          maxHeight: isPanelExpanded ? "70%" : "40%",
          display: "flex",
          flexDirection: "column",
          background: "#090d13",
          borderTop: "1px solid rgba(255, 255, 255, 0.12)",
        }}
      >
        {/* Panel Header & Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            background: "#111722",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className={`cell-tab-btn ${activeTab === "console" ? "active" : ""}`}
              onClick={() => setActiveTab("console")}
              style={{
                fontSize: "0.72rem",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: activeTab === "console" ? "rgba(255, 255, 255, 0.1)" : "transparent",
                color: activeTab === "console" ? "#f8fafc" : "#94a3b8",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              <Terminal size={12} />
              Console (stdout/stderr)
              {(stdout || stderr || errorMsg) && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: errorMsg ? "#ef4444" : "#10b981",
                  }}
                />
              )}
            </button>

            <button
              type="button"
              className={`cell-tab-btn ${activeTab === "table" ? "active" : ""}`}
              onClick={() => setActiveTab("table")}
              style={{
                fontSize: "0.72rem",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: activeTab === "table" ? "rgba(255, 255, 255, 0.1)" : "transparent",
                color: activeTab === "table" ? "#f8fafc" : "#94a3b8",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              <Table size={12} />
              Tabela de Saída (State Handoff)
              {outputPreview?.rowCount !== undefined && (
                <span style={{ fontSize: "0.68rem", opacity: 0.8, color: "#38bdf8" }}>
                  ({outputPreview.rowCount} linhas)
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            className="icon-btn"
            style={{ padding: 2, color: "#94a3b8" }}
            onClick={() => setIsPanelExpanded(!isPanelExpanded)}
            title={isPanelExpanded ? "Reduzir painel" : "Expandir painel"}
          >
            {isPanelExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>

        {/* Panel Content Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 12px", fontFamily: "var(--font-mono, monospace)" }}>
          {activeTab === "console" && (
            <div>
              {errorMsg && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#fca5a5",
                    padding: "6px 10px",
                    borderRadius: 4,
                    fontSize: "0.75rem",
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                >
                  <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {stderr && (
                <pre
                  style={{
                    color: "#f87171",
                    fontSize: "0.73rem",
                    margin: "0 0 6px 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {stderr}
                </pre>
              )}

              {stdout ? (
                <pre
                  style={{
                    color: "#e2e8f0",
                    fontSize: "0.73rem",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {stdout}
                </pre>
              ) : !stderr && !errorMsg ? (
                <div style={{ color: "rgba(148, 163, 184, 0.5)", fontSize: "0.73rem", fontStyle: "italic" }}>
                  Nenhuma saída gerada. Clique em "Executar Célula" no cabeçalho ou pressione Ctrl+Enter para rodar.
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "table" && (
            <div>
              {outputPreview?.type === "dataframe" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      fontSize: "0.7rem",
                      color: "#94a3b8",
                      marginBottom: 8,
                      paddingBottom: 4,
                      borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <span>
                      Total de Linhas: <strong style={{ color: "#38bdf8" }}>{outputPreview.rowCount}</strong>
                    </span>
                    <span>
                      Colunas: <strong style={{ color: "#38bdf8" }}>{outputPreview.colCount}</strong>
                    </span>
                    <span style={{ color: "#10b981" }}>✓ Publicado no context.write_output()</span>
                  </div>

                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.73rem",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "rgba(255, 255, 255, 0.05)" }}>
                        {outputPreview.columns?.map((col: any) => (
                          <th
                            key={col.name}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              color: "#f8fafc",
                            }}
                          >
                            <div>{col.name}</div>
                            <div style={{ fontSize: "0.62rem", color: "#38bdf8", fontWeight: 400 }}>
                              {col.type}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outputPreview.sample?.map((row: any, idx: number) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255, 255, 255, 0.02)" }}>
                          {outputPreview.columns?.map((col: any) => (
                            <td
                              key={col.name}
                              style={{
                                padding: "4px 8px",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                color: "#cbd5e1",
                              }}
                            >
                              {String(row[col.name] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : outputPreview?.type === "raw" ? (
                <pre style={{ color: "#e2e8f0", fontSize: "0.73rem", margin: 0 }}>
                  {outputPreview.value}
                </pre>
              ) : (
                <div style={{ color: "rgba(148, 163, 184, 0.5)", fontSize: "0.73rem", fontStyle: "italic" }}>
                  A célula ainda não publicou dados via <code style={{ color: "#38bdf8" }}>context.write_output(df)</code>.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
