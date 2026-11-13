import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Search,
  Filter,
  Download,
  Copy,
  Trash2,
  Check,
  Terminal,
  Layers,
  ArrowUpDown,
  RefreshCw,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  executionLogStore,
  ExecutionLogItem,
  LogFilterOptions,
} from "../../store/executionLogStore";

interface LogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFocusNode?: (nodeId: string, cellId?: string) => void;
}

export const LogViewerModal: React.FC<LogViewerModalProps> = ({
  isOpen,
  onClose,
  onFocusNode,
}) => {
  const [levelFilter, setLogLevelFilter] = useState<string>("ALL");
  const [cellFilter, setCellFilter] = useState<string>("ALL");
  const [searchText, setSearchText] = useState<string>("");
  const [groupByCell, setGroupByCell] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [copiedFeedback, setCopiedFeedback] = useState<boolean>(false);
  const [version, setVersion] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const logRowsRef = useRef<HTMLDivElement>(null);

  // Inscreve no store para atualizações em tempo real
  useEffect(() => {
    const unsub = executionLogStore.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  const distinctCells = useMemo(() => {
    return executionLogStore.getDistinctCells();
  }, [version]);

  const filterOptions: LogFilterOptions = useMemo(() => {
    return {
      level: levelFilter,
      cellId: cellFilter,
      search: searchText,
    };
  }, [levelFilter, cellFilter, searchText]);

  const logs = useMemo(() => {
    return executionLogStore.getLogs(filterOptions);
  }, [filterOptions, version]);

  useEffect(() => {
    if (autoScroll && logRowsRef.current) {
      logRowsRef.current.scrollTop = logRowsRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (!isOpen) return null;

  const handleCopyLogs = async () => {
    const text = executionLogStore.exportLogs("log", filterOptions);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 2000);
    } catch (_) {}
  };

  const handleDownload = (format: "log" | "json") => {
    const content = executionLogStore.exportLogs(format, filterOptions);
    const blob = new Blob([content], {
      type: format === "json" ? "application/json" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cellflow-execution-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (confirm("Deseja realmente limpar todos os logs desta sessão?")) {
      executionLogStore.clearLogs();
    }
  };

  // Agrupamento por célula se ativo
  const groupedLogs = groupByCell
    ? logs.reduce((acc: Record<string, ExecutionLogItem[]>, log: ExecutionLogItem) => {
        const key = log.cellName || log.cellId || "Geral / Sem Célula";
        if (!acc[key]) acc[key] = [];
        acc[key].push(log);
        return acc;
      }, {} as Record<string, ExecutionLogItem[]>)
    : null;

  const renderLogRow = (log: ExecutionLogItem) => {
    const lvlUpper = log.level.toUpperCase();
    const isError = lvlUpper === "ERROR";
    const isWarn = lvlUpper === "WARN";
    const isDebug = lvlUpper === "DEBUG";

    return (
      <div
        key={log.id}
        className={`log-table-row ${isError ? "row-error" : isWarn ? "row-warn" : isDebug ? "row-debug" : ""}`}
        onClick={() => {
          if (log.nodeId) {
            onFocusNode?.(log.nodeId, log.cellId);
          }
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "85px 65px 160px 160px 1fr",
          gap: 8,
          padding: "5px 12px",
          fontSize: "0.74rem",
          fontFamily: "var(--font-mono, monospace)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
          alignItems: "center",
          cursor: log.nodeId ? "pointer" : "default",
          background: isError
            ? "rgba(239, 68, 68, 0.08)"
            : isWarn
            ? "rgba(245, 158, 11, 0.08)"
            : "transparent",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => {
          if (!isError && !isWarn) e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
        }}
        onMouseLeave={(e) => {
          if (!isError && !isWarn) e.currentTarget.style.background = "transparent";
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
        <span>
          <span
            className={`log-level-${log.level.toLowerCase()}`}
            style={{
              padding: "1px 5px",
              borderRadius: 3,
              fontSize: "0.65rem",
              fontWeight: 600,
            }}
          >
            {log.level}
          </span>
        </span>
        <span
          style={{
            color: "var(--accent-purple)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={log.cellName || log.cellId}
        >
          {log.cellName || log.cellId || "--"}
        </span>
        <span
          style={{
            color: log.nodeId ? "var(--accent-cyan)" : "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title={log.nodeLabel || log.nodeId}
        >
          {log.nodeLabel || log.nodeId || "--"}
          {log.nodeId && <ExternalLink size={10} style={{ opacity: 0.6 }} />}
        </span>
        <span style={{ color: "var(--text-primary)", wordBreak: "break-word" }}>
          {log.message}
        </span>
      </div>
    );
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isFullScreen ? 0 : 20,
      }}
    >
      <div
        ref={containerRef}
        className="log-viewer-modal"
        style={{
          width: isFullScreen ? "100vw" : "90vw",
          height: isFullScreen ? "100vh" : "86vh",
          maxWidth: isFullScreen ? "100%" : 1400,
          background: "#090d16",
          border: isFullScreen ? "none" : "1px solid #1e293b",
          borderRadius: isFullScreen ? 0 : 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.8)",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "12px 18px",
            background: "#0f172a",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Terminal size={18} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: "0.95rem", color: "#f8fafc", fontWeight: 600 }}>
              Janela Geral de Logs da Sessão
            </h3>
            <span
              style={{
                fontSize: "0.72rem",
                background: "rgba(56, 189, 248, 0.15)",
                color: "#38bdf8",
                padding: "2px 8px",
                borderRadius: 12,
              }}
            >
              {logs.length} entradas
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Toggle Fullscreen */}
            <button
              type="button"
              className="icon-btn"
              onClick={() => setIsFullScreen((v) => !v)}
              title={isFullScreen ? "Restaurar tamanho" : "Maximizar tela cheia"}
            >
              {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            {/* Close */}
            <button type="button" className="icon-btn danger" onClick={onClose} title="Fechar">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Toolbar de Filtros e Ações */}
        <div
          style={{
            padding: "8px 16px",
            background: "rgba(15, 23, 42, 0.6)",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Level Filter */}
            <select
              value={levelFilter}
              onChange={(e) => setLogLevelFilter(e.target.value)}
              className="form-select"
              style={{
                fontSize: "0.72rem",
                padding: "3px 8px",
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#f8fafc",
                borderRadius: 4,
              }}
            >
              <option value="ALL">Nível: TODOS</option>
              <option value="ERROR">Apenas ERROS (ERROR)</option>
              <option value="WARN">Avisos (WARN)</option>
              <option value="INFO">Informativos (INFO)</option>
              <option value="DEBUG">Diagnóstico (DEBUG)</option>
            </select>

            {/* Cell Filter */}
            <select
              value={cellFilter}
              onChange={(e) => setCellFilter(e.target.value)}
              className="form-select"
              style={{
                fontSize: "0.72rem",
                padding: "3px 8px",
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#f8fafc",
                borderRadius: 4,
                maxWidth: 180,
              }}
            >
              <option value="ALL">Célula: TODAS</option>
              {distinctCells.map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Search Input */}
            <div style={{ position: "relative", minWidth: 200 }}>
              <Search
                size={13}
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#64748b",
                }}
              />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Filtrar por mensagem ou componente..."
                style={{
                  padding: "4px 8px 4px 26px",
                  fontSize: "0.72rem",
                  background: "#1e293b",
                  border: "1px solid #334155",
                  color: "#f8fafc",
                  borderRadius: 4,
                  width: "100%",
                }}
              />
              {searchText && (
                <X
                  size={12}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                    cursor: "pointer",
                  }}
                  onClick={() => setSearchText("")}
                />
              )}
            </div>

            {/* Group By Cell Toggle */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "0.72rem",
                color: "#94a3b8",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={groupByCell}
                onChange={(e) => setGroupByCell(e.target.checked)}
              />
              <span>Agrupar por Célula</span>
            </label>

            {/* Auto-scroll Toggle */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "0.72rem",
                color: "#94a3b8",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <span>Rolar Automático</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Copy Logs */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCopyLogs}
              style={{ fontSize: "0.7rem", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
              title="Copiar logs visíveis para a área de transferência"
            >
              {copiedFeedback ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
              <span>{copiedFeedback ? "Copiado!" : "Copiar"}</span>
            </button>

            {/* Export .log */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleDownload("log")}
              style={{ fontSize: "0.7rem", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
              title="Exportar logs como arquivo de texto (.log)"
            >
              <Download size={12} />
              <span>Exportar .log</span>
            </button>

            {/* Export .json */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleDownload("json")}
              style={{ fontSize: "0.7rem", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
              title="Exportar logs como JSON estruturado (.json)"
            >
              <Download size={12} />
              <span>JSON</span>
            </button>

            {/* Clear Logs */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClear}
              style={{
                fontSize: "0.7rem",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: "var(--status-danger)",
              }}
              title="Limpar todos os logs"
            >
              <Trash2 size={12} />
              <span>Limpar</span>
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "85px 65px 160px 160px 1fr",
            gap: 8,
            padding: "8px 12px",
            background: "#0b0f19",
            borderBottom: "1px solid #1e293b",
            fontSize: "0.68rem",
            fontWeight: 600,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          <span>Hora</span>
          <span>Nível</span>
          <span>Célula</span>
          <span>Componente</span>
          <span>Mensagem</span>
        </div>

        {/* Table Body / Rows */}
        <div
          ref={logRowsRef}
          style={{
            flex: 1,
            overflowY: "auto",
            background: "#070a12",
          }}
        >
          {logs.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#64748b",
                fontSize: "0.82rem",
              }}
            >
              Nenhum log corresponde aos filtros informados.
            </div>
          ) : groupByCell && groupedLogs ? (
            Object.entries(groupedLogs).map(([cellName, cellItems]: [string, ExecutionLogItem[]]) => (
              <div key={cellName} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    padding: "6px 14px",
                    background: "rgba(99, 102, 241, 0.12)",
                    borderLeft: "3px solid var(--accent-purple)",
                    color: "#c7d2fe",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}
                >
                  {cellName} ({cellItems.length} entradas)
                </div>
                {cellItems.map(renderLogRow)}
              </div>
            ))
          ) : (
            logs.map(renderLogRow)
          )}
        </div>
      </div>
    </div>
  );
};
