import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Play,
  RotateCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  Database,
  Download,
  Copy,
  Check,
  AlertCircle,
  Table as TableIcon,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { NodePreviewData } from "../../../types";
import { api } from "../../../api/client";

export interface DataPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  executionId?: string | null;
  nodeId?: string | null;
  nodeLabel?: string | null;
  pipelineId?: string | null;
  onRunToNode?: (nodeId: string) => void;
  isExecuting?: boolean;
}

export const DataPreviewDrawer: React.FC<DataPreviewDrawerProps> = ({
  isOpen,
  onClose,
  executionId,
  nodeId,
  nodeLabel,
  pipelineId,
  onRunToNode,
  isExecuting = false,
}) => {
  const [data, setData] = useState<NodePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros e Paginação
  const [selectedPort, setSelectedPort] = useState<string>("main");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Carrega preview
  const fetchPreview = useCallback(async () => {
    if (!executionId || !nodeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getNodePreview(executionId, nodeId, {
        port: selectedPort,
        page,
        page_size: pageSize,
        search: searchTerm.trim() || undefined,
        sort_by: sortBy || undefined,
        sort_desc: sortDesc,
      });
      setData(res);
      if (res.port && res.port !== selectedPort) {
        setSelectedPort(res.port);
      }
    } catch (err: any) {
      setError(err?.message || "Não foi possível carregar a prévia de dados.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [executionId, nodeId, selectedPort, page, pageSize, searchTerm, sortBy, sortDesc]);

  useEffect(() => {
    if (isOpen && executionId && nodeId) {
      fetchPreview();
    }
  }, [isOpen, executionId, nodeId, fetchPreview]);

  // Resetar página ao buscar ou mudar de porta
  const handlePortChange = (port: string) => {
    setSelectedPort(port);
    setPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setPage(1);
  };

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      if (!sortDesc) {
        setSortDesc(true);
      } else {
        setSortBy(null);
        setSortDesc(false);
      }
    } else {
      setSortBy(colName);
      setSortDesc(false);
    }
    setPage(1);
  };

  const handleCopyTsv = () => {
    if (!data || !data.rows || data.rows.length === 0) return;
    const cols = data.columns;
    const header = cols.join("\t");
    const rows = data.rows.map((r) =>
      cols.map((c) => (r[c] !== null && r[c] !== undefined ? String(r[c]) : "")).join("\t")
    );
    const text = [header, ...rows].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const totalPages = data?.total_pages || 1;
  const totalRows = data?.total_rows || 0;
  const availablePorts = data?.available_ports && data.available_ports.length > 0
    ? data.available_ports
    : ["main"];

  return (
    <div
      className={`rdf-preview-drawer ${isExpanded ? "expanded" : ""}`}
      id="rdf-preview-drawer"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: isExpanded ? "85vh" : "380px",
        background: "rgba(15, 23, 42, 0.97)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(56, 189, 248, 0.25)",
        boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.5)",
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        transition: "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* ─── Drawer Header ───────────────────────── */}
      <div
        className="rdf-preview-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 18px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(30, 41, 59, 0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#38bdf8",
              fontWeight: 600,
              fontSize: "0.95rem",
            }}
          >
            <TableIcon size={18} />
            <span>Live Data Preview:</span>
            <span style={{ color: "#f8fafc", fontWeight: 700 }}>
              {nodeLabel || nodeId || "Componente"}
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(56, 189, 248, 0.15)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.3)",
              }}
            >
              ID: {nodeId}
            </span>
          </div>

          {/* Botão de Executar até este nó */}
          {nodeId && onRunToNode && (
            <button
              id="btn-run-to-this-node"
              className="btn btn-xs"
              onClick={() => onRunToNode(nodeId)}
              disabled={isExecuting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: isExecuting ? "not-allowed" : "pointer",
                boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
              }}
              title="Executar parcialmente todos os nós a montante até este componente"
            >
              <Play size={12} fill="#ffffff" />
              <span>{isExecuting ? "Executando..." : "Executar até este nó"}</span>
            </button>
          )}
        </div>

        {/* Controles de Ações do Drawer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="icon-btn btn-xs"
            onClick={fetchPreview}
            disabled={loading}
            title="Atualizar dados"
            style={{ color: "#94a3b8" }}
          >
            <RotateCw size={14} className={loading ? "rdf-telemetry-spin" : ""} />
          </button>

          <button
            className="icon-btn btn-xs"
            onClick={handleCopyTsv}
            disabled={!data || data.rows.length === 0}
            title="Copiar dados como TSV"
            style={{ color: copied ? "#22c55e" : "#94a3b8" }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          <button
            className="icon-btn btn-xs"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Restaurar tamanho" : "Maximizar"}
            style={{ color: "#94a3b8" }}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            className="icon-btn btn-xs"
            onClick={onClose}
            title="Fechar gaveta de prévia"
            style={{ color: "#94a3b8" }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ─── Drawer Toolbar (Portas, Busca e Paginação) ─────────── */}
      <div
        className="rdf-preview-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 18px",
          background: "rgba(15, 23, 42, 0.4)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* Seletor de Portas (Tabs) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Porta:</span>
          <div style={{ display: "flex", background: "rgba(30, 41, 59, 0.8)", borderRadius: 6, padding: 2 }}>
            {availablePorts.map((port) => {
              const isActive = selectedPort === port;
              return (
                <button
                  key={port}
                  className={`btn-port-tab ${isActive ? "active" : ""}`}
                  onClick={() => handlePortChange(port)}
                  style={{
                    border: "none",
                    background: isActive ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: isActive ? "#38bdf8" : "#94a3b8",
                    fontWeight: isActive ? 600 : 500,
                    fontSize: "0.75rem",
                    padding: "3px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {port}
                </button>
              );
            })}
          </div>
        </div>

        {/* Barra de Pesquisa Rápida */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 360 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(30, 41, 59, 0.7)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 6,
              padding: "4px 10px",
              width: "100%",
            }}
          >
            <Search size={14} color="#64748b" />
            <input
              type="text"
              placeholder="Filtrar dados nesta porta..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#f8fafc",
                fontSize: "0.8rem",
                width: "100%",
              }}
            />
            {searchTerm && (
              <X
                size={12}
                color="#94a3b8"
                style={{ cursor: "pointer" }}
                onClick={() => handleSearchChange("")}
              />
            )}
          </div>
        </div>

        {/* Controles de Paginação */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "#94a3b8" }}>
            <span>Tamanho:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{
                background: "rgba(30, 41, 59, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#f8fafc",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: "0.75rem",
                outline: "none",
              }}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="icon-btn btn-xs"
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              title="Primeira página"
              style={{ color: page <= 1 ? "#475569" : "#94a3b8" }}
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="icon-btn btn-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              title="Página anterior"
              style={{ color: page <= 1 ? "#475569" : "#94a3b8" }}
            >
              <ChevronLeft size={14} />
            </button>

            <span style={{ fontSize: "0.75rem", color: "#cbd5e1", padding: "0 4px" }}>
              {page} / {totalPages}
            </span>

            <button
              className="icon-btn btn-xs"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              title="Próxima página"
              style={{ color: page >= totalPages ? "#475569" : "#94a3b8" }}
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="icon-btn btn-xs"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              title="Última página"
              style={{ color: page >= totalPages ? "#475569" : "#94a3b8" }}
            >
              <ChevronsRight size={14} />
            </button>
          </div>

          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
            Total: {totalRows.toLocaleString()} linhas
          </span>
        </div>
      </div>

      {/* ─── Drawer Content Table ─────────────────── */}
      <div
        className="rdf-preview-table-container"
        style={{
          flex: 1,
          overflow: "auto",
          background: "rgba(10, 15, 29, 0.9)",
          position: "relative",
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(15, 23, 42, 0.7)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              gap: 8,
              color: "#38bdf8",
              fontSize: "0.85rem",
            }}
          >
            <RotateCw size={18} className="rdf-telemetry-spin" />
            <span>Consultando DuckDB Cache...</span>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 40,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#f87171",
              textAlign: "center",
            }}
          >
            <AlertCircle size={28} />
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{error}</span>
            <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
              Execute o pipeline ou clique em "Executar até este nó" para gerar a prévia.
            </span>
          </div>
        )}

        {!error && (!data || data.rows.length === 0) && !loading && (
          <div
            style={{
              padding: 40,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#64748b",
              textAlign: "center",
            }}
          >
            <Database size={28} />
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Nenhum registro encontrado</span>
            <span style={{ fontSize: "0.8rem" }}>
              Nenhum dado retornado para os filtros atuais ou porta vazia.
            </span>
          </div>
        )}

        {!error && data && data.rows.length > 0 && (
          <table
            className="rdf-preview-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.78rem",
              textAlign: "left",
            }}
          >
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: "rgba(15, 23, 42, 0.95)",
                backdropFilter: "blur(8px)",
                zIndex: 2,
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}
            >
              <tr>
                <th
                  style={{
                    padding: "8px 12px",
                    color: "#64748b",
                    fontWeight: 600,
                    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                    width: 44,
                    textAlign: "center",
                  }}
                >
                  #
                </th>
                {data.columns.map((col) => {
                  const isSorted = sortBy === col;
                  return (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{
                        padding: "8px 12px",
                        color: isSorted ? "#38bdf8" : "#cbd5e1",
                        fontWeight: 600,
                        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                      title="Clique para ordenar"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{col}</span>
                        {isSorted ? (
                          sortDesc ? <ArrowDown size={12} /> : <ArrowUp size={12} />
                        ) : (
                          <ArrowUpDown size={11} color="#475569" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rIdx) => {
                const rowNumber = (page - 1) * pageSize + rIdx + 1;
                return (
                  <tr
                    key={rIdx}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      background: rIdx % 2 === 0 ? "transparent" : "rgba(255, 255, 255, 0.015)",
                    }}
                  >
                    <td
                      style={{
                        padding: "6px 12px",
                        color: "#475569",
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {rowNumber}
                    </td>
                    {data.columns.map((col) => {
                      const val = row[col];
                      const isNull = val === null || val === undefined;
                      return (
                        <td
                          key={col}
                          style={{
                            padding: "6px 12px",
                            color: isNull ? "#64748b" : "#f1f5f9",
                            fontStyle: isNull ? "italic" : "normal",
                            whiteSpace: "nowrap",
                            maxWidth: 300,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={String(val)}
                        >
                          {isNull ? "null" : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
