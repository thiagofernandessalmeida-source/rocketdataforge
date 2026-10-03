"""Ponto de entrada para o servidor Uvicorn da API REST do Control Plane."""

import uvicorn
from src.core.infrastructure.web.app import app

if __name__ == "__main__":
    uvicorn.run("src.core.infrastructure.web.main:app", host="0.0.0.0", port=8000, reload=True)
