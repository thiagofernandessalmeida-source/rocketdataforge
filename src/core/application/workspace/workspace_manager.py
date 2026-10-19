"""Gerenciador de Workspaces Locais do CellFlow Data Studio.

Controla a pasta de trabalho ativa do usuário, garantindo a recuperação e persistência
de Jobs, Conexões (Connection Store), Banco de Queries (Query Store) e arquivos de dados
(DuckDB, CSV, Parquet, etc.) na máquina local, independente de onde o Studio for executado.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional


class WorkspaceManager:
    """Gerencia workspaces locais no sistema de arquivos do usuário."""

    def __init__(self, config_dir: Optional[str] = None):
        self.config_dir = config_dir or os.path.join(os.path.expanduser("~"), ".cellflow")
        self.config_file = os.path.join(self.config_dir, "workspaces.json")
        self._ensure_config_dir()

    def _ensure_config_dir(self) -> None:
        try:
            os.makedirs(self.config_dir, exist_ok=True)
        except Exception:
            pass

    def get_default_workspace_path(self) -> str:
        """Retorna o caminho padrão do workspace na pasta do usuário."""
        env_ws = os.environ.get("CELLFLOW_WORKSPACE")
        if env_ws and env_ws.strip():
            return os.path.abspath(env_ws.strip())

        # Se existir harmonizacao_brasil na máquina ou no repositório, usa como padrão prioritário
        candidate_natura = r"C:\Natura\harmonizacao_brasil"
        if os.path.isdir(candidate_natura):
            return os.path.abspath(candidate_natura)

        candidate_repo = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "workspaces", "harmonizacao_brasil")
        )
        if os.path.isdir(candidate_repo):
            return os.path.abspath(candidate_repo)

        return os.path.join(os.path.expanduser("~"), "harmonizacao_brasil")

    def _load_config(self) -> Dict[str, Any]:
        """Carrega a configuração global de workspaces."""
        default_path = self.get_default_workspace_path()
        recent_candidates = [default_path]
        candidate_repo = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "workspaces", "harmonizacao_brasil")
        )
        if os.path.isdir(candidate_repo) and candidate_repo not in recent_candidates:
            recent_candidates.append(candidate_repo)
        candidate_natura = r"C:\Natura\harmonizacao_brasil"
        if os.path.isdir(candidate_natura) and candidate_natura not in recent_candidates:
            recent_candidates.append(candidate_natura)

        if os.path.isfile(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    recent = data.get("recent_workspaces", [])
                    for rc in recent_candidates:
                        if rc not in recent:
                            recent.append(rc)
                    data["recent_workspaces"] = recent
                    if not data.get("active_workspace"):
                        data["active_workspace"] = default_path
                    return data
            except Exception:
                pass
        return {
            "active_workspace": default_path,
            "recent_workspaces": recent_candidates,
        }

    def _save_config(self, cfg: Dict[str, Any]) -> None:
        """Salva a configuração global de workspaces."""
        self._ensure_config_dir()
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    def get_active_workspace_path(self) -> str:
        """Retorna o caminho absoluto do workspace ativo atual."""
        cfg = self._load_config()
        active = cfg.get("active_workspace") or self.get_default_workspace_path()
        return os.path.abspath(active)

    def ensure_workspace_structure(self, workspace_path: Optional[str] = None) -> str:
        """Garante que a estrutura de pastas do workspace exista no disco."""
        raw = str(workspace_path or self.get_active_workspace_path()).strip().strip('"\'')
        ws_path = os.path.abspath(raw)
        os.makedirs(ws_path, exist_ok=True)
        os.makedirs(os.path.join(ws_path, "jobs"), exist_ok=True)
        os.makedirs(os.path.join(ws_path, "connections"), exist_ok=True)
        os.makedirs(os.path.join(ws_path, "queries"), exist_ok=True)
        os.makedirs(os.path.join(ws_path, "data"), exist_ok=True)

        meta_file = os.path.join(ws_path, "workspace.json")
        if not os.path.isfile(meta_file):
            meta = {
                "name": os.path.basename(ws_path) or "CellFlow_Workspace",
                "path": ws_path,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "lastOpenedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            try:
                with open(meta_file, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

        return ws_path

    def get_workspace_info(self, workspace_path: Optional[str] = None, path: Optional[str] = None, **kwargs: Any) -> Dict[str, Any]:
        """Retorna informações detalhadas do workspace."""
        target_path = path or workspace_path or kwargs.get("workspace_path") or kwargs.get("path")
        ws_path = self.ensure_workspace_structure(target_path)
        meta_file = os.path.join(ws_path, "workspace.json")
        name = os.path.basename(ws_path)

        if os.path.isfile(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    name = meta.get("name") or name
            except Exception:
                pass

        # Contagem de itens
        jobs_file = os.path.join(ws_path, "jobs", "jobs.json")
        jobs_count = 0
        if os.path.isfile(jobs_file):
            try:
                with open(jobs_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    jobs_count = len(data if isinstance(data, list) else data.get("jobs", []))
            except Exception:
                pass

        conn_file = os.path.join(ws_path, "connections", "connections.json")
        conn_count = 0
        if os.path.isfile(conn_file):
            try:
                with open(conn_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    conn_count = len(data if isinstance(data, list) else data.get("connections", []))
            except Exception:
                pass

        qry_file = os.path.join(ws_path, "queries", "queries.json")
        qry_count = 0
        if os.path.isfile(qry_file):
            try:
                with open(qry_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    qry_count = len(data if isinstance(data, list) else data.get("queries", []))
            except Exception:
                pass

        cfg = self._load_config()
        recent = cfg.get("recent_workspaces", [ws_path])
        if ws_path not in recent:
            recent.insert(0, ws_path)

        return {
            "name": name,
            "path": ws_path,
            "dataDir": os.path.join(ws_path, "data"),
            "jobsDir": os.path.join(ws_path, "jobs"),
            "connectionsDir": os.path.join(ws_path, "connections"),
            "queriesDir": os.path.join(ws_path, "queries"),
            "jobsCount": jobs_count,
            "connectionsCount": conn_count,
            "queriesCount": qry_count,
            "recentWorkspaces": recent,
        }

    def set_active_workspace(
        self,
        workspace_path: Optional[str] = None,
        path: Optional[str] = None,
        name: Optional[str] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        """Altera o workspace ativo e o salva no histórico de recentes."""
        target_path = path or workspace_path or kwargs.get("workspace_path") or kwargs.get("path")
        if not target_path or not str(target_path).strip():
            raise ValueError("Caminho do workspace é obrigatório.")

        clean_path = str(target_path).strip().strip('"\'')
        abs_path = os.path.abspath(clean_path)
        self.ensure_workspace_structure(abs_path)

        resolved_name = name or kwargs.get("name")
        if resolved_name:
            clean_name = str(resolved_name).strip().strip('"\'')
            meta_file = os.path.join(abs_path, "workspace.json")
            try:
                meta = {}
                if os.path.isfile(meta_file):
                    with open(meta_file, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                meta["name"] = clean_name
                meta["path"] = abs_path
                meta["lastOpenedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                with open(meta_file, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

        cfg = self._load_config()
        cfg["active_workspace"] = abs_path
        recent = cfg.get("recent_workspaces", [])
        if abs_path in recent:
            recent.remove(abs_path)
        recent.insert(0, abs_path)
        cfg["recent_workspaces"] = recent[:10]
        self._save_config(cfg)

        return self.get_workspace_info(abs_path)

    def resolve_duckdb_path(self, raw_path: Optional[str]) -> str:
        """Resolve o caminho do arquivo DuckDB dentro do workspace ativo ou caminho absoluto."""
        if not raw_path or not str(raw_path).strip():
            raw_path = "data/output.duckdb"

        p_str = str(raw_path).strip().strip("'\"")
        if p_str == ":memory:":
            return ":memory:"

        # Se for caminho absoluto (ex: C:\..., D:\..., \\..., /...), respeita diretamente
        if os.path.isabs(p_str) or (len(p_str) > 1 and p_str[1] == ":"):
            abs_resolved = os.path.abspath(p_str)
            os.makedirs(os.path.dirname(abs_resolved), exist_ok=True)
            return abs_resolved

        ws_path = self.ensure_workspace_structure()
        clean = p_str.replace("\\", "/")

        # Se o usuário digitou caminho com subpasta (ex: "data/...", "custom/...")
        # Resolve relativo à raiz do workspace ativo
        if "/" in clean:
            resolved = os.path.abspath(os.path.join(ws_path, clean))
        else:
            # Se digitou apenas o nome do arquivo (ex: "meu_banco.duckdb"),
            # salva na pasta 'data' do workspace ativo
            data_dir = os.path.join(ws_path, "data")
            os.makedirs(data_dir, exist_ok=True)
            resolved = os.path.abspath(os.path.join(data_dir, clean))

        os.makedirs(os.path.dirname(resolved), exist_ok=True)
        return resolved

    def browse_native_folder(self, initial_dir: Optional[str] = None) -> Optional[str]:
        """Abre a janela nativa do SO (Windows / macOS / Linux) para o usuário escolher uma pasta."""
        import subprocess
        import sys

        clean_initial = str(initial_dir).strip().strip('"\'') if initial_dir else ""
        init_dir = os.path.abspath(clean_initial) if clean_initial and os.path.isdir(clean_initial) else ""
        if not init_dir:
            init_dir = self.get_active_workspace_path()

        # 1. Tenta via tkinter askdirectory em processo isolado
        picker_code = (
            "import tkinter\n"
            "from tkinter import filedialog\n"
            "try:\n"
            "    root = tkinter.Tk()\n"
            "    root.withdraw()\n"
            "    root.attributes('-topmost', True)\n"
            f"    folder = filedialog.askdirectory(title='Selecione a Pasta Raiz do Workspace', initialdir={repr(init_dir)})\n"
            "    root.destroy()\n"
            "    if folder:\n"
            "        print(folder.strip())\n"
            "except Exception:\n"
            "    pass\n"
        )

        try:
            res = subprocess.run(
                [sys.executable, "-c", picker_code],
                capture_output=True,
                text=True,
                timeout=180,
            )
            out = res.stdout.strip()
            if out and os.path.isdir(out):
                return os.path.normpath(out)
        except Exception:
            pass

        # 2. Fallback PowerShell FolderBrowserDialog no Windows
        if os.name == "nt":
            ps_script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$f.Description = 'Selecione a Pasta Raiz do Workspace'; "
                f"$f.SelectedPath = '{init_dir}'; "
                "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"
            )
            try:
                res_ps = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True,
                    text=True,
                    timeout=180,
                )
                out_ps = res_ps.stdout.strip()
                if out_ps and os.path.isdir(out_ps):
                    return os.path.normpath(out_ps)
            except Exception:
                pass

        return None

    def load_workspace_state(self) -> Dict[str, Any]:
        """Carrega jobs, conexões e queries do workspace ativo."""
        ws_path = self.ensure_workspace_structure()
        state: Dict[str, Any] = {
            "workspace": self.get_workspace_info(ws_path),
            "jobs": [],
            "activeJobId": None,
            "connections": [],
            "queryBank": [],
        }

        # 1. Carrega Jobs
        jobs_file = os.path.join(ws_path, "jobs", "jobs.json")
        if os.path.isfile(jobs_file):
            try:
                with open(jobs_file, "r", encoding="utf-8") as f:
                    content = json.load(f)
                    if isinstance(content, dict):
                        state["jobs"] = content.get("jobs", [])
                        state["activeJobId"] = content.get("activeJobId")
                    elif isinstance(content, list):
                        state["jobs"] = content
                        if content:
                            state["activeJobId"] = content[0].get("id")
            except Exception:
                pass

        # 2. Carrega Conexões
        conn_file = os.path.join(ws_path, "connections", "connections.json")
        if os.path.isfile(conn_file):
            try:
                with open(conn_file, "r", encoding="utf-8") as f:
                    content = json.load(f)
                    state["connections"] = content if isinstance(content, list) else content.get("connections", [])
            except Exception:
                pass

        # 3. Carrega Queries
        qry_file = os.path.join(ws_path, "queries", "queries.json")
        if os.path.isfile(qry_file):
            try:
                with open(qry_file, "r", encoding="utf-8") as f:
                    content = json.load(f)
                    state["queryBank"] = content if isinstance(content, list) else content.get("queries", [])
            except Exception:
                pass

        return state

    def save_workspace_state(self, payload: Dict[str, Any]) -> bool:
        """Salva jobs, conexões e queries no workspace ativo em disco."""
        ws_path = self.ensure_workspace_structure()

        # 1. Salva Jobs
        if "jobs" in payload:
            jobs_payload = {
                "activeJobId": payload.get("activeJobId"),
                "jobs": payload["jobs"],
                "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            jobs_file = os.path.join(ws_path, "jobs", "jobs.json")
            try:
                with open(jobs_file, "w", encoding="utf-8") as f:
                    json.dump(jobs_payload, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

            # Salva também cópia individual de cada Job para facilidade de inspeção
            for j in payload["jobs"]:
                jid = j.get("id")
                if jid:
                    clean_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in str(jid))
                    single_job_file = os.path.join(ws_path, "jobs", f"{clean_id}.json")
                    try:
                        with open(single_job_file, "w", encoding="utf-8") as f:
                            json.dump(j, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass

        # 2. Salva Conexões
        if "connections" in payload:
            conn_file = os.path.join(ws_path, "connections", "connections.json")
            try:
                with open(conn_file, "w", encoding="utf-8") as f:
                    json.dump(payload["connections"], f, indent=2, ensure_ascii=False)
            except Exception:
                pass

        # 3. Salva Queries
        if "queryBank" in payload or "queries" in payload:
            queries_data = payload.get("queryBank") if "queryBank" in payload else payload.get("queries")
            qry_file = os.path.join(ws_path, "queries", "queries.json")
            try:
                with open(qry_file, "w", encoding="utf-8") as f:
                    json.dump(queries_data, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

        # 4. Atualiza metadata do workspace
        meta_file = os.path.join(ws_path, "workspace.json")
        try:
            meta = {}
            if os.path.isfile(meta_file):
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            meta["lastOpenedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            with open(meta_file, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

        return True


workspace_manager = WorkspaceManager()
