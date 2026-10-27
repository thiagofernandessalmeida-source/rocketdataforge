from dataclasses import dataclass
from typing import Any, List, Optional


class ASTNode:
    """Nó base da Árvore de Sintaxe Abstrata (AST) de expressões."""
    pass


@dataclass
class LiteralNode(ASTNode):
    """Representa literais: números, strings, booleanos ou null."""
    value: Any
    literal_type: str  # 'string', 'number', 'boolean', 'null'


@dataclass
class IdentifierNode(ASTNode):
    """Representa um identificador simples (nome de coluna, variável ou token)."""
    name: str


@dataclass
class QualifiedIdentifierNode(ASTNode):
    """Representa identificadores compostos por ponto (ex: row1.name, Var.v1, {{alias.col}})."""
    parts: List[str]

    @property
    def full_name(self) -> str:
        return ".".join(self.parts)


@dataclass
class UnaryOpNode(ASTNode):
    """Representa operadores unários (ex: !, -, +)."""
    op: str
    operand: ASTNode


@dataclass
class BinaryOpNode(ASTNode):
    """Representa operadores binários (==, !=, <, <=, >, >=, &&, ||, +, -, *, /, %)."""
    left: ASTNode
    op: str
    right: ASTNode


@dataclass
class TernaryNode(ASTNode):
    """Representa o operador ternário condicional (cond ? expr_true : expr_false)."""
    condition: ASTNode
    true_expr: ASTNode
    false_expr: ASTNode


@dataclass
class FunctionCallNode(ASTNode):
    """Representa chamadas a funções ou rotinas estáticas (ex: StringHandling.UPCASE(x), UPPER(x))."""
    name: str
    args: List[ASTNode]


@dataclass
class MethodCallNode(ASTNode):
    """Representa chamadas a métodos em objetos (ex: row1.id.toString())."""
    object_expr: ASTNode
    method_name: str
    args: List[ASTNode]


@dataclass
class GroupNode(ASTNode):
    """Representa uma expressão agrupada entre parênteses (expr)."""
    expression: ASTNode
