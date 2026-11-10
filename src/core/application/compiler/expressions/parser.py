from typing import List, Optional
from src.core.application.compiler.expressions.lexer import Token, TokenType
from src.core.application.compiler.expressions.nodes import (
    ASTNode,
    LiteralNode,
    IdentifierNode,
    QualifiedIdentifierNode,
    UnaryOpNode,
    BinaryOpNode,
    TernaryNode,
    FunctionCallNode,
    MethodCallNode,
    GroupNode
)
from src.core.application.compiler.expressions.routines import RoutineRegistry


class ParserError(Exception):
    def __init__(self, message: str, token: Optional[Token] = None):
        pos_str = f" at position {token.position}" if token else ""
        super().__init__(f"Parser error{pos_str}: {message}")
        self.token = token


class Parser:
    """Parser descendente recursivo com precedência de operadores para expressões tMap."""

    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.pos = 0

    def _current(self) -> Token:
        return self.tokens[self.pos]

    def _peek(self, offset: int = 1) -> Token:
        idx = min(self.pos + offset, len(self.tokens) - 1)
        return self.tokens[idx]

    def _is_at_end(self) -> bool:
        return self._current().type == TokenType.EOF

    def _check(self, token_type: TokenType) -> bool:
        if self._is_at_end():
            return False
        return self._current().type == token_type

    def _advance(self) -> Token:
        tok = self._current()
        if not self._is_at_end():
            self.pos += 1
        return tok

    def _consume(self, token_type: TokenType, error_message: str) -> Token:
        if self._check(token_type):
            return self._advance()
        raise ParserError(error_message, self._current())

    def parse(self) -> ASTNode:
        expr = self._expression()
        if not self._is_at_end():
            raise ParserError(f"Tokens adicionais inesperados após expressão: '{self._current().value}'", self._current())
        return expr

    # ─── 1. Ternary Operator: cond ? expr_true : expr_false (Associativo à Direita) ───
    def _expression(self) -> ASTNode:
        return self._ternary()

    def _ternary(self) -> ASTNode:
        node = self._logical_or()

        if self._check(TokenType.QUESTION):
            self._advance()  # consome '?'
            true_expr = self._expression()
            self._consume(TokenType.COLON, "Esperado ':' no operador ternário")
            false_expr = self._ternary()  # Associativo à direita
            return TernaryNode(condition=node, true_expr=true_expr, false_expr=false_expr)

        return node

    # ─── 2. Operadores Lógicos: OR (||) e AND (&&) ───
    def _logical_or(self) -> ASTNode:
        node = self._logical_and()
        while self._check(TokenType.OR):
            op_tok = self._advance()
            right = self._logical_and()
            node = BinaryOpNode(left=node, op="||", right=right)
        return node

    def _logical_and(self) -> ASTNode:
        node = self._equality()
        while self._check(TokenType.AND):
            op_tok = self._advance()
            right = self._equality()
            node = BinaryOpNode(left=node, op="&&", right=right)
        return node

    # ─── 3. Igualdade: == e != ───
    def _equality(self) -> ASTNode:
        node = self._relational()
        while self._check(TokenType.EQ) or self._check(TokenType.NEQ):
            op_tok = self._advance()
            right = self._relational()
            node = BinaryOpNode(left=node, op=op_tok.value, right=right)
        return node

    # ─── 4. Relacionais: <, <=, >, >= ───
    def _relational(self) -> ASTNode:
        node = self._additive()
        while self._check(TokenType.LT) or self._check(TokenType.LTE) or self._check(TokenType.GT) or self._check(TokenType.GTE):
            op_tok = self._advance()
            right = self._additive()
            node = BinaryOpNode(left=node, op=op_tok.value, right=right)
        return node

    # ─── 5. Aditivos: + e - ───
    def _additive(self) -> ASTNode:
        node = self._multiplicative()
        while self._check(TokenType.PLUS) or self._check(TokenType.MINUS):
            op_tok = self._advance()
            right = self._multiplicative()
            node = BinaryOpNode(left=node, op=op_tok.value, right=right)
        return node

    # ─── 6. Multiplicativos: *, /, % ───
    def _multiplicative(self) -> ASTNode:
        node = self._unary()
        while self._check(TokenType.STAR) or self._check(TokenType.SLASH) or self._check(TokenType.PERCENT):
            op_tok = self._advance()
            right = self._unary()
            node = BinaryOpNode(left=node, op=op_tok.value, right=right)
        return node

    # ─── 7. Unários: !, -, + e Type Casting Java (ex: (String) x) ───
    def _unary(self) -> ASTNode:
        if self._check(TokenType.NOT) or self._check(TokenType.MINUS) or self._check(TokenType.PLUS):
            op_tok = self._advance()
            operand = self._unary()
            return UnaryOpNode(op=op_tok.value, operand=operand)

        # Trata casting de tipo estilo Java entre parênteses: (String) expr, (int) expr, etc.
        if self._check(TokenType.LPAREN):
            next_tok = self._peek(1)
            next_next_tok = self._peek(2)
            if (
                next_tok.type == TokenType.IDENTIFIER and
                next_tok.value.lower() in ("string", "int", "integer", "long", "double", "float", "boolean", "bool") and
                next_next_tok.type == TokenType.RPAREN
            ):
                self._advance()  # '('
                cast_type = self._advance().value  # 'String', etc.
                self._advance()  # ')'
                operand = self._unary()
                return FunctionCallNode(name=f"CAST_{cast_type.upper()}", args=[operand])

        return self._postfix()

    # ─── 8. Postfix: Acesso a membros (.) e chamadas de função/método (...) ───
    def _postfix(self) -> ASTNode:
        node = self._primary()

        while True:
            if self._check(TokenType.DOT):
                self._advance()  # consome '.'
                member_tok = self._consume(TokenType.IDENTIFIER, "Esperado nome de membro ou método após '.'")

                # Verifica se é chamada de método ou rotina estática (ex: x.toString() ou StringHandling.UPCASE())
                if self._check(TokenType.LPAREN):
                    self._advance()  # '('
                    args = self._arguments()
                    self._consume(TokenType.RPAREN, "Esperado ')' após argumentos de método")
                    if isinstance(node, (IdentifierNode, QualifiedIdentifierNode)):
                        prefix = node.name if isinstance(node, IdentifierNode) else node.full_name
                        if RoutineRegistry.is_routine(f"{prefix}.{member_tok.value}") or (prefix and prefix[0].isupper()):
                            node = FunctionCallNode(name=f"{prefix}.{member_tok.value}", args=args)
                        else:
                            node = MethodCallNode(object_expr=node, method_name=member_tok.value, args=args)
                    else:
                        node = MethodCallNode(object_expr=node, method_name=member_tok.value, args=args)
                else:
                    # Acesso a propriedade / qualificador (ex: a.b ou a.b.c)
                    if isinstance(node, IdentifierNode):
                        node = QualifiedIdentifierNode(parts=[node.name, member_tok.value])
                    elif isinstance(node, QualifiedIdentifierNode):
                        node.parts.append(member_tok.value)
                    else:
                        node = QualifiedIdentifierNode(parts=[str(node), member_tok.value])
            elif self._check(TokenType.LPAREN) and (isinstance(node, IdentifierNode) or isinstance(node, QualifiedIdentifierNode)):
                # Chamada de função pura ou rotina qualificada: func(a, b) ou Math.max(a, b)
                self._advance()  # '('
                args = self._arguments()
                self._consume(TokenType.RPAREN, "Esperado ')' após argumentos de função")
                func_name = node.full_name if isinstance(node, QualifiedIdentifierNode) else node.name
                node = FunctionCallNode(name=func_name, args=args)
            else:
                break

        return node

    def _arguments(self) -> List[ASTNode]:
        args: List[ASTNode] = []
        if not self._check(TokenType.RPAREN):
            args.append(self._expression())
            while self._check(TokenType.COMMA):
                self._advance()  # consome ','
                args.append(self._expression())
        return args

    # ─── 9. Elementos Primários ───
    def _primary(self) -> ASTNode:
        tok = self._current()

        if tok.type == TokenType.STRING:
            self._advance()
            return LiteralNode(value=tok.value, literal_type="string")

        if tok.type == TokenType.NUMBER:
            self._advance()
            val = float(tok.value) if '.' in tok.value else int(tok.value)
            return LiteralNode(value=val, literal_type="number")

        if tok.type == TokenType.BOOLEAN:
            self._advance()
            return LiteralNode(value=(tok.value.lower() == "true"), literal_type="boolean")

        if tok.type == TokenType.NULL:
            self._advance()
            return LiteralNode(value=None, literal_type="null")

        if tok.type == TokenType.IDENTIFIER:
            self._advance()
            # Se for token com ponto já empacotado (ex: {{row1.col}} ou row1.col)
            if "." in tok.value:
                parts = tok.value.split(".")
                return QualifiedIdentifierNode(parts=parts)
            return IdentifierNode(name=tok.value)

        if tok.type == TokenType.LPAREN:
            self._advance()
            expr = self._expression()
            self._consume(TokenType.RPAREN, "Esperado ')' para fechar parênteses")
            return GroupNode(expression=expr)

        raise ParserError(f"Expressão inesperada: '{tok.value}'", tok)
