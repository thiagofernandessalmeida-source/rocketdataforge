import React, { useState, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Zap,
  Plus,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
  X,
  Check,
  FileCode2,
  Upload,
} from "lucide-react";
import { jobStore, FolderData, JobData } from "../../store/jobStore";
import { useJobStore } from "../../store/useJobStore";

interface JobRepositoryProps {
  onOpenJob: (jobId: string) => void;
  onImportJob?: (file: File, targetFolderId?: string) => void;
}

export const JobRepository: React.FC<JobRepositoryProps> = ({ onOpenJob, onImportJob }) => {
  const state = useJobStore();
  const [contextMenu, setContextMenu] = useState<{
    type: "folder" | "job";
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [creating, setCreating] = useState<{
    type: "folder" | "job";
    parentId: string;
    value: string;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetFolderForImport, setTargetFolderForImport] = useState<string | undefined>(undefined);

  const handleTriggerImport = (folderId?: string) => {
    setTargetFolderForImport(folderId);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportJob) {
      onImportJob(file, targetFolderForImport);
    }
    setTargetFolderForImport(undefined);
  };

  const closeContextMenu = () => setContextMenu(null);

  // Build tree
  const getRootFolders = () =>
    state.folders.filter((f) => f.parentId === null);
  const getChildFolders = (parentId: string) =>
    state.folders.filter((f) => f.parentId === parentId);
  const getFolderJobs = (folderId: string) =>
    state.jobs.filter((j) => j.folderId === folderId);

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "folder", id: folderId, x: e.clientX, y: e.clientY });
  };

  const handleJobContextMenu = (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "job", id: jobId, x: e.clientX, y: e.clientY });
  };

  const startRename = (id: string, currentName: string) => {
    setRenaming({ id, value: currentName });
    closeContextMenu();
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = () => {
    if (!renaming || !renaming.value.trim()) return;
    const isJob = state.jobs.find((j) => j.id === renaming.id);
    if (isJob) {
      jobStore.renameJob(renaming.id, renaming.value.trim());
    } else {
      jobStore.renameFolder(renaming.id, renaming.value.trim());
    }
    setRenaming(null);
  };

  const handleDelete = () => {
    if (!contextMenu) return;
    if (contextMenu.type === "job") {
      jobStore.deleteJob(contextMenu.id);
    } else {
      jobStore.deleteFolder(contextMenu.id);
    }
    closeContextMenu();
  };

  const startCreate = (type: "folder" | "job", parentId: string) => {
    setCreating({ type, parentId, value: type === "job" ? "Novo Job" : "Nova Pasta" });
    closeContextMenu();
    // Ensure parent is expanded
    jobStore.toggleFolderExpanded(parentId);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitCreate = () => {
    if (!creating || !creating.value.trim()) {
      setCreating(null);
      return;
    }
    if (creating.type === "job") {
      const job = jobStore.createJob(creating.value.trim(), creating.parentId);
      onOpenJob(job.id);
    } else {
      jobStore.createFolder(creating.value.trim(), creating.parentId);
    }
    setCreating(null);
  };

  const renderInlineInput = (defaultValue: string, onCommit: () => void, onChange: (v: string) => void) => (
    <input
      ref={renameInputRef}
      autoFocus
      className="repo-inline-input"
      value={defaultValue}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") { setRenaming(null); setCreating(null); }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const renderJob = (job: JobData, depth: number) => {
    const isActive = state.activeTabId === job.id;
    const isOpen = state.openTabIds.includes(job.id);
    const isRenaming = renaming?.id === job.id;

    return (
      <div key={job.id}>
        <div
          className={`repo-item repo-job ${isActive ? "active" : ""} ${isOpen ? "open" : ""}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onOpenJob(job.id)}
          onContextMenu={(e) => handleJobContextMenu(e, job.id)}
          title={job.name}
        >
          <Zap size={13} className="repo-job-icon" />
          {isRenaming ? (
            renderInlineInput(
              renaming!.value,
              commitRename,
              (v) => setRenaming((r) => r ? { ...r, value: v } : r)
            )
          ) : (
            <span className="repo-item-label">{job.name}</span>
          )}
          {job.status === "saved" && <span className="repo-status-dot saved" title="Salvo" />}
          {job.status === "draft" && <span className="repo-status-dot draft" title="Draft não salvo" />}
        </div>
      </div>
    );
  };

  const renderFolder = (folder: FolderData, depth: number) => {
    const isExpanded = folder.expanded;
    const children = getChildFolders(folder.id);
    const jobs = getFolderJobs(folder.id);
    const isRenaming = renaming?.id === folder.id;
    const isCreatingInside =
      creating && creating.parentId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className="repo-item repo-folder"
          style={{ paddingLeft: depth * 16 + 4 }}
          onClick={() => jobStore.toggleFolderExpanded(folder.id)}
          onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
        >
          <span className="repo-chevron">
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {isExpanded ? (
            <FolderOpen size={14} className="repo-folder-icon" />
          ) : (
            <Folder size={14} className="repo-folder-icon" />
          )}
          {isRenaming ? (
            renderInlineInput(
              renaming!.value,
              commitRename,
              (v) => setRenaming((r) => r ? { ...r, value: v } : r)
            )
          ) : (
            <span className="repo-item-label">{folder.name}</span>
          )}
          <span className="repo-item-count">{jobs.length + children.length}</span>
        </div>

        {isExpanded && (
          <div>
            {children.map((child) => renderFolder(child, depth + 1))}
            {jobs.map((job) => renderJob(job, depth + 1))}
            {isCreatingInside && creating!.type === "folder" && (
              <div
                className="repo-item repo-folder"
                style={{ paddingLeft: (depth + 1) * 16 + 4 }}
              >
                <span className="repo-chevron"><ChevronRight size={12} /></span>
                <Folder size={14} className="repo-folder-icon" />
                {renderInlineInput(
                  creating!.value,
                  commitCreate,
                  (v) => setCreating((c) => c ? { ...c, value: v } : c)
                )}
              </div>
            )}
            {isCreatingInside && creating!.type === "job" && (
              <div
                className="repo-item repo-job"
                style={{ paddingLeft: (depth + 1) * 16 + 8 }}
              >
                <Zap size={13} className="repo-job-icon" />
                {renderInlineInput(
                  creating!.value,
                  commitCreate,
                  (v) => setCreating((c) => c ? { ...c, value: v } : c)
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="job-repository" id="job-repository">
      {/* Header */}
      <div className="repo-header">
        <div className="repo-header-title">
          <FileCode2 size={14} />
          <span>Repositório</span>
        </div>
        <div className="repo-header-actions">
          <button
            className="repo-action-btn"
            title="Novo Job"
            onClick={() => startCreate("job", state.folders.find((f) => f.parentId === null)?.id ?? "folder-root")}
          >
            <Plus size={13} />
          </button>
          <button
            className="repo-action-btn"
            title="Nova Pasta"
            onClick={() => startCreate("folder", state.folders.find((f) => f.parentId === null)?.id ?? "folder-root")}
          >
            <FolderPlus size={13} />
          </button>
          <button
            className="repo-action-btn"
            title="Importar Job (.rdf.json)"
            onClick={() => handleTriggerImport()}
          >
            <Upload size={13} />
          </button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.rdf.json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Tree */}
      <div className="repo-tree" onClick={closeContextMenu}>
        {getRootFolders().map((folder) => renderFolder(folder, 0))}
        {state.jobs.filter((j) => !state.folders.find((f) => f.id === j.folderId)).map((job) =>
          renderJob(job, 0)
        )}
        {state.folders.length === 0 && state.jobs.length === 0 && (
          <div className="repo-empty">
            <Zap size={24} opacity={0.3} />
            <p>Nenhum job criado</p>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                onClick={() => startCreate("job", "folder-root")}
              >
                + Criar Job
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                onClick={() => handleTriggerImport()}
              >
                <Upload size={12} /> Importar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="ctx-overlay" onClick={closeContextMenu} />
          <div
            className="ctx-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "folder" && (
              <>
                <button
                  className="ctx-menu-item"
                  onClick={() => startCreate("job", contextMenu.id)}
                >
                  <Plus size={13} /> Novo Job aqui
                </button>
                <button
                  className="ctx-menu-item"
                  onClick={() => startCreate("folder", contextMenu.id)}
                >
                  <FolderPlus size={13} /> Nova Subpasta
                </button>
                <button
                  className="ctx-menu-item"
                  onClick={() => {
                    handleTriggerImport(contextMenu.id);
                    closeContextMenu();
                  }}
                >
                  <Upload size={13} /> Importar Job nesta pasta
                </button>
                <div className="ctx-divider" />
                <button
                  className="ctx-menu-item"
                  onClick={() => {
                    const folder = state.folders.find((f) => f.id === contextMenu.id);
                    if (folder) startRename(folder.id, folder.name);
                  }}
                >
                  <Pencil size={13} /> Renomear
                </button>
                <button
                  className="ctx-menu-item danger"
                  onClick={handleDelete}
                >
                  <Trash2 size={13} /> Excluir Pasta
                </button>
              </>
            )}
            {contextMenu.type === "job" && (
              <>
                <button
                  className="ctx-menu-item"
                  onClick={() => { onOpenJob(contextMenu.id); closeContextMenu(); }}
                >
                  <Zap size={13} /> Abrir Job
                </button>
                <div className="ctx-divider" />
                <button
                  className="ctx-menu-item"
                  onClick={() => {
                    const job = state.jobs.find((j) => j.id === contextMenu.id);
                    if (job) startRename(job.id, job.name);
                  }}
                >
                  <Pencil size={13} /> Renomear
                </button>
                <button
                  className="ctx-menu-item danger"
                  onClick={handleDelete}
                >
                  <Trash2 size={13} /> Excluir Job
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
