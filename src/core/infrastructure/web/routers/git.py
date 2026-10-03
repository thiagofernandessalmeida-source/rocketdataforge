"""Endpoints de Integração e Observabilidade do Git (Branch Status)."""

import os
import subprocess
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Git Integration"])


class GitStatusResponse(BaseModel):
    branch: str
    clean: bool
    commit_hash: str
    commit_message: str


@router.get("/git/status", response_model=GitStatusResponse)
def get_git_status():
    """Retorna o status atual do repositório Git local (branch ativa e integridade)."""
    branch = "unknown"
    clean = True
    commit_hash = ""
    commit_message = ""

    try:
        # Branch ativa
        res_branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=3
        )
        if res_branch.returncode == 0:
            branch = res_branch.stdout.strip()

        # Status limpo ou com mudanças
        res_status = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=3
        )
        if res_status.returncode == 0:
            clean = len(res_status.stdout.strip()) == 0

        # Último commit
        res_log = subprocess.run(
            ["git", "log", "-1", "--format=%h||%s"],
            capture_output=True,
            text=True,
            timeout=3
        )
        if res_log.returncode == 0 and res_log.stdout.strip():
            parts = res_log.stdout.strip().split("||", 1)
            commit_hash = parts[0]
            commit_message = parts[1] if len(parts) > 1 else ""

    except Exception:
        # Fallback caso git não esteja no PATH ou diretório não versionado
        pass

    return GitStatusResponse(
        branch=branch,
        clean=clean,
        commit_hash=commit_hash,
        commit_message=commit_message
    )
