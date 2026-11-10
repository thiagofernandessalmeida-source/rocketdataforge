from typing import Any, Dict, List, Optional
from src.core.application.compiler.expressions.lexer import Lexer, LexerError
from src.core.application.compiler.expressions.parser import Parser, ParserError
from src.core.application.compiler.expressions.duckdb_visitor import DuckDBSqlVisitor


def compile_expression(
    expr: str,
    alias_map: Optional[Dict[str, Dict[str, Any]]] = None,
    vars_map: Optional[Dict[str, str]] = None,
    known_columns: Optional[List[str]] = None
) -> str:
    """Compila uma expressão Java-like do tMap em SQL compatível com DuckDB via AST."""
    if not expr or not expr.strip():
        return "NULL"

    s = expr.strip()

    lexer = Lexer(s)
    tokens = lexer.tokenize()

    parser = Parser(tokens)
    ast = parser.parse()

    visitor = DuckDBSqlVisitor(
        alias_map=alias_map,
        vars_map=vars_map,
        known_columns=known_columns
    )
    return visitor.visit(ast)


def validate_expression(
    expr: str,
    alias_map: Optional[Dict[str, Dict[str, Any]]] = None,
    vars_map: Optional[Dict[str, str]] = None,
    known_columns: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Valida sintaticamente uma expressão do tMap e retorna a prévia compilada ou o erro."""
    if not expr or not expr.strip():
        return {"valid": True, "sql": "NULL", "error": None}

    try:
        sql = compile_expression(
            expr,
            alias_map=alias_map,
            vars_map=vars_map,
            known_columns=known_columns
        )
        return {"valid": True, "sql": sql, "error": None}
    except (LexerError, ParserError) as e:
        return {"valid": False, "sql": None, "error": str(e)}
    except Exception as e:
        return {"valid": False, "sql": None, "error": f"Erro de compilação: {str(e)}"}
