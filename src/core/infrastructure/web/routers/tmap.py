"""Endpoints para o Data Mapper (tMap) e validação de expressões."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.core.application.compiler.expressions.compiler import validate_expression

router = APIRouter(tags=["tMap & Expressions"])


class ValidateExpressionRequest(BaseModel):
    expression: str = Field(..., description="Expressão Java-like do tMap a ser validada")
    alias_map: Optional[Dict[str, Dict[str, Any]]] = Field(default=None, description="Mapeamento de aliases e colunas")
    vars_map: Optional[Dict[str, str]] = Field(default=None, description="Mapeamento de variáveis intermediárias")
    known_columns: Optional[List[str]] = Field(default=None, description="Lista de colunas conhecidas")


class ValidateExpressionResponse(BaseModel):
    valid: bool
    sql: Optional[str] = None
    error: Optional[str] = None


@router.post("/tmap/validate-expression", response_model=ValidateExpressionResponse)
def validate_tmap_expression(req: ValidateExpressionRequest) -> ValidateExpressionResponse:
    """Valida sintaticamente uma expressão do tMap em tempo real e retorna a prévia SQL."""
    result = validate_expression(
        expr=req.expression,
        alias_map=req.alias_map,
        vars_map=req.vars_map,
        known_columns=req.known_columns
    )
    return ValidateExpressionResponse(
        valid=result["valid"],
        sql=result.get("sql"),
        error=result.get("error")
    )
