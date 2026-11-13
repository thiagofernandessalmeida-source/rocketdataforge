"""Aplicação FastAPI do Control Plane do RocketDataForge (TASK-022, TASK-023, TASK-031)."""

import os
import sys
from pathlib import Path
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from src.core.domain.shared.exceptions import (
    DomainError,
    DomainValidationError,
    SecurityViolationError,
)
from src.core.infrastructure.web.routers import (
    autodoc,
    catalog,
    connections,
    executions,
    git,
    pipelines,
    policies,
    schedules,
    tmap,
    versions,
    workspaces,
)



def create_app() -> FastAPI:
    """Fábrica para criação e configuração da aplicação FastAPI."""
    app = FastAPI(
        title="RocketDataForge Control Plane API",
        version="1.0.0",
        description=(
            "API REST para o Control Plane do RocketDataForge. "
            "Gerencia workspaces, projetos, conexões, catálogo de componentes, "
            "criação de drafts, validação, compilação de planos e execução local."
        ),
        docs_url="/docs",
        redoc_url="/redoc"
    )

    # Middleware CORS para integração segura com o Frontend React Designer
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "http://127.0.0.1:5175",
            "null",
            "file://",
        ],
        allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:[0-9]+)?|file://.*|null)$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Middleware de Autenticação por Token (Fase 3.1)
    @app.middleware("http")
    async def cellflow_token_auth_middleware(request: Request, call_next):
        # Requisições OPTIONS (pre-flight CORS) sempre liberadas
        if request.method == "OPTIONS":
            return await call_next(request)

        expected_token = os.environ.get("CELLFLOW_TOKEN", "").strip()
        if expected_token:
            path = request.url.path
            # Rotas isentas de autenticação: health check, docs e assets estáticos
            is_exempt = (
                path in ("/api/v1/health", "/health", "/docs", "/redoc", "/openapi.json")
                or path.startswith("/assets/")
                or path.startswith("/favicon.")
            )
            if not is_exempt:
                received_token = request.headers.get("X-CellFlow-Token", "").strip()
                if received_token != expected_token:
                    return JSONResponse(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        content={"error": "ERR_UNAUTHORIZED", "message": "Token de autenticação X-CellFlow-Token inválido ou não fornecido."}
                    )

        return await call_next(request)

    # Handlers para tratamento canônico de exceções de domínio
    @app.exception_handler(DomainValidationError)
    async def domain_validation_exception_handler(request: Request, exc: DomainValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": exc.code or "ERR_VALIDATION", "message": exc.message}
        )

    @app.exception_handler(SecurityViolationError)
    async def security_violation_exception_handler(request: Request, exc: SecurityViolationError):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "ERR_SECURITY_VIOLATION", "message": exc.message}
        )

    @app.exception_handler(DomainError)
    async def domain_error_exception_handler(request: Request, exc: DomainError):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": exc.code or "ERR_DOMAIN", "message": exc.message}
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        import logging
        import traceback
        logging.getLogger("uvicorn.error").error(
            f"Exceção não tratada na rota {request.url.path}: {exc}\n{traceback.format_exc()}"
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "ERR_INTERNAL_SERVER_ERROR", "detail": str(exc), "message": str(exc)}
        )

    @app.get("/health", tags=["Health"])
    @app.get("/api/v1/health", tags=["Health"])
    def health_check():
        from src.core.infrastructure.execution.warmup import is_backend_warm, get_warmup_details
        return {
            "status": "healthy",
            "service": "RocketDataForge Control Plane",
            "warm": is_backend_warm(),
            "warmup_details": get_warmup_details()
        }

    api_routers = [
        workspaces.router,
        connections.router,
        catalog.router,
        pipelines.router,
        versions.router,
        executions.router,
        git.router,
        policies.router,
        autodoc.router,
        tmap.router,
        schedules.router,
    ]

    for r in api_routers:
        app.include_router(r, prefix="/api/v1")
        app.include_router(r)

    # Servir build estático de produção do frontend React (Fase 3.4)
    base_repo_dir = Path(__file__).resolve().parent.parent.parent.parent
    ui_dist_dir = Path(os.environ.get("CELLFLOW_UI_DIST", str(base_repo_dir / "ui" / "dist")))
    if not ui_dist_dir.is_dir():
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            ui_dist_dir = Path(meipass) / "ui" / "dist"

    if ui_dist_dir.is_dir():
        assets_folder = ui_dist_dir / "assets"
        if assets_folder.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_folder)), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa_frontend(full_path: str):
            # Rotas de API e docs nunca devem cair no fallback SPA
            if full_path.startswith("api/") or full_path in ("health", "docs", "redoc", "openapi.json"):
                return JSONResponse(status_code=404, content={"detail": "Not Found"})
            file_candidate = ui_dist_dir / full_path
            if file_candidate.is_file():
                return FileResponse(file_candidate)
            index_candidate = ui_dist_dir / "index.html"
            if index_candidate.is_file():
                return FileResponse(index_candidate)
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

    @app.on_event("startup")
    def on_startup():
        from src.core.infrastructure.scheduler.scheduler_service import SchedulerService
        from src.core.infrastructure.execution.warmup import start_background_warmup
        try:
            start_background_warmup()
        except Exception as e:
            import logging
            logging.getLogger("uvicorn.error").warning(f"Warmup startup warning: {e}")
        try:
            SchedulerService.get_instance().start()
        except Exception as e:
            import logging
            logging.getLogger("uvicorn.error").warning(f"Scheduler startup warning: {e}")

    @app.on_event("shutdown")
    def on_shutdown():
        from src.core.infrastructure.scheduler.scheduler_service import SchedulerService
        try:
            SchedulerService.get_instance().shutdown(wait=False)
        except Exception:
            pass

    return app



app = create_app()
