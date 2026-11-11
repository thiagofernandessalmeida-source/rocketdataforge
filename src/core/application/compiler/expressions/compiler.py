from typing import Any, Dict, List, Optional
from src.core.domain.shared.exceptions import DomainValidationError
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
    """Valida sintaticamente uma expressão do tMap e retorna a prévia compilada ou o erro com posição."""
    if not expr or not expr.strip():
        return {"valid": True, "sql": "NULL", "error": None, "position": None, "line": None, "column": None}

    try:
        sql = compile_expression(
            expr,
            alias_map=alias_map,
            vars_map=vars_map,
            known_columns=known_columns
        )
        return {"valid": True, "sql": sql, "error": None, "position": None, "line": None, "column": None}
    except LexerError as e:
        pos = getattr(e, "position", 0)
        return {"valid": False, "sql": None, "error": str(e), "position": pos, "line": 1, "column": pos}
    except ParserError as e:
        pos = e.token.position if getattr(e, "token", None) else 0
        return {"valid": False, "sql": None, "error": str(e), "position": pos, "line": 1, "column": pos}
    except DomainValidationError as e:
        return {"valid": False, "sql": None, "error": e.message, "position": None, "line": None, "column": None}
    except Exception as e:
        return {"valid": False, "sql": None, "error": f"Erro de compilação: {str(e)}", "position": None, "line": None, "column": None}
