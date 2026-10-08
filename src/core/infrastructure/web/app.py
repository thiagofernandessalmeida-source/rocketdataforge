"""Aplicação FastAPI do Control Plane do RocketDataForge (TASK-022, TASK-023)."""

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
        ],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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

    @app.get("/health", tags=["Health"])
    @app.get("/api/v1/health", tags=["Health"])
    def health_check():
        return {"status": "healthy", "service": "RocketDataForge Control Plane"}

    # Inclusão dos routers com prefixo canônico /api/v1 e sem prefixo para conveniência
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
    ]

    for r in api_routers:
        app.include_router(r, prefix="/api/v1")
        app.include_router(r)

    return app


app = create_app()
