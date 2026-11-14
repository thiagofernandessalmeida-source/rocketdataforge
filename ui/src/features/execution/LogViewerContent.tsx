import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
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
  Maximize2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import {
  executionLogStore,
  ExecutionLogItem,
  LogFilterOptions,
} from "../../store/executionLogStore";

export interface LogViewerContentProps {
  onFocusNode?: (nodeId: string, cellId?: string) => void;
  compact?: boolean;
  onExpandPopOut?: () => void;
  isDetached?: boolean;
  onReattach?: () => void;
  onFocusDetached?: () => void;
}

type VirtualItem =
  | { type: "header"; id: string; cellName: string; count: number; height: number }
  | { type: "log"; id: string; log: ExecutionLogItem; height: number };

export const LogViewerContent: React.FC<LogViewerContentProps> = ({
  onFocusNode,
  compact: manualCompact,
  onExpandPopOut,
  isDetached = false,
  onReattach,
  onFocusDetached,
}) => {
  const [levelFilter, setLogLevelFilter] = useState<string>("ALL");
  const [cellFilter, setCellFilter] = useState<string>("ALL");
  const [searchText, setSearchText] = useState<string>("");
  const [groupByCell, setGroupByCell] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copiedFeedback, setCopiedFeedback] = useState<boolean>(false);
  const [version, setVersion] = useState<number>(0);

  // ResizeObserver states
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [containerHeight, setContainerHeight] = useState<number>(400);
  const [scrollTop, setScrollTop] = useState<number>(0);

  const isCompact = manualCompact !== undefined ? manualCompact : containerWidth < 520;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setContainerWidth(entry.contentRect.width);
          setContainerHeight(entry.contentRect.height);
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Montagem da lista virtualizada com alturas fixas
  const logRowHeight = isCompact ? 50 : 28;
  const headerRowHeight = 28;

  const virtualItems = useMemo<VirtualItem[]>(() => {
    if (logs.length === 0) return [];

    if (!groupByCell) {
      return logs.map((log) => ({
        type: "log",
        id: log.id,
        log,
        height: logRowHeight,
      }));
    }

    // Agrupado por célula
    const grouped = logs.reduce((acc: Record<string, ExecutionLogItem[]>, log: ExecutionLogItem) => {
      const key = log.cellName || log.cellId || "Geral / Sem Célula";
      if (!acc[key]) acc[key] = [];
      acc[key].push(log);
      return acc;
    }, {} as Record<string, ExecutionLogItem[]>);

    const items: VirtualItem[] = [];
    for (const [cellName, groupLogs] of Object.entries(grouped)) {
      items.push({
        type: "header",
        id: `hdr-${cellName}`,
        cellName,
        count: groupLogs.length,
        height: headerRowHeight,
      });
      for (const log of groupLogs) {
        items.push({
          type: "log",
          id: log.id,
          log,
          height: logRowHeight,
        });
      }
    }
    return items;
  }, [logs, groupByCell, logRowHeight, headerRowHeight]);

  // Pre-computação de offsets para busca binária O(log N)
  const { totalHeight, itemOffsets } = useMemo(() => {
    const offsets: number[] = new Array(virtualItems.length);
    let current = 0;
    for (let i = 0; i < virtualItems.length; i++) {
      offsets[i] = current;
      current += virtualItems[i].height;
    }
    return { totalHeight: current, itemOffsets: offsets };
  }, [virtualItems]);

  // Cálculo da janela visível (Virtual Window)
  const overscan = 6;
  const { startIndex, endIndex, topOffset } = useMemo(() => {
    if (virtualItems.length === 0) {
      return { startIndex: 0, endIndex: 0, topOffset: 0 };
    }

    // Busca binária para startIndex
    let low = 0;
    let high = virtualItems.length - 1;
    let foundIndex = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (itemOffsets[mid] <= scrollTop) {
        foundIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const start = Math.max(0, foundIndex - overscan);

    // Encontra endIndex
    let end = start;
    const viewBottom = scrollTop + containerHeight;
    while (end < virtualItems.length && itemOffsets[end] < viewBottom) {
      end++;
    }
    end = Math.min(virtualItems.length, end + overscan);

    return {
      startIndex: start,
      endIndex: end,
      topOffset: itemOffsets[start] || 0,
    };
  }, [virtualItems, itemOffsets, scrollTop, containerHeight, overscan]);

  const visibleItems = useMemo(() => {
    return virtualItems.slice(startIndex, endIndex);
  }, [virtualItems, startIndex, endIndex]);

  // Rolagem automática
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [virtualItems, autoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

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

  // Renderização de cada linha de log
  const renderLogRow = (log: ExecutionLogItem) => {
    const lvlUpper = log.level.toUpperCase();
    const isError = lvlUpper === "ERROR";
    const isWarn = lvlUpper === "WARN";
    const isDebug = lvlUpper === "DEBUG";

    if (isCompact) {
      // ─── Layout Compacto (< 520px) em 2 linhas ───
      return (
        <div
          key={log.id}
          className={`log-table-row compact-row ${isError ? "row-error" : isWarn ? "row-warn" : isDebug ? "row-debug" : ""}`}
          onClick={() => {
            if (log.nodeId) onFocusNode?.(log.nodeId, log.cellId);
          }}
          style={{
            height: logRowHeight,
            padding: "4px 8px",
            fontSize: "0.72rem",
            fontFamily: "var(--font-mono, monospace)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
            cursor: log.nodeId ? "pointer" : "default",
            background: isError
              ? "rgba(239, 68, 68, 0.08)"
              : isWarn
              ? "rgba(245, 158, 11, 0.08)"
              : "transparent",
            boxSizing: "border-box",
          }}
        >
          {/* Linha 1: Metadados */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.68rem" }}>
            <span style={{ color: "var(--text-muted)" }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={`log-level-${log.level.toLowerCase()}`}
              style={{
                padding: "0 4px",
                borderRadius: 3,
                fontSize: "0.62rem",
                fontWeight: 600,
              }}
            >
              {log.level}
            </span>
            {log.cellName && (
              <span
                style={{
                  color: "var(--accent-purple)",
                  maxWidth: 90,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={log.cellName}
              >
                [{log.cellName}]
              </span>
            )}
            {log.nodeLabel && (
              <span
                style={{
                  color: "var(--accent-cyan)",
                  maxWidth: 110,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
                title={log.nodeLabel}
              >
                {log.nodeLabel}
                {log.nodeId && <ExternalLink size={9} style={{ opacity: 0.7 }} />}
              </span>
            )}
          </div>
          {/* Linha 2: Mensagem */}
          <div
            style={{
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.72rem",
            }}
            title={log.message}
          >
            {log.message}
          </div>
        </div>
      );
    }

    // ─── Layout Amplo (>= 520px) em Grid 5 colunas ───
    return (
      <div
        key={log.id}
        className={`log-table-row ${isError ? "row-error" : isWarn ? "row-warn" : isDebug ? "row-debug" : ""}`}
        onClick={() => {
          if (log.nodeId) onFocusNode?.(log.nodeId, log.cellId);
        }}
        style={{
          height: logRowHeight,
          display: "grid",
          gridTemplateColumns: "85px 65px 140px 150px 1fr",
          gap: 8,
          padding: "0 12px",
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
          boxSizing: "border-box",
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
        <span
          style={{
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={log.message}
        >
          {log.message}
        </span>
      </div>
    );
  };

  // Se a janela estiver desacoplada no Electron (Fase 3)
  if (isDetached) {
    return (
      <div
        ref={rootRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
          height: "100%",
        }}
      >
        <Terminal size={36} color="var(--accent-cyan)" style={{ marginBottom: 12, opacity: 0.8 }} />
        <h4 style={{ margin: "0 0 6px 0", color: "#f8fafc", fontSize: "0.9rem" }}>
          Log em Janela Separada
        </h4>
        <p style={{ margin: "0 0 16px 0", fontSize: "0.75rem", maxWidth: 260, lineHeight: 1.4 }}>
          A visualização geral de logs está aberta em uma janela nativa independente.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {onFocusDetached && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onFocusDetached}
              style={{ fontSize: "0.74rem", padding: "5px 10px" }}
            >
              Focar Janela
            </button>
          )}
          {onReattach && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onReattach}
              style={{ fontSize: "0.74rem", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5 }}
            >
              <ArrowDownLeft size={13} />
              <span>Trazer para cá</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="log-viewer-content"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
        background: "#070a12",
        overflow: "hidden",
      }}
    >
      {/* ─── Toolbar de Controles e Filtros ─── */}
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(15, 23, 42, 0.7)",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 200 }}>
          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLogLevelFilter(e.target.value)}
            className="form-select"
            style={{
              fontSize: "0.7rem",
              padding: "2px 6px",
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
              fontSize: "0.7rem",
              padding: "2px 6px",
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#f8fafc",
              borderRadius: 4,
              maxWidth: 130,
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
          <div style={{ position: "relative", minWidth: 120, flex: 1, maxWidth: 220 }}>
            <Search
              size={12}
              style={{
                position: "absolute",
                left: 6,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#64748b",
              }}
            />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar..."
              style={{
                padding: "3px 6px 3px 22px",
                fontSize: "0.7rem",
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#f8fafc",
                borderRadius: 4,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Auto-scroll Toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.68rem",
              color: "#94a3b8",
              cursor: "pointer",
            }}
            title="Rolar automaticamente para a linha mais recente"
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Popout / Expand */}
          {onExpandPopOut && (
            <button
              type="button"
              className="icon-btn"
              onClick={onExpandPopOut}
              style={{ padding: 4 }}
              title="Destacar janela de logs"
            >
              <ArrowUpRight size={13} color="var(--accent-cyan)" />
            </button>
          )}

          {/* Copy Logs */}
          <button
            type="button"
            className="icon-btn"
            onClick={handleCopyLogs}
            style={{ padding: 4 }}
            title="Copiar logs visíveis"
          >
            {copiedFeedback ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
          </button>

          {/* Export .log */}
          <button
            type="button"
            className="icon-btn"
            onClick={() => handleDownload("log")}
            style={{ padding: 4 }}
            title="Exportar .log"
          >
            <Download size={12} />
          </button>

          {/* Clear Logs */}
          <button
            type="button"
            className="icon-btn danger"
            onClick={handleClear}
            style={{ padding: 4 }}
            title="Limpar logs"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ─── Cabeçalho de Colunas (apenas em modo Amplo) ─── */}
      {!isCompact && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "85px 65px 140px 150px 1fr",
            gap: 8,
            padding: "6px 12px",
            background: "#0b0f19",
            borderBottom: "1px solid #1e293b",
            fontSize: "0.66rem",
            fontWeight: 600,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            flexShrink: 0,
          }}
        >
          <span>Hora</span>
          <span>Nível</span>
          <span>Célula</span>
          <span>Componente</span>
          <span>Mensagem</span>
        </div>
      )}

      {/* ─── Contêiner Virtualizado com Scroll ─── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background: "#070a12",
          position: "relative",
        }}
      >
        {logs.length === 0 ? (
          <div
            style={{
              padding: 30,
              textAlign: "center",
              color: "#64748b",
              fontSize: "0.78rem",
            }}
          >
            Nenhum log corresponde aos filtros informados.
          </div>
        ) : (
          <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${topOffset}px)`,
              }}
            >
              {visibleItems.map((item) => {
                if (item.type === "header") {
                  return (
                    <div
                      key={item.id}
                      style={{
                        height: headerRowHeight,
                        padding: "4px 10px",
                        background: "rgba(99, 102, 241, 0.12)",
                        borderLeft: "3px solid var(--accent-purple)",
                        color: "#c7d2fe",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        boxSizing: "border-box",
                      }}
                    >
                      {item.cellName} ({item.count} entradas)
                    </div>
                  );
                }
                return renderLogRow(item.log);
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

