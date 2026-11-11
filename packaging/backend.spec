# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller Spec para empacotar o backend FastAPI do CellFlow em modo onedir (Fase 4.1)."""

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

block_cipher = None

# Diretório raiz do projeto RocketDataForge / CellFlow
ROOT_DIR = Path(os.path.abspath(SPECPATH)).parent

datas = []
# Coleta de dados estáticos e recursos
datas += collect_data_files("sqlglot")
datas += collect_data_files("fastapi")
datas += collect_data_files("starlette")

# Se houver pasta ui/dist, pode ser incluída como recurso opcional
ui_dist = ROOT_DIR / "ui" / "dist"
if ui_dist.is_dir():
    datas.append((str(ui_dist), "ui/dist"))

binaries = []
binaries += collect_dynamic_libs("duckdb")
binaries += collect_dynamic_libs("polars")
binaries += collect_dynamic_libs("pydantic_core")

hiddenimports = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "fastapi",
    "fastapi.staticfiles",
    "duckdb",
    "polars",
    "pydantic",
    "pydantic_core",
    "sqlglot",
    "sqlalchemy",
    "apscheduler",
    "httpx",
]
hiddenimports += collect_submodules("src")
hiddenimports += collect_submodules("duckdb")
hiddenimports += collect_submodules("polars")
hiddenimports += collect_submodules("pydantic_core")
hiddenimports += collect_submodules("sqlglot")

a = Analysis(
    [str(ROOT_DIR / "src" / "core" / "infrastructure" / "web" / "main.py")],
    pathex=[str(ROOT_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cellflow-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="cellflow-backend",
)

