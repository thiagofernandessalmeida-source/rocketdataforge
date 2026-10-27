import React, { useState, useMemo } from "react";
import {
  X,
  Check,
  Layers,
  Table2,
  ArrowRight,
  ArrowLeft,
  CheckSquare,
  Square,
  Search,
  Key,
  Database,
  ArrowDownToLine,
  Filter
} from "lucide-react";
import { SchemaColumn, jobStore } from "../../store/jobStore";
import { resolveSchemaCollisions, CollisionStrategy } from "../../utils/schemaClipboard";

export interface ImportSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (columns: SchemaColumn[]) => void;
  currentSchema: SchemaColumn[];
  excludeNodeId?: string;
  title?: string;
}

interface ComponentOption {
  cellId: string;
  cellName: string;
  nodeId: string;
  nodeLabel: string;
  componentType: string;
  schema: SchemaColumn[];
}

export const ImportSchemaModal: React.FC<ImportSchemaModalProps> = ({
  isOpen,
  onClose,
  onImport,
  currentSchema,
  excludeNodeId,
  title = "Importar Schema de Outro Componente"
}) => {
  // Passos: 1 = Seleção de Componente, 2 = Seleção de Colunas, 3 = Estratégia de Colisão
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedComponent, setSelectedComponent] = useState<ComponentOption | null>(null);
  const [selectedColIds, setSelectedColIds] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<CollisionStrategy>("overwrite");
  const [searchQuery, setSearchQuery] = useState("");

  // Coleta todos os nós com schema no job agrupados por célula
  const componentsByCell = useMemo(() => {
    const activeJob = jobStore.getActiveJob();
    if (!activeJob || !activeJob.cells) return [];

    const grouped: { cellId: string; cellName: string; components: ComponentOption[] }[] = [];

    for (const cell of activeJob.cells) {
      const cellComponents: ComponentOption[] = [];
      const cellSchemas = cell.nodeSchemas || activeJob.nodeSchemas || {};

      for (const node of cell.nodes || []) {
        if (node.id === excludeNodeId) continue;

        let nodeSchema: SchemaColumn[] = [];
        if (Array.isArray((node.data as any)?.schema) && (node.data as any).schema.length > 0) {
          nodeSchema = (node.data as any).schema;
        } else if (cellSchemas[node.id] && cellSchemas[node.id].length > 0) {
          nodeSchema = cellSchemas[node.id];
        }

        if (nodeSchema.length > 0) {
          cellComponents.push({
            cellId: cell.id,
            cellName: cell.name || `Célula ${cell.order}`,
            nodeId: node.id,
            nodeLabel: (node.data as any)?.label || node.id,
            componentType: (node.data as any)?.componentType || (node.data as any)?.type || "Component",
            schema: nodeSchema
          });
        }
      }

      if (cellComponents.length > 0) {
        grouped.push({
          cellId: cell.id,
          cellName: cell.name || `Célula ${cell.order}`,
          components: cellComponents
        });
      }
    }

    return grouped;
  }, [excludeNodeId]);

  if (!isOpen) return null;

  const handleSelectComponent = (comp: ComponentOption) => {
    setSelectedComponent(comp);
    setSelectedColIds(new Set(comp.schema.map(c => c.id)));
    setStep(2);
  };

  const handleToggleColumn = (colId: string) => {
    setSelectedColIds(prev => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
      }
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    if (!selectedComponent) return;
    setSelectedColIds(new Set(selectedComponent.schema.map(c => c.id)));
  };

  const handleDeselectAllColumns = () => {
    setSelectedColIds(new Set());
  };

  const handleConfirmImport = () => {
    if (!selectedComponent) return;
    const incomingSelected = selectedComponent.schema.filter(c => selectedColIds.has(c.id));
    const merged = resolveSchemaCollisions(currentSchema, incomingSelected, strategy);
    onImport(merged);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#1e222b] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-200">
        {/* Header com Stepper */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#161922]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-slate-100">{title}</h3>
              <p className="text-xs text-slate-400">
                Passo {step} de 3: {step === 1 ? "Escolher Componente" : step === 2 ? "Selecionar Colunas" : "Estratégia de Resolução"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Indicador visual de progresso */}
        <div className="grid grid-cols-3 border-b border-slate-800 text-xs text-center font-medium">
          <div className={`py-2 border-b-2 transition-colors ${step >= 1 ? "border-indigo-500 text-indigo-400 bg-indigo-500/5" : "border-transparent text-slate-500"}`}>
            1. Componente de Origem
          </div>
          <div className={`py-2 border-b-2 transition-colors ${step >= 2 ? "border-indigo-500 text-indigo-400 bg-indigo-500/5" : "border-transparent text-slate-500"}`}>
            2. Seleção de Colunas
          </div>
          <div className={`py-2 border-b-2 transition-colors ${step === 3 ? "border-indigo-500 text-indigo-400 bg-indigo-500/5" : "border-transparent text-slate-500"}`}>
            3. Resolução de Conflitos
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ─── PASSO 1: Seleção de Componente agrupado por Célula ─── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar componente ou célula..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {componentsByCell.length === 0 ? (
                <div className="p-8 text-center text-slate-400 border border-dashed border-slate-800 rounded-xl">
                  <Database className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                  <p className="text-sm font-medium">Nenhum outro componente com schema encontrado no Job.</p>
                  <p className="text-xs text-slate-500 mt-1">Conecte componentes de entrada ou defina schemas em outras células.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {componentsByCell.map(group => {
                    const filteredComponents = group.components.filter(c =>
                      c.nodeLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      group.cellName.toLowerCase().includes(searchQuery.toLowerCase())
                    );

                    if (filteredComponents.length === 0) return null;

                    return (
                      <div key={group.cellId} className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/30">
                        <div className="px-3.5 py-2 bg-slate-800/40 border-b border-slate-800/80 flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-xs font-semibold text-slate-300">{group.cellName}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 ml-auto">
                            {filteredComponents.length} componente(s)
                          </span>
                        </div>
                        <div className="divide-y divide-slate-800/60">
                          {filteredComponents.map(comp => (
                            <button
                              key={comp.nodeId}
                              onClick={() => handleSelectComponent(comp)}
                              className="w-full px-4 py-3 text-left hover:bg-indigo-500/10 flex items-center justify-between group transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded bg-slate-800 text-slate-300 group-hover:bg-indigo-500/20 group-hover:text-indigo-300">
                                  <Table2 className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-slate-200 group-hover:text-indigo-200">
                                    {comp.nodeLabel}
                                  </div>
                                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                                    <span>{comp.componentType}</span>
                                    <span>•</span>
                                    <span>{comp.schema.length} colunas</span>
                                  </div>
                                </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── PASSO 2: Seleção Granular de Colunas ─── */}
          {step === 2 && selectedComponent && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Origem:</span>
                  <span className="font-semibold text-indigo-400">{selectedComponent.nodeLabel}</span>
                  <span className="text-slate-500">({selectedComponent.cellName})</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllColumns}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    Marcar Todas
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    onClick={handleDeselectAllColumns}
                    className="text-xs text-slate-400 hover:text-slate-300 font-medium"
                  >
                    Desmarcar Todas
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/30 max-h-[340px] overflow-y-auto divide-y divide-slate-800/60">
                {selectedComponent.schema.map(col => {
                  const isChecked = selectedColIds.has(col.id);
                  return (
                    <div
                      key={col.id}
                      onClick={() => handleToggleColumn(col.id)}
                      className={`px-4 py-2.5 flex items-center justify-between cursor-pointer transition-colors ${isChecked ? "bg-indigo-500/10" : "hover:bg-slate-800/40"}`}
                    >
                      <div className="flex items-center gap-3">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                        <span className="text-xs font-mono font-medium text-slate-200 flex items-center gap-1.5">
                          {col.name}
                          {col.isPrimaryKey && (
                            <span title="Chave Primária">
                              <Key className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                          {col.type}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {col.nullable ? "nullable" : "not null"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-xs text-slate-400 text-right">
                {selectedColIds.size} de {selectedComponent.schema.length} coluna(s) selecionada(s)
              </div>
            </div>
          )}

          {/* ─── PASSO 3: Resolução de Conflitos (Estratégia) ─── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-300 font-medium">
                Escolha como resolver colunas com o mesmo nome entre o schema atual ({currentSchema.length} colunas) e as {selectedColIds.size} colunas importadas:
              </p>

              <div className="space-y-3">
                <label
                  onClick={() => setStrategy("overwrite")}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${strategy === "overwrite" ? "bg-indigo-500/10 border-indigo-500" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"}`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "overwrite"}
                    onChange={() => setStrategy("overwrite")}
                    className="mt-1 text-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Sobrescrever (Overwrite)</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Atualiza o tipo e definições das colunas existentes com mesmo nome e adiciona as novas.
                    </div>
                  </div>
                </label>

                <label
                  onClick={() => setStrategy("skip")}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${strategy === "skip" ? "bg-indigo-500/10 border-indigo-500" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"}`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "skip"}
                    onChange={() => setStrategy("skip")}
                    className="mt-1 text-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Ignorar Duplicadas (Skip)</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Mantém intactas as colunas existentes e importa apenas as colunas que ainda não existirem.
                    </div>
                  </div>
                </label>

                <label
                  onClick={() => setStrategy("rename")}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${strategy === "rename" ? "bg-indigo-500/10 border-indigo-500" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"}`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "rename"}
                    onChange={() => setStrategy("rename")}
                    className="mt-1 text-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Renomear com Sufixo (Rename)</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Preserva as colunas existentes e renomeia as colunas importadas conflitantes adicionando sufixo (ex: col_1).
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer com Ações */}
        <div className="px-6 py-4 border-t border-slate-800 bg-[#161922] flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(prev => (prev - 1) as 1 | 2 | 3)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
            >
              Cancelar
            </button>

            {step === 2 && (
              <button
                disabled={selectedColIds.size === 0}
                onClick={() => setStep(3)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
              >
                Avançar
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 3 && (
              <button
                onClick={handleConfirmImport}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
              >
                <Check className="w-4 h-4" />
                Concluir Importação
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
