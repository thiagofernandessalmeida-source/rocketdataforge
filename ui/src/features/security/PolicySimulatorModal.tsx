import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Cpu,
  Lock,
  Unlock,
  Play,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Copy,
  RefreshCw,
  Fingerprint,
  UserCheck,
} from "lucide-react";

interface PolicySimulatorModalProps {
  onClose: () => void;
  currentUser?: string;
}

const DEFAULT_POLICY = {
  version: "2026-10-01",
  principal: "analyst_maria",
  hardware_fingerprint: "",
  statements: [
    {
      sid: "AllowStandardFileConnectors",
      effect: "Allow",
      actions: ["connector:use", "pipeline:execute"],
      resources: ["urn:rdf:connector:core.file.*"],
      conditions: {}
    },
    {
      sid: "AllowRestrictedMysqlAgreements",
      effect: "Allow",
      actions: ["connector:use"],
      resources: ["urn:rdf:connector:connector.custom.mysql_agreements"],
      conditions: {
        max_batch_size: 1000,
        require_job_description: true
      }
    },
    {
      sid: "DenyDirectProductionDatabases",
      effect: "Deny",
      actions: ["connector:use"],
      resources: ["urn:rdf:connector:*-prod-direct"],
      conditions: {}
    }
  ],
  metadata: {
    department: "BI & Análise",
    environment: "corporativo"
  }
};

export const PolicySimulatorModal: React.FC<PolicySimulatorModalProps> = ({
  onClose,
  currentUser = "analyst_maria",
}) => {
  const [activeTab, setActiveTab] = useState<"dryrun" | "crypto">("dryrun");

  // Policy state
  const [policyJson, setPolicyJson] = useState(JSON.stringify(DEFAULT_POLICY, null, 2));

  // Simulation state
  const [simPrincipal, setSimPrincipal] = useState("analyst_maria");
  const [simAction, setSimAction] = useState("connector:use");
  const [simResource, setSimResource] = useState("urn:rdf:connector:connector.custom.mysql_agreements");
  const [simContextJson, setSimContextJson] = useState('{\n  "batch_size": 800,\n  "job_description": "Carga de Acordos Comerciais"\n}');
  const [simResult, setSimResult] = useState<{
    decision: string;
    allowed: boolean;
    matched_statement_sid?: string | null;
    reason: string;
    evaluated_statements_count: number;
  } | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  // Crypto state
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [publicKeyPem, setPublicKeyPem] = useState("");
  const [hardwareFingerprint, setHardwareFingerprint] = useState("");
  const [signedJws, setSignedJws] = useState("");
  const [cryptoStatus, setCryptoStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [enforceHwBinding, setEnforceHwBinding] = useState(false);

  // Fetch initial machine fingerprint and keys if empty
  useEffect(() => {
    fetch("http://localhost:8000/api/v1/policies/machine-fingerprint")
      .then((res) => res.json())
      .then((data) => {
        if (data.hardware_fingerprint) {
          setHardwareFingerprint(data.hardware_fingerprint);
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerateKeys = async () => {
    setCryptoLoading(true);
    setCryptoStatus(null);
    try {
      const res = await fetch("http://localhost:8000/api/v1/policies/keys/generate", {
        method: "POST"
      });
      const data = await res.json();
      setPrivateKeyPem(data.private_key_pem);
      setPublicKeyPem(data.public_key_pem);
      setCryptoStatus({
        success: true,
        message: "Par de chaves RSA (2048-bit) gerado com sucesso para a Autoridade Central."
      });
    } catch (err: any) {
      setCryptoStatus({
        success: false,
        message: `Falha ao gerar chaves: ${err.message}`
      });
    } finally {
      setCryptoLoading(false);
    }
  };

  const handleSignPolicy = async () => {
    if (!privateKeyPem) {
      alert("Por favor, gere ou insira a Chave Privada antes de assinar a política.");
      return;
    }
    setCryptoLoading(true);
    setCryptoStatus(null);
    try {
      const parsedDoc = JSON.parse(policyJson);
      if (enforceHwBinding && hardwareFingerprint) {
        parsedDoc.hardware_fingerprint = hardwareFingerprint;
      }

      const res = await fetch("http://localhost:8000/api/v1/policies/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: parsedDoc,
          private_key_pem: privateKeyPem
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Erro ao assinar");
      }

      const data = await res.json();
      setSignedJws(data.signed_jws);
      setCryptoStatus({
        success: true,
        message: `Política assinada digitalmente com sucesso (JWS RS256)! Vinculada ao Principal '${data.principal}'.`
      });
    } catch (err: any) {
      setCryptoStatus({
        success: false,
        message: `Falha ao assinar política: ${err.message}`
      });
    } finally {
      setCryptoLoading(false);
    }
  };

  const handleVerifyPolicy = async (customExpectedPrincipal?: string) => {
    if (!signedJws || !publicKeyPem) {
      alert("É necessário ter o token assinado (JWS) e a Chave Pública para verificação.");
      return;
    }
    setCryptoLoading(true);
    setCryptoStatus(null);
    try {
      const principalToTest = customExpectedPrincipal !== undefined ? customExpectedPrincipal : simPrincipal;
      const res = await fetch("http://localhost:8000/api/v1/policies/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_jws: signedJws,
          public_key_pem: publicKeyPem,
          expected_principal: principalToTest,
          verify_hardware: enforceHwBinding
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Violação de segurança");
      }

      setCryptoStatus({
        success: true,
        message: "Assinatura digital ÍNTEGRA e autêntica! Identity Binding confirmado com o usuário."
      });
    } catch (err: any) {
      setCryptoStatus({
        success: false,
        message: `BLOCKED: ${err.message}`
      });
    } finally {
      setCryptoLoading(false);
    }
  };

  const handleSimulateTampering = async () => {
    if (!signedJws) {
      alert("Assine uma política primeiro antes de testar a adulteração.");
      return;
    }
    // Adulterar a assinatura trocando caracteres
    const parts = signedJws.split(".");
    const tampered = `${parts[0]}.${parts[1]}__tampered__.${parts[2]}`;
    setCryptoLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/v1/policies/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_jws: tampered,
          public_key_pem: publicKeyPem,
          expected_principal: simPrincipal,
          verify_hardware: false
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setCryptoStatus({
          success: false,
          message: `Tentativa de Fraude Detectada com Sucesso: ${data.detail}`
        });
      }
    } catch (err: any) {
      setCryptoStatus({
        success: false,
        message: `Fraude Detectada: ${err.message}`
      });
    } finally {
      setCryptoLoading(false);
    }
  };

  const handleRunSimulation = async () => {
    setSimLoading(true);
    setSimResult(null);
    try {
      let parsedPolicy: any = null;
      try {
        parsedPolicy = JSON.parse(policyJson);
      } catch (e: any) {
        throw new Error(`JSON de Policy inválido: ${e.message}`);
      }

      let parsedContext: any = {};
      try {
        if (simContextJson.trim()) {
          parsedContext = JSON.parse(simContextJson);
        }
      } catch (e: any) {
        throw new Error(`Contexto JSON inválido: ${e.message}`);
      }

      const res = await fetch("http://localhost:8000/api/v1/policies/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: parsedPolicy,
          principal: simPrincipal,
          action: simAction,
          resource: simResource,
          context: parsedContext
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Erro na simulação");
      }

      const data = await res.json();
      setSimResult(data);
    } catch (err: any) {
      alert(`Falha na simulação: ${err.message}`);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155] bg-[#0f172a]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Simulador de Políticas ABAC & Segurança Criptográfica
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium">
                  Enterprise
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Validação estrita com JSON Schema, Identity Binding por chave assimétrica e Dry-Run de acesso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 border-b border-[#334155] bg-[#162032]">
          <button
            onClick={() => setActiveTab("dryrun")}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "dryrun"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Play size={14} />
            Simulador de Acesso (Dry-Run)
          </button>
          <button
            onClick={() => setActiveTab("crypto")}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "crypto"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Key size={14} />
            Assinatura Digital & Anti-Tamper (JWS)
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0f172a]/60">
          {activeTab === "dryrun" ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
              {/* Left Column: Policy JSON Editor */}
              <div className="lg:col-span-6 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <FileCode size={14} className="text-blue-400" />
                    Documento de Política (JSON Schema Estrito)
                  </label>
                  <button
                    onClick={() => setPolicyJson(JSON.stringify(DEFAULT_POLICY, null, 2))}
                    className="text-[11px] text-slate-400 hover:text-blue-400 flex items-center gap-1"
                  >
                    <RefreshCw size={11} /> Restaurar Padrão
                  </button>
                </div>
                <textarea
                  value={policyJson}
                  onChange={(e) => setPolicyJson(e.target.value)}
                  className="w-full flex-1 min-h-[360px] bg-[#090d16] border border-[#334155] rounded-lg p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-blue-500 resize-none shadow-inner"
                  spellCheck={false}
                />
              </div>

              {/* Right Column: Simulation Parameters & Results */}
              <div className="lg:col-span-6 flex flex-col gap-4">
                <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4 flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <UserCheck size={14} className="text-blue-400" />
                    Parâmetros da Solicitação de Acesso
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Principal (Usuário):</label>
                      <input
                        type="text"
                        value={simPrincipal}
                        onChange={(e) => setSimPrincipal(e.target.value)}
                        className="w-full bg-[#0f172a] border border-[#334155] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Ação Solicitada:</label>
                      <input
                        type="text"
                        value={simAction}
                        onChange={(e) => setSimAction(e.target.value)}
                        className="w-full bg-[#0f172a] border border-[#334155] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Recurso Alvo (URN):</label>
                    <input
                      type="text"
                      value={simResource}
                      onChange={(e) => setSimResource(e.target.value)}
                      className="w-full bg-[#0f172a] border border-[#334155] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Contexto Dinâmico (JSON):</label>
                    <textarea
                      value={simContextJson}
                      onChange={(e) => setSimContextJson(e.target.value)}
                      rows={3}
                      className="w-full bg-[#0f172a] border border-[#334155] rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleRunSimulation}
                    disabled={simLoading}
                    className="w-full mt-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                  >
                    <Play size={14} />
                    {simLoading ? "Avaliando Regras..." : "Executar Simulação de Acesso (Dry-Run)"}
                  </button>
                </div>

                {/* Simulation Result Card */}
                {simResult && (
                  <div
                    className={`border rounded-lg p-4 flex flex-col gap-2 transition-all ${
                      simResult.allowed
                        ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-200"
                        : "bg-rose-950/20 border-rose-500/40 text-rose-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300">Decisão do Motor ABAC:</span>
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full border ${
                          simResult.allowed
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                            : "bg-rose-500/20 border-rose-500 text-rose-400"
                        }`}
                      >
                        {simResult.decision.toUpperCase()}
                      </span>
                    </div>

                    <div className="text-xs flex items-center gap-1.5 mt-1">
                      <span className="font-semibold text-slate-300">Regra Correspondente (SID):</span>
                      <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-white">
                        {simResult.matched_statement_sid || "Nenhum (Default Deny)"}
                      </code>
                    </div>

                    <div className="text-xs mt-1">
                      <span className="font-semibold text-slate-300">Motivo: </span>
                      <span>{simResult.reason}</span>
                    </div>

                    <div className="text-[11px] text-slate-400 border-t border-slate-700/50 pt-2 mt-1">
                      Total de declarações avaliadas: {simResult.evaluated_statements_count}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Crypto & Anti-Tamper Tab */
            <div className="flex flex-col gap-6">
              {/* RSA Keys Generation */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-2">
                      <Key size={14} className="text-blue-400" />
                      1. Autoridade de Chaves Assimétricas (RSA RS256)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Chave Privada usada pela autoridade para assinar; Chave Pública distribuída para clientes validarem
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateKeys}
                    disabled={cryptoLoading}
                    className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw size={12} className={cryptoLoading ? "animate-spin" : ""} />
                    Gerar Novo Par de Chaves RSA
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Chave Privada (PEM) - Fica no Servidor Central:</label>
                    <textarea
                      value={privateKeyPem}
                      onChange={(e) => setPrivateKeyPem(e.target.value)}
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                      rows={4}
                      className="w-full bg-[#090d16] border border-[#334155] rounded p-2 text-[10px] font-mono text-slate-300 focus:outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Chave Pública (PEM) - Conhecida pelo Cliente:</label>
                    <textarea
                      value={publicKeyPem}
                      onChange={(e) => setPublicKeyPem(e.target.value)}
                      placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                      rows={4}
                      className="w-full bg-[#090d16] border border-[#334155] rounded p-2 text-[10px] font-mono text-slate-300 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Hardware Fingerprint & Identity Binding */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4 flex flex-col gap-3">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <Fingerprint size={14} className="text-emerald-400" />
                  2. Ancoragem de Identidade & Hardware (Binding)
                </h3>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2 bg-[#090d16] px-3 py-1.5 rounded border border-[#334155]">
                    <span className="text-slate-400">Hardware Fingerprint do Host:</span>
                    <code className="text-emerald-400 font-mono font-bold">
                      {hardwareFingerprint || "Carregando..."}
                    </code>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={enforceHwBinding}
                      onChange={(e) => setEnforceHwBinding(e.target.checked)}
                      className="rounded border-[#334155] bg-[#090d16] text-blue-500 focus:ring-0"
                    />
                    <span>Ativar Hardware Binding (impedir cópia para outras máquinas)</span>
                  </label>
                </div>
              </div>

              {/* Signing and Verification Testing */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <Lock size={14} className="text-amber-400" />
                    3. Assinatura Digital e Teste Anti-Cópia
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSignPolicy}
                      disabled={cryptoLoading || !privateKeyPem}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <Lock size={12} /> Assinar Policy (Gerar .jws)
                    </button>
                    <button
                      onClick={() => handleVerifyPolicy()}
                      disabled={cryptoLoading || !signedJws || !publicKeyPem}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <ShieldCheck size={12} /> Validar Assinatura
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Token JWS Blindado (JSON Web Signature):
                  </label>
                  <textarea
                    value={signedJws}
                    onChange={(e) => setSignedJws(e.target.value)}
                    placeholder="O token JWS assinado aparecerá aqui após clicar em 'Assinar Policy'..."
                    rows={3}
                    className="w-full bg-[#090d16] border border-[#334155] rounded p-2 text-[10px] font-mono text-cyan-400 focus:outline-none resize-none break-all"
                  />
                </div>

                {/* Fraud / Tamper Simulation Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#334155]">
                  <span className="text-xs text-slate-400 font-semibold">Simular Tentativas de Fraude:</span>
                  <button
                    onClick={() => handleVerifyPolicy("hacker_user_02")}
                    disabled={!signedJws || !publicKeyPem}
                    className="bg-rose-900/40 hover:bg-rose-900/70 border border-rose-500/50 text-rose-200 text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <AlertTriangle size={13} className="text-rose-400" />
                    Tentativa 1: Outro usuário tentando usar a policy (Identity Mismatch)
                  </button>
                  <button
                    onClick={handleSimulateTampering}
                    disabled={!signedJws || !publicKeyPem}
                    className="bg-amber-900/40 hover:bg-amber-900/70 border border-amber-500/50 text-amber-200 text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <AlertTriangle size={13} className="text-amber-400" />
                    Tentativa 2: Adulterar payload do arquivo local
                  </button>
                </div>

                {/* Status Alert Banner */}
                {cryptoStatus && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 mt-2 ${
                      cryptoStatus.success
                        ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                        : "bg-rose-950/30 border-rose-500/40 text-rose-300"
                    }`}
                  >
                    {cryptoStatus.success ? (
                      <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold">
                        {cryptoStatus.success ? "Validação Aprovada: " : "Bloqueio de Segurança: "}
                      </span>
                      <span>{cryptoStatus.message}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#334155] bg-[#0f172a] flex items-center justify-between text-xs text-slate-400">
          <span>RocketDataForge Enterprise Security • Módulo ABAC Criptográfico</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
