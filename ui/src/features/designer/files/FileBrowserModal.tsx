import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Folder,
  File,
  HardDrive,
  Search,
  ChevronRight,
  ArrowUp,
  FileSpreadsheet,
  Database,
  FileCode,
  Check,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { api } from "../../../api/client";

interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
}

interface FileBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (filePath: string) => void;
  currentPath?: string;
  title?: string;
}

export const FileBrowserModal: React.FC<FileBrowserModalProps> = ({
  isOpen,
  onClose,
  onSelectFile,
  currentPath = "",
  title = "Selecionar Arquivo de Dados",
}) => {
  const [currentDir, setCurrentDir] = useState<string>("data");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isNativeBrowsing, setIsNativeBrowsing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState(currentPath);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDirectory = useCallback(async (dir: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.listLocalFiles(dir);
      if (res && res.items) {
        setItems(res.items);
        setCurrentDir(res.current_dir);
      } else {
        // Se a pasta não existir ou for vazia, tenta raiz
        const rootRes = await api.listLocalFiles("");
        setItems(rootRes?.items || []);
        setCurrentDir(rootRes?.current_dir || "");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao listar diretório");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Inicia em 'data' ou na pasta do arquivo atual
      const initial = currentPath ? currentPath.split("/").slice(0, -1).join("/") : "data";
      setCurrentDir(initial || "data");
      loadDirectory(initial || "data");
      setSelectedFilePath(currentPath);
      setSearchQuery("");
    }
  }, [isOpen, currentPath, loadDirectory]);

  if (!isOpen) return null;

  const handleNativeBrowse = async () => {
    setIsNativeBrowsing(true);
    setErrorMessage(null);
    try {
      // 1. Se estiver no Electron Desktop
      if ((window as any).electronAPI?.openFile) {
        const file = await (window as any).electronAPI.openFile(currentDir);
        if (file) {
          const clean = file.replace(/^["']|["']$/g, "").trim();
          onSelectFile(clean);
          onClose();
          return;
        }
      }

      // 2. Via backend FastAPI (subprocess PowerShell/tkinter)
      const res = await api.browseLocalFile(currentDir);
      if (res && res.path) {
        const clean = res.path.replace(/^["']|["']$/g, "").trim();
        onSelectFile(clean);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao abrir navegador de arquivos nativo do SO");
    } finally {
      setIsNativeBrowsing(false);
    }
  };

  const navigateUp = () => {
    if (!currentDir || currentDir === "." || currentDir === "") return;
    const parts = currentDir.split("/").filter(Boolean);
    parts.pop();
    const parentDir = parts.join("/");
    loadDirectory(parentDir);
  };

  const formatSize = (bytes?: number) => {
    if (bytes === undefined || bytes === null || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (item: FileItem) => {
    if (item.type === "directory") {
      return <Folder size={16} className="text-amber-400 shrink-0" />;
    }
    const ext = item.extension?.toLowerCase() || item.name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "csv":
      case "tsv":
        return <FileSpreadsheet size={16} className="text-emerald-400 shrink-0" />;
      case "parquet":
        return <Database size={16} className="text-cyan-400 shrink-0" />;
      case "json":
      case "jsonl":
        return <FileCode size={16} className="text-amber-300 shrink-0" />;
      case "duckdb":
      case "db":
      case "sqlite":
        return <Database size={16} className="text-yellow-400 shrink-0" />;
      case "xlsx":
      case "xls":
        return <FileSpreadsheet size={16} className="text-green-500 shrink-0" />;
      default:
        return <File size={16} className="text-slate-400 shrink-0" />;
    }
  };

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden text-slate-100">
        {/* ─── Header ────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <HardDrive size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-base text-slate-100">{title}</h3>
              <p className="text-xs text-slate-400">
                Navegue pelo sistema de arquivos ou abra a janela do SO
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ─── Native OS File Picker Quick Action Banner ──── */}
        <div className="p-4 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-300">
            <span className="font-semibold text-slate-100 block">Procurar no Disco Local:</span>
            Abra a caixa de diálogo nativa do Windows Explorer / SO para buscar em qualquer diretório.
          </div>
          <button
            type="button"
            onClick={handleNativeBrowse}
            disabled={isNativeBrowsing}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md shadow-cyan-950/40 transition-all shrink-0 cursor-pointer disabled:opacity-50"
          >
            {isNativeBrowsing ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
            <span>{isNativeBrowsing ? "Aguardando SO..." : "Abrir Explorador do SO"}</span>
          </button>
        </div>

        {/* ─── Current Path Breadcrumb & Search ───────────── */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/60 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={navigateUp}
              disabled={!currentDir || currentDir === "."}
              className="p-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Pasta Superior"
            >
              <ArrowUp size={14} />
            </button>

            <button
              type="button"
              onClick={() => loadDirectory("data")}
              className="px-2.5 py-1 text-xs rounded border border-cyan-800/50 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-900/50"
              title="Ir para pasta data/"
            >
              data/
            </button>
            <button
              type="button"
              onClick={() => loadDirectory("data/samples")}
              className="px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              title="Ir para data/samples/"
            >
              samples/
            </button>
            <button
              type="button"
              onClick={() => loadDirectory("")}
              className="px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              title="Raiz do Workspace"
            >
              raiz
            </button>

            <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/60 border border-slate-800 rounded font-mono text-xs text-slate-300 overflow-x-auto whitespace-nowrap">
              <span className="text-slate-500">pasta:</span>
              <span>{currentDir || "/"}</span>
            </div>

            <button
              type="button"
              onClick={() => loadDirectory(currentDir)}
              className="p-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Recarregar"
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
            </button>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar arquivos na pasta atual..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
        </div>

        {/* ─── File & Folder List ─────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[220px] max-h-[340px]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 gap-2">
              <Loader2 size={24} className="spin text-cyan-400" />
              <span className="text-xs">Carregando arquivos...</span>
            </div>
          ) : errorMessage ? (
            <div className="p-4 text-xs text-rose-400 bg-rose-950/20 border border-rose-800/40 rounded-lg">
              {errorMessage}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500 gap-1">
              <Folder size={28} className="opacity-40" />
              <span className="text-xs">Nenhum arquivo de dados compatível encontrado nesta pasta.</span>
              <span className="text-[11px] text-slate-600">Use o botão "Abrir Explorador do SO" acima para procurar em outro local.</span>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredItems.map((item) => {
                const isSelected = selectedFilePath === item.path;
                return (
                  <div
                    key={item.path}
                    onClick={() => {
                      if (item.type === "directory") {
                        loadDirectory(item.path);
                      } else {
                        setSelectedFilePath(item.path);
                      }
                    }}
                    onDoubleClick={() => {
                      if (item.type === "directory") {
                        loadDirectory(item.path);
                      } else {
                        onSelectFile(item.path);
                        onClose();
                      }
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-all border ${
                      isSelected
                        ? "bg-cyan-950/50 border-cyan-500/60 text-cyan-200"
                        : "bg-slate-800/40 hover:bg-slate-800 border-slate-800/80 hover:border-slate-700 text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {getFileIcon(item)}
                      <span className="font-mono truncate">{item.name}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-[11px] text-slate-400">
                      {item.type === "directory" ? (
                        <div className="flex items-center gap-1 text-slate-500">
                          <span>Pasta</span>
                          <ChevronRight size={13} />
                        </div>
                      ) : (
                        <>
                          <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                            {item.extension || "FILE"}
                          </span>
                          <span className="font-mono text-slate-400">{formatSize(item.size)}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Footer ─────────────────────────────────────── */}
        <div className="border-t border-slate-800 p-3.5 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-[11px] text-slate-400 block">Arquivo selecionado:</span>
            <span className="font-mono text-xs text-cyan-300 truncate block">
              {selectedFilePath || "(Nenhum arquivo selecionado)"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!selectedFilePath}
              onClick={() => {
                if (selectedFilePath) {
                  onSelectFile(selectedFilePath);
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={14} />
              <span>Confirmar Seleção</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

