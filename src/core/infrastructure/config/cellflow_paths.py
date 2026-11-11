"""Configuração centralizada de caminhos e diretórios do CellFlow (Fase 3 - TASK-031).

Garante que todos os arquivos criados em tempo de execução (artefatos, políticas,
bancos SQLite/DuckDB, logs e workspaces) residam dentro de CELLFLOW_HOME ou no
workspace ativo do usuário, evitando qualquer poluição do cwd ou diretório do projeto.
"""

import os
import sys
from pathlib import Path
from typing import Optional


def get_cellflow_home() -> Path:
    """Retorna o diretório base do CellFlow.

    Prioridade:
    1. Variável de ambiente CELLFLOW_HOME
    2. %APPDATA%/CellFlow (no Windows) ou ~/.cellflow (Linux/macOS)
    """
    env_home = os.environ.get("CELLFLOW_HOME")
    if env_home and env_home.strip():
        home_path = Path(env_home.strip()).resolve()
    elif sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        if app_data and app_data.strip():
            home_path = Path(app_data.strip()) / "CellFlow"
        else:
            home_path = Path.home() / "AppData" / "Roaming" / "CellFlow"
    else:
        home_path = Path.home() / ".cellflow"

    home_path.mkdir(parents=True, exist_ok=True)
    return home_path


def get_cellflow_subpath(subfolder: str) -> Path:
    """Garante e retorna uma subpasta padronizada dentro de CELLFLOW_HOME.

    Subpastas canônicas: artifacts, policies, logs, db, workspaces.
    """
    target = get_cellflow_home() / subfolder
    target.mkdir(parents=True, exist_ok=True)
    return target


def get_default_workspace_dir() -> Path:
    """Retorna o diretório do workspace neutro padrão.

    Caminho canônico: Documentos/CellFlow/Workspaces/Meu Workspace
    Permite sobrescrita via variável CELLFLOW_WORKSPACE.
    """
    env_ws = os.environ.get("CELLFLOW_WORKSPACE")
    if env_ws and env_ws.strip():
        p = Path(env_ws.strip()).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    if sys.platform == "win32":
        docs = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents"
    else:
        docs = Path.home() / "Documents"

    if not docs.exists():
        docs = Path.home()

    default_ws = docs / "CellFlow" / "Workspaces" / "Meu Workspace"
    default_ws.mkdir(parents=True, exist_ok=True)
    return default_ws

