import React, { useState, useEffect, useCallback } from "react";
import {
  X, Clock, Play, Pause, Trash2, Plus, Calendar, AlertCircle,
  CheckCircle2, RefreshCw, Send, Bell, Shield, ChevronRight
} from "lucide-react";
import { api } from "../../../api/client";
import { ScheduleItem, ScheduleCreateData } from "../../../types";

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
  pipelineName?: string;
}

const CRON_PRESETS = [
  { label: "A cada 5 min", cron: "*/5 * * * *" },
  { label: "A cada hora", cron: "0 * * * *" },
  { label: "Diário às 00:00", cron: "0 0 * * *" },
  { label: "Diário às 08:00", cron: "0 8 * * *" },
  { label: "Seg a Sex às 06:00", cron: "0 6 * * 1-5" },
];

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  pipelineId,
  pipelineName = "Pipeline",
}) => {
  const [activeTab, setActiveTab] = useState<"list" | "create">("list");
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"cron" | "interval">("cron");
  const [cronExpression, setCronExpression] = useState("0 2 * * *");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [concurrencyPolicy, setConcurrencyPolicy] = useState<"SKIP_IF_RUNNING" | "ALLOW" | "QUEUE">("SKIP_IF_RUNNING");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifySuccess, setNotifySuccess] = useState(true);
  const [notifyFailure, setNotifyFailure] = useState(true);

  const fetchSchedules = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.listSchedules(pipelineId);
      setSchedules(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao carregar agendamentos.");
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    if (isOpen) {
      fetchSchedules();
      setActiveTab("list");
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, fetchSchedules]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("Informe um nome para o agendamento.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const events = [];
    if (notifySuccess) events.push("success");
    if (notifyFailure) events.push("failure");

    const payload: ScheduleCreateData = {
      pipeline_id: pipelineId,
      name: name.trim(),
      concurrency_policy: concurrencyPolicy,
      webhook_url: webhookUrl.trim() || undefined,
      webhook_events: events,
      ...(scheduleType === "cron" ? { cron_expression: cronExpression.trim() } : { interval_seconds: Number(intervalSeconds) }),
    };

    try {
      await api.createSchedule(payload);
      setSuccessMsg("Agendamento criado com sucesso!");
      setName("");
      setWebhookUrl("");
      setActiveTab("list");
      await fetchSchedules();
    } catch (err: any) {
      setErrorMsg(err.message || "Falha ao cadastrar agendamento.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      const res = await api.triggerSchedule(id);
      setSuccessMsg(`Disparo executado! Status: ${res.status}`);
      await fetchSchedules();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao disparar agendamento.");
    }
  };

  const handleTogglePause = async (schedule: ScheduleItem) => {
    try {
      if (schedule.enabled) {
        await api.pauseSchedule(schedule.id);
      } else {
        await api.resumeSchedule(schedule.id);
      }
      await fetchSchedules();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao alternar pausa do agendamento.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Deseja realmente excluir este agendamento?")) return;
    try {
      await api.deleteSchedule(id);
      await fetchSchedules();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao excluir agendamento.");
    }
  };

  return (
    <div className="rdf-modal-overlay" style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(10, 14, 26, 0.82)",
      backdropFilter: "blur(6px)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16
    }}>
      <div className="rdf-modal-container" style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 12,
        width: "100%",
        maxWidth: 720,
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Modal Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #1e293b",
          background: "#131d35"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(99, 102, 241, 0.15)",
              color: "#818cf8",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Clock size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "#f8fafc" }}>
                Agendamentos & Automação Cron
              </h3>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8" }}>
                Pipeline: <span style={{ color: "#38bdf8" }}>{pipelineName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer" }}
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid #1e293b",
          background: "#0b1329",
          padding: "0 20px"
        }}>
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "list" ? "2px solid #6366f1" : "2px solid transparent",
              color: activeTab === "list" ? "#818cf8" : "#94a3b8",
              fontWeight: 500,
              fontSize: "0.85rem",
              cursor: "pointer"
            }}
          >
            Agendamentos Ativos ({schedules.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("create")}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "create" ? "2px solid #6366f1" : "2px solid transparent",
              color: activeTab === "create" ? "#818cf8" : "#94a3b8",
              fontWeight: 500,
              fontSize: "0.85rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <Plus size={14} /> Novo Agendamento
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div style={{
            margin: "12px 20px 0",
            padding: "8px 12px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 6,
            color: "#fca5a5",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: 8
          }}>
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div style={{
            margin: "12px 20px 0",
            padding: "8px 12px",
            background: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            borderRadius: 6,
            color: "#86efac",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: 8
          }}>
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ padding: 20, maxHeight: 480, overflowY: "auto" }}>
          {activeTab === "list" ? (
            <div>
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8" }}>
                  <RefreshCw className="animate-spin" size={24} style={{ margin: "0 auto 8px" }} />
                  <p>Carregando agendamentos...</p>
                </div>
              ) : schedules.length === 0 ? (
                <div style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  background: "rgba(30, 41, 59, 0.3)",
                  borderRadius: 8,
                  border: "1px dashed #334155"
                }}>
                  <Calendar size={36} opacity={0.3} style={{ margin: "0 auto 8px" }} />
                  <p style={{ margin: "0 0 4px", color: "#f8fafc", fontWeight: 500 }}>
                    Nenhum agendamento configurado
                  </p>
                  <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: "0.8rem" }}>
                    Configure execuções recorrentes com expressões Cron ou intervalos fixos.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setActiveTab("create")}
                    style={{
                      background: "#4f46e5",
                      color: "#fff",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: 6,
                      fontSize: "0.85rem",
                      cursor: "pointer"
                    }}
                  >
                    <Plus size={14} style={{ marginRight: 6 }} /> Criar Agendamento
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {schedules.map((sched) => (
                    <div
                      key={sched.id}
                      className="schedule-card"
                      style={{
                        background: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, color: "#f8fafc", fontSize: "0.9rem" }}>
                            {sched.name}
                          </span>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            background: sched.enabled ? "rgba(34, 197, 94, 0.15)" : "rgba(148, 163, 184, 0.15)",
                            color: sched.enabled ? "#4ade80" : "#94a3b8"
                          }}>
                            {sched.enabled ? "ATIVO" : "PAUSADO"}
                          </span>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: "0.7rem",
                            background: "rgba(99, 102, 241, 0.15)",
                            color: "#a5b4fc"
                          }}>
                            {sched.concurrency_policy}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 14, fontSize: "0.78rem", color: "#94a3b8" }}>
                          <span>
                            Trigger: <strong style={{ color: "#38bdf8" }}>{sched.cron_expression || `${sched.interval_seconds}s`}</strong>
                          </span>
                          {sched.next_run_at && (
                            <span>
                              Próxima: <strong style={{ color: "#facc15" }}>{new Date(sched.next_run_at).toLocaleString()}</strong>
                            </span>
                          )}
                          {sched.last_status && (
                            <span>
                              Último: <strong style={{ color: sched.last_status === "succeeded" ? "#4ade80" : sched.last_status === "skipped" ? "#facc15" : "#f87171" }}>
                                {sched.last_status.toUpperCase()}
                              </strong>
                            </span>
                          )}
                        </div>
                        {sched.webhook_url && (
                          <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 4 }}>
                            Webhook: {sched.webhook_url}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className="btn-trigger"
                          onClick={() => handleTrigger(sched.id)}
                          title="Disparar Agora"
                          style={{
                            background: "rgba(56, 189, 248, 0.15)",
                            color: "#38bdf8",
                            border: "1px solid rgba(56, 189, 248, 0.3)",
                            borderRadius: 6,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: "0.78rem",
                            display: "flex",
                            alignItems: "center",
                            gap: 4
                          }}
                        >
                          <Play size={12} /> Executar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePause(sched)}
                          title={sched.enabled ? "Pausar" : "Retomar"}
                          style={{
                            background: "rgba(148, 163, 184, 0.15)",
                            color: "#cbd5e1",
                            border: "1px solid #475569",
                            borderRadius: 6,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: "0.78rem",
                            display: "flex",
                            alignItems: "center",
                            gap: 4
                          }}
                        >
                          {sched.enabled ? <Pause size={12} /> : <Play size={12} />}
                          {sched.enabled ? "Pausar" : "Retomar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(sched.id)}
                          title="Excluir"
                          style={{
                            background: "rgba(239, 68, 68, 0.15)",
                            color: "#f87171",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                            borderRadius: 6,
                            padding: 6,
                            cursor: "pointer"
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#cbd5e1", marginBottom: 4 }}>
                  Nome do Agendamento *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Carga Noturna Diária"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "8px 10px",
                    color: "#f8fafc",
                    fontSize: "0.85rem"
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "#cbd5e1", marginBottom: 4 }}>
                    Tipo de Frequência
                  </label>
                  <select
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "#f8fafc",
                      fontSize: "0.85rem"
                    }}
                  >
                    <option value="cron">Expressão Cron Padrão</option>
                    <option value="interval">Intervalo Fixo em Segundos</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "#cbd5e1", marginBottom: 4 }}>
                    Concorrência
                  </label>
                  <select
                    value={concurrencyPolicy}
                    onChange={(e) => setConcurrencyPolicy(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "#f8fafc",
                      fontSize: "0.85rem"
                    }}
                  >
                    <option value="SKIP_IF_RUNNING">Pular se já em execução (SKIP)</option>
                    <option value="ALLOW">Permitir Paralelo (ALLOW)</option>
                    <option value="QUEUE">Fila Sequencial (QUEUE)</option>
                  </select>
                </div>
              </div>

              {scheduleType === "cron" ? (
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "#cbd5e1", marginBottom: 4 }}>
                    Expressão Cron (5 posições: min hora dia mês dia_semana) *
                  </label>
                  <input
                    type="text"
                    required
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="0 2 * * *"
                    style={{
                      width: "100%",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "#f8fafc",
                      fontFamily: "monospace",
                      fontSize: "0.9rem"
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {CRON_PRESETS.map((p) => (
                      <button
                        key={p.cron}
                        type="button"
                        onClick={() => setCronExpression(p.cron)}
                        style={{
                          background: "rgba(51, 65, 85, 0.4)",
                          border: "1px solid #475569",
                          borderRadius: 4,
                          padding: "3px 8px",
                          fontSize: "0.72rem",
                          color: "#cbd5e1",
                          cursor: "pointer"
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "#cbd5e1", marginBottom: 4 }}>
                    Intervalo (segundos) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(parseInt(e.target.value) || 60)}
                    style={{
                      width: "100%",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "#f8fafc",
                      fontSize: "0.85rem"
                    }}
                  />
                </div>
              )}

              {/* Webhook Settings */}
              <div style={{
                background: "rgba(30, 41, 59, 0.4)",
                padding: 12,
                borderRadius: 8,
                border: "1px solid #334155"
              }}>
                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 6
                }}>
                  <Bell size={14} color="#818cf8" /> Notificações Webhook (Opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "8px 10px",
                    color: "#f8fafc",
                    fontSize: "0.82rem",
                    marginBottom: 8
                  }}
                />
                <div style={{ display: "flex", gap: 16, fontSize: "0.78rem", color: "#cbd5e1" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={notifySuccess}
                      onChange={(e) => setNotifySuccess(e.target.checked)}
                    />
                    Notificar Sucesso
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={notifyFailure}
                      onChange={(e) => setNotifyFailure(e.target.checked)}
                    />
                    Notificar Falha
                  </label>
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setActiveTab("list")}
                  style={{
                    background: "transparent",
                    border: "1px solid #475569",
                    color: "#cbd5e1",
                    padding: "8px 16px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.85rem"
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    background: "#4f46e5",
                    border: "none",
                    color: "#ffffff",
                    padding: "8px 18px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  }}
                >
                  {submitting ? "Cadastrando..." : "Salvar Agendamento"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
