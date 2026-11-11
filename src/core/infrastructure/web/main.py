"""Ponto de entrada para o servidor Uvicorn da API REST do Control Plane (Fase 3 - TASK-031)."""

import argparse
import os
import uvicorn
from src.core.infrastructure.web.app import app


def parse_args():
    parser = argparse.ArgumentParser(description="CellFlow Data Studio - Control Plane Backend")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("CELLFLOW_PORT", "8000")),
        help="Porta TCP do servidor (padrão: 8000)"
    )
    parser.add_argument(
        "--token",
        type=str,
        default=os.environ.get("CELLFLOW_TOKEN", ""),
        help="Token de autenticação exigido via header X-CellFlow-Token"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.token:
        os.environ["CELLFLOW_TOKEN"] = args.token.strip()

    # host forçado estritamente para 127.0.0.1 (nunca 0.0.0.0), sem reload, passando o objeto app (3.1)
    uvicorn.run(app, host="127.0.0.1", port=args.port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
