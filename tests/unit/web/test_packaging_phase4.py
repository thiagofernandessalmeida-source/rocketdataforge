"""Testes Unitários para a Fase 4 - Empacotamento Standalone e Especificações (TASK-041)."""

import json
import os
import re
from pathlib import Path


def test_pyinstaller_spec_structure_and_inclusions():
    """4.1: Valida se packaging/backend.spec define onedir, includes e entrypoint corretos."""
    spec_path = Path("packaging/backend.spec")
    assert spec_path.is_file(), "Arquivo packaging/backend.spec deve existir"

    content = spec_path.read_text(encoding="utf-8")
    assert "name=\"cellflow-backend\"" in content or "name='cellflow-backend'" in content
    assert "exclude_binaries=True" in content, "Deve ser onedir (exclude_binaries=True no EXE e COLLECT)"
    assert "COLLECT(" in content
    assert "duckdb" in content
    assert "polars" in content
    assert "pydantic_core" in content
    assert "sqlglot" in content


def test_electron_main_and_preload_hardening():
    """4.2 e 4.3: Valida segurança do Electron (token aleatório, webSecurity estrito, contextBridge)."""
    main_js_path = Path("ui/electron/main.cjs")
    assert main_js_path.is_file()
    main_content = main_js_path.read_text(encoding="utf-8")

    assert "webSecurity: true" in main_content, "webSecurity deve ser estritamente true"
    assert "webSecurity: false" not in main_content
    assert "crypto.randomBytes(32).toString(\"hex\")" in main_content or "randomBytes" in main_content
    assert "taskkill" in main_content
    assert "cellflow-backend" in main_content

    preload_path = Path("ui/electron/preload.cjs")
    assert preload_path.is_file()
    preload_content = preload_path.read_text(encoding="utf-8")
    assert "window.cellflow" in preload_content or "exposeInMainWorld(\"cellflow\"" in preload_content


def test_package_json_electron_builder_and_scripts():
    """4.4: Valida scripts dist:win, dist:mac, dist:linux e configuração do electron-builder."""
    pkg_path = Path("ui/package.json")
    assert pkg_path.is_file()
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    scripts = pkg.get("scripts", {})
    assert "dist:win" in scripts
    assert "dist:mac" in scripts
    assert "dist:linux" in scripts

    build = pkg.get("build", {})
    assert build.get("appId") == "com.cellflow.datastudio"
    assert build.get("productName") == "CellFlow Data Studio"
    assert "nsis" in build.get("win", {}).get("target", [])
    assert "dmg" in build.get("mac", {}).get("target", [])
    assert "AppImage" in build.get("linux", {}).get("target", [])


def test_ci_workflow_and_smoke_test_checklist():
    """4.5 e 4.6: Valida existência do workflow CI e do checklist de smoke test."""
    ci_path = Path(".github/workflows/build.yml")
    assert ci_path.is_file()
    ci_content = ci_path.read_text(encoding="utf-8")
    assert "windows-latest" in ci_content
    assert "macos-latest" in ci_content
    assert "ubuntu-latest" in ci_content

    checklist_path = Path("SMOKE_TEST_CHECKLIST.md")
    assert checklist_path.is_file()
    chk_content = checklist_path.read_text(encoding="utf-8")
    assert "Smoke Test" in chk_content
    assert "cellflow-backend" in chk_content
