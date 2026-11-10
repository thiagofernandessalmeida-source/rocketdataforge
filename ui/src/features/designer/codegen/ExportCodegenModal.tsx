import React, { useState, useEffect } from "react";
import {
  X,
  Code,
  Download,
  Copy,
  Check,
  Loader2,
  FileText,
  Terminal,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Layers,
  Box,
} from "lucide-react";
import { api } from "../../../api/client";
import {
  StandaloneCodeResult,
  AirflowDagResult,
  AirflowExportOptions
} from "../../../types";

interface ExportCodegenModalProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
  pipelineName?: string;
  draftDefinition?: any;
  jobDefinition?: any;
  jobName?: string;
  initialScope?: "cell" | "job";
}

export const ExportCodegenModal: React.FC<ExportCodegenModalProps> = ({
  isOpen,
  onClose,
  pipelineId,
  pipelineName = "Pipeline Atual",
  draftDefinition,
  jobDefinition,
  jobName = "Job Completo",
  initialScope = "cell",
}) => {
  const [exportScope, setExportScope] = useState<"cell" | "job">(
    initialScope || (jobDefinition ? "job" : "cell")
  );
  const [activeTab, setActiveTab] = useState<"standalone" | "airflow">("standalone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resultados
  const [standaloneResult, setStandaloneResult] = useState<StandaloneCodeResult | null>(null);
  const [airflowResult, setAirflowResult] = useState<AirflowDagResult | null>(null);

  // Sub-aba de Standalone: script | requirements | env
  const [standaloneSubTab, setStandaloneSubTab] = useState<"script" | "requirements" | "env">("script");

  // Opções Airflow
  const [airflowOptions, setAirflowOptions] = useState<AirflowExportOptions>({
    dag_id: `${(initialScope === "job" ? jobName : pipelineName).toLowerCase().replace(/[^a-z0-9_]/g, "_")}_dag`,
    schedule_interval: "0 2 * * *",
    start_date: "2026-01-01",
    owner: "data_engineering",
    retries: 1,
    retry_delay_minutes: 5,
    catchup: false,
    tags: ["rocketdataforge", "autonomous"],
  });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      if (initialScope) {
        setExportScope(initialScope);
      } else if (jobDefinition && !draftDefinition) {
        setExportScope("job");
      }
      setStandaloneResult(null);
      setAirflowResult(null);
    }
  }, [isOpen, initialScope, jobDefinition, draftDefinition]);

  useEffect(() => {
    const baseName = exportScope === "job" ? (jobName || "job") : (pipelineName || "pipeline");
    const safeName = baseName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    setAirflowOptions((prev) => ({
      ...prev,
      dag_id: `${safeName}_${exportScope === "job" ? "job" : "cell"}_dag`,
      tags: ["rocketdataforge", exportScope === "job" ? "multi_cell_job" : "cell_pipeline"],
    }));
  }, [exportScope, jobName, pipelineName]);

  const fetchStandalone = async (scopeToUse = exportScope) => {
    setLoading(true);
    setError(null);
    try {
      const activeDef = scopeToUse === "job" ? (jobDefinition || draftDefinition) : draftDefinition;
      const res = await api.exportStandaloneCode(pipelineId, activeDef, scopeToUse);
      setStandaloneResult(res);
    } catch (err: any) {
      setError(err.message || "Falha ao gerar código autônomo.");
    } finally {
      setLoading(false);
    }
  };

  const fetchAirflow = async (scopeToUse = exportScope) => {
    setLoading(true);
    setError(null);
    try {
      const activeDef = scopeToUse === "job" ? (jobDefinition || draftDefinition) : draftDefinition;
      const res = await api.exportAirflowDag(pipelineId, airflowOptions, activeDef, scopeToUse);
      setAirflowResult(res);
    } catch (err: any) {
      setError(err.message || "Falha ao gerar DAG do Airflow.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (activeTab === "standalone") {
        fetchStandalone(exportScope);
      } else if (activeTab === "airflow") {
        fetchAirflow(exportScope);
      }
    }
  }, [isOpen, activeTab, exportScope]);

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownload = (content: string, filename: string, mime = "text/plain") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStandaloneDownloadFilename = () => {
    const base = exportScope === "job" ? (jobName || "job") : (pipelineName || "pipeline");
    const safe = base.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (standaloneSubTab === "script") {
      return `${safe}_${exportScope === "job" ? "job" : "cell"}_standalone.py`;
    }
    if (standaloneSubTab === "requirements") {
      return "requirements.txt";
    }
    return ".env.example";
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(10, 15, 29, 0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="modal-content export-codegen-modal"
        style={{
          background: "#0f172a",
          border: "1px solid rgba(99, 102, 241, 0.35)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 960,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.8)",
          overflow: "hidden",
        }}
      >
        {/* Cabeçalho */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "rgba(99, 102, 241, 0.15)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#818cf8",
              }}
            >
              <Code size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "#f8fafc" }}>
                  Exportar como Código Autônomo
                </h2>
                <span
                  style={{
                    background: "rgba(16, 185, 129, 0.15)",
                    color: "#34d399",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <ShieldCheck size={12} />
                  Zero Plaintext Secrets
                </span>
              </div>
              <p style={{ margin: "2px 0 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                Execute seu pipeline fora do RocketDataForge em Python puro ou Apache Airflow.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 6,
              borderRadius: 8,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* ─── Seletor de Escopo: Célula Ativa vs Job Inteiro ─── */}
        <div
          style={{
            padding: "10px 24px",
            background: "rgba(30, 41, 59, 0.4)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: "0.76rem",
                fontWeight: 600,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Escopo:
            </span>
            <div
              style={{
                display: "inline-flex",
                background: "rgba(15, 23, 42, 0.8)",
                borderRadius: 8,
                padding: 3,
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <button
                type="button"
                id="btn-scope-cell"
                onClick={() => setExportScope("cell")}
                style={{
                  padding: "5px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: exportScope === "cell" ? "#6366f1" : "transparent",
                  color: exportScope === "cell" ? "#ffffff" : "#94a3b8",
                  fontSize: "0.78rem",
                  fontWeight: exportScope === "cell" ? 600 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.2s ease",
                }}
              >
                <Box size={13} />
                <span>Célula Ativa ({pipelineName})</span>
              </button>

              <button
                type="button"
                id="btn-scope-job"
                onClick={() => setExportScope("job")}
                style={{
                  padding: "5px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: exportScope === "job" ? "#6366f1" : "transparent",
                  color: exportScope === "job" ? "#ffffff" : "#94a3b8",
                  fontSize: "0.78rem",
                  fontWeight: exportScope === "job" ? 600 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.2s ease",
                }}
              >
                <Layers size={13} />
                <span>Job Inteiro ({jobName || "Todas as Células"})</span>
              </button>
            </div>
          </div>

          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
            {exportScope === "job"
              ? "Orquestra todas as etapas (Canvas + Python) com DuckDB e pré-condições"
              : "Gera o código executável apenas para o fluxo da célula ativa"}
          </span>
        </div>

        {/* Abas Principais */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "0 24px",
            background: "rgba(15, 23, 42, 0.5)",
            gap: 24,
          }}
        >
          <button
            onClick={() => setActiveTab("standalone")}
            className="tab-btn-standalone"
            style={{
              padding: "12px 4px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "standalone" ? "2px solid #818cf8" : "2px solid transparent",
              color: activeTab === "standalone" ? "#f8fafc" : "#94a3b8",
              fontWeight: 500,
              fontSize: "0.9rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Terminal size={16} color={activeTab === "standalone" ? "#818cf8" : "#94a3b8"} />
            <span>Python Autônomo (DuckDB / Polars)</span>
          </button>
          <button
            onClick={() => setActiveTab("airflow")}
            className="tab-btn-airflow"
            style={{
              padding: "12px 4px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "airflow" ? "2px solid #818cf8" : "2px solid transparent",
              color: activeTab === "airflow" ? "#f8fafc" : "#94a3b8",
              fontWeight: 500,
              fontSize: "0.9rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Share2 size={16} color={activeTab === "airflow" ? "#818cf8" : "#94a3b8"} />
            <span>Apache Airflow DAG</span>
          </button>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {error && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                color: "#fca5a5",
                fontSize: "0.85rem",
              }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 60,
                color: "#94a3b8",
                gap: 12,
              }}
            >
              <Loader2 size={32} className="animate-spin" color="#818cf8" />
              <span>Gerando código autônomo otimizado...</span>
            </div>
          ) : activeTab === "standalone" ? (
            <div>
              {/* Sub-abas de arquivos gerados */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setStandaloneSubTab("script")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: standaloneSubTab === "script" ? "#6366f1" : "rgba(255, 255, 255, 0.1)",
                      background: standaloneSubTab === "script" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                      color: standaloneSubTab === "script" ? "#e0e7ff" : "#94a3b8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Code size={14} />
                    <span>pipeline_job.py</span>
                  </button>
                  <button
                    onClick={() => setStandaloneSubTab("requirements")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: standaloneSubTab === "requirements" ? "#6366f1" : "rgba(255, 255, 255, 0.1)",
                      background: standaloneSubTab === "requirements" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                      color: standaloneSubTab === "requirements" ? "#e0e7ff" : "#94a3b8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <FileText size={14} />
                    <span>requirements.txt</span>
                  </button>
                  <button
                    onClick={() => setStandaloneSubTab("env")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: standaloneSubTab === "env" ? "#6366f1" : "rgba(255, 255, 255, 0.1)",
                      background: standaloneSubTab === "env" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                      color: standaloneSubTab === "env" ? "#e0e7ff" : "#94a3b8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Settings size={14} />
                    <span>.env.example</span>
                  </button>
                </div>

                {/* Ações de cópia e download */}
                {standaloneResult && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => {
                        const content =
                          standaloneSubTab === "script"
                            ? standaloneResult.script_py
                            : standaloneSubTab === "requirements"
                            ? standaloneResult.requirements_txt
                            : standaloneResult.env_example;
                        handleCopy(content, standaloneSubTab);
                      }}
                      className="btn-copy-code"
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        background: "rgba(255, 255, 255, 0.05)",
                        color: "#f8fafc",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {copiedKey === standaloneSubTab ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      <span>{copiedKey === standaloneSubTab ? "Copiado!" : "Copiar"}</span>
                    </button>
                    <button
                      onClick={() => {
                        const content =
                          standaloneSubTab === "script"
                            ? standaloneResult.script_py
                            : standaloneSubTab === "requirements"
                            ? standaloneResult.requirements_txt
                            : standaloneResult.env_example;
                        handleDownload(content, getStandaloneDownloadFilename());
                      }}
                      className="btn-download-code"
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "none",
                        background: "#6366f1",
                        color: "#ffffff",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Download size={14} />
                      <span>Baixar Arquivo</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Caixa de Código */}
              {standaloneResult && (
                <pre
                  className="code-preview-block"
                  style={{
                    margin: 0,
                    padding: 16,
                    background: "#030712",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                    color: "#f1f5f9",
                    fontFamily: "Consolas, Menlo, Monaco, monospace",
                    maxHeight: 460,
                    overflow: "auto",
                    whiteSpace: "pre",
                    lineHeight: 1.5,
                  }}
                >
                  {standaloneSubTab === "script"
                    ? standaloneResult.script_py
                    : standaloneSubTab === "requirements"
                    ? standaloneResult.requirements_txt
                    : standaloneResult.env_example}
                </pre>
              )}
            </div>
          ) : (
            <div>
              {/* Painel de Configurações da DAG */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  marginBottom: 16,
                  background: "rgba(15, 23, 42, 0.6)",
                  padding: 14,
                  borderRadius: 8,
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: 4 }}>
                    DAG ID
                  </label>
                  <input
                    type="text"
                    value={airflowOptions.dag_id || ""}
                    onChange={(e) => setAirflowOptions({ ...airflowOptions, dag_id: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "#030712",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: 6,
                      color: "#f8fafc",
                      fontSize: "0.8rem",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: 4 }}>
                    Schedule Interval (Cron)
                  </label>
                  <input
                    type="text"
                    value={airflowOptions.schedule_interval || ""}
                    onChange={(e) => setAirflowOptions({ ...airflowOptions, schedule_interval: e.target.value })}
                    placeholder="0 2 * * *"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "#030712",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: 6,
                      color: "#f8fafc",
                      fontSize: "0.8rem",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: 4 }}>
                    Owner
                  </label>
                  <input
                    type="text"
                    value={airflowOptions.owner || ""}
                    onChange={(e) => setAirflowOptions({ ...airflowOptions, owner: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "#030712",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: 6,
                      color: "#f8fafc",
                      fontSize: "0.8rem",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <button
                  onClick={() => fetchAirflow(exportScope)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid #6366f1",
                    background: "rgba(99, 102, 241, 0.15)",
                    color: "#a5b4fc",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={14} />
                  <span>Regenerar com Opções</span>
                </button>

                {airflowResult && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleCopy(airflowResult.dag_py, "dag")}
                      className="btn-copy-dag"
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        background: "rgba(255, 255, 255, 0.05)",
                        color: "#f8fafc",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {copiedKey === "dag" ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      <span>{copiedKey === "dag" ? "Copiado!" : "Copiar"}</span>
                    </button>
                    <button
                      onClick={() => handleDownload(airflowResult.dag_py, `${airflowResult.dag_id}.py`)}
                      className="btn-download-dag"
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "none",
                        background: "#6366f1",
                        color: "#ffffff",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Download size={14} />
                      <span>Baixar DAG (.py)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Caixa de Código da DAG */}
              {airflowResult && (
                <pre
                  className="code-preview-block"
                  style={{
                    margin: 0,
                    padding: 16,
                    background: "#030712",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                    color: "#f1f5f9",
                    fontFamily: "Consolas, Menlo, Monaco, monospace",
                    maxHeight: 400,
                    overflow: "auto",
                    whiteSpace: "pre",
                    lineHeight: 1.5,
                  }}
                >
                  {airflowResult.dag_py}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
