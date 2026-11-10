from typing import Any, Dict, List, Optional
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


class DuckDBSqlVisitor:
    """Visitor que traduz a AST de expressões Java-like para SQL compatível com DuckDB."""

    def __init__(
        self,
        alias_map: Optional[Dict[str, Dict[str, Any]]] = None,
        vars_map: Optional[Dict[str, str]] = None,
        known_columns: Optional[List[str]] = None
    ):
        self.alias_map = alias_map or {}
        self.vars_map = vars_map or {}
        self.known_columns = known_columns or []

    def visit(self, node: ASTNode) -> str:
        if isinstance(node, LiteralNode):
            return self.visit_literal(node)
        elif isinstance(node, IdentifierNode):
            return self.visit_identifier(node)
        elif isinstance(node, QualifiedIdentifierNode):
            return self.visit_qualified_identifier(node)
        elif isinstance(node, UnaryOpNode):
            return self.visit_unary(node)
        elif isinstance(node, BinaryOpNode):
            return self.visit_binary(node)
        elif isinstance(node, TernaryNode):
            return self.visit_ternary(node)
        elif isinstance(node, FunctionCallNode):
            return self.visit_function_call(node)
        elif isinstance(node, MethodCallNode):
            return self.visit_method_call(node)
        elif isinstance(node, GroupNode):
            return f"({self.visit(node.expression)})"
        else:
            raise NotImplementedError(f"Tipo de nó AST não suportado pelo visitor: {type(node).__name__}")

    def visit_literal(self, node: LiteralNode) -> str:
        if node.literal_type == "string":
            # RF-05.2: Imunidade de literais. Escapa aspas simples duplicando-as no SQL padrão
            escaped_val = str(node.value).replace("'", "''")
            return f"'{escaped_val}'"
        elif node.literal_type == "number":
            return str(node.value)
        elif node.literal_type == "boolean":
            return "TRUE" if node.value else "FALSE"
        elif node.literal_type == "null":
            return "NULL"
        return str(node.value)

    def visit_identifier(self, node: IdentifierNode) -> str:
        name = node.name
        lower_name = name.lower()

        # Verifica se é uma variável declarada (Var direta)
        if lower_name in self.vars_map:
            real_var_name = self.vars_map[lower_name]
            return f'_tmap_working."{real_var_name}"'

        # Verifica se corresponde a um alias direto ou coluna conhecida
        for alias, info in self.alias_map.items():
            col_map = info.get("columns", {})
            if lower_name in col_map:
                table_ref = info.get("table_ref", "_tmap_working")
                real_col = col_map[lower_name]
                if table_ref == "_tmap_working":
                    return f'_tmap_working."{alias.lower()}.{lower_name}"'
                else:
                    return f'{table_ref}."{real_col}"'

        return name

    def visit_qualified_identifier(self, node: QualifiedIdentifierNode) -> str:
        parts = node.parts
        if not parts:
            return ""

        # 1. Tratamento de Variáveis: Var.var_name
        if len(parts) == 2 and parts[0].lower() == "var":
            var_name = parts[1]
            return f'_tmap_working."Var.{var_name}"'

        # 2. Resolução de aliases no alias_map (ex: row1.name ou lkp_city.status)
        if len(parts) >= 2:
            alias_candidate = parts[0].lower()
            col_candidate = ".".join(parts[1:])
            col_lower = col_candidate.lower()

            if alias_candidate in self.alias_map:
                alias_info = self.alias_map[alias_candidate]
                table_ref = alias_info.get("table_ref", "_tmap_working")
                col_map = alias_info.get("columns", {})
                real_col = col_map.get(col_lower, col_candidate)

                if table_ref == "_tmap_working":
                    return f'_tmap_working."{alias_candidate}.{col_lower}"'
                else:
                    return f'{table_ref}."{real_col}"'

        # Fallback padrão
        return ".".join(parts)

    def visit_unary(self, node: UnaryOpNode) -> str:
        # Tratamento especial de negação com Relational.isNull
        if node.op == "!" and isinstance(node.operand, FunctionCallNode):
            if node.operand.name.lower() in ("relational.isnull", "isnull"):
                args_sql = [self.visit(a) for a in node.operand.args]
                if len(args_sql) == 1:
                    return f"{args_sql[0]} IS NOT NULL"

        operand_sql = self.visit(node.operand)
        if node.op == "!":
            return f"NOT ({operand_sql})"
        elif node.op in ("-", "+"):
            return f"{node.op}{operand_sql}"
        return f"{node.op}({operand_sql})"

    def visit_binary(self, node: BinaryOpNode) -> str:
        left_sql = self.visit(node.left)
        right_sql = self.visit(node.right)

        # 1. Tratamento de comparações com NULL (== null -> IS NULL, != null -> IS NOT NULL)
        is_right_null = isinstance(node.right, LiteralNode) and node.right.literal_type == "null"
        is_left_null = isinstance(node.left, LiteralNode) and node.left.literal_type == "null"

        if node.op == "==":
            if is_right_null:
                return f"{left_sql} IS NULL"
            elif is_left_null:
                return f"{right_sql} IS NULL"
            return f"{left_sql} = {right_sql}"

        if node.op == "!=":
            if is_right_null:
                return f"{left_sql} IS NOT NULL"
            elif is_left_null:
                return f"{right_sql} IS NOT NULL"
            return f"{left_sql} != {right_sql}"

        # 2. Operadores Lógicos AND (&&) e OR (||) / Concatenação SQL (||)
        if node.op == "&&":
            return f"({left_sql}) AND ({right_sql})"
        if node.op == "||":
            def is_boolean_expr(n: ASTNode) -> bool:
                if isinstance(n, BinaryOpNode):
                    if n.op in ("==", "!=", "<", "<=", ">", ">="):
                        return True
                    if n.op == "&&":
                        return True
                    if n.op == "||":
                        return is_boolean_expr(n.left) or is_boolean_expr(n.right)
                if isinstance(n, UnaryOpNode) and n.op == "!":
                    return True
                if isinstance(n, LiteralNode) and n.literal_type == "boolean":
                    return True
                if isinstance(n, GroupNode):
                    return is_boolean_expr(n.expression)
                return False

            if is_boolean_expr(node.left) or is_boolean_expr(node.right):
                return f"({left_sql}) OR ({right_sql})"
            else:
                return f"{left_sql} || {right_sql}"

        # 3. Concatenação com + vs Adição Numérica
        if node.op == "+":
            # Se qualquer um dos lados for um literal string, converte para concatenação ||
            left_is_str = isinstance(node.left, LiteralNode) and node.left.literal_type == "string"
            right_is_str = isinstance(node.right, LiteralNode) and node.right.literal_type == "string"
            left_has_quote = left_sql.startswith("'") and left_sql.endswith("'")
            right_has_quote = right_sql.startswith("'") and right_sql.endswith("'")
            is_concat = left_is_str or right_is_str or left_has_quote or right_has_quote or "||" in left_sql or "||" in right_sql

            # Heurística: se não for concatenação de string confirmada e for puramente numérico
            left_is_num = isinstance(node.left, LiteralNode) and node.left.literal_type == "number"
            right_is_num = isinstance(node.right, LiteralNode) and node.right.literal_type == "number"
            if left_is_num and right_is_num:
                is_concat = False

            if is_concat:
                return f"{left_sql} || {right_sql}"
            else:
                return f"{left_sql} + {right_sql}"

        # 4. Operadores relacionais e aritméticos padrão
        return f"{left_sql} {node.op} {right_sql}"

    def visit_ternary(self, node: TernaryNode) -> str:
        cond_sql = self.visit(node.condition)
        true_sql = self.visit(node.true_expr)
        false_sql = self.visit(node.false_expr)
        return f"CASE WHEN {cond_sql} THEN {true_sql} ELSE {false_sql} END"

    def visit_function_call(self, node: FunctionCallNode) -> str:
        compiled_args = [self.visit(a) for a in node.args]

        # Consulta o RoutineRegistry
        translated = RoutineRegistry.translate_call(node.name, compiled_args)
        if translated is not None:
            return translated

        # Chamada genérica de função SQL
        args_str = ", ".join(compiled_args)
        return f"{node.name}({args_str})"

    def visit_method_call(self, node: MethodCallNode) -> str:
        obj_sql = self.visit(node.object_expr)
        lower_method = node.method_name.lower()
        compiled_args = [self.visit(a) for a in node.args]

        if lower_method == "tostring":
            return f"TRY_CAST({obj_sql} AS VARCHAR)"
        elif lower_method == "touppercase":
            return f"UPPER({obj_sql})"
        elif lower_method == "tolowercase":
            return f"LOWER({obj_sql})"
        elif lower_method == "trim":
            return f"TRIM({obj_sql})"
        elif lower_method == "equals" and len(compiled_args) == 1:
            return f"{obj_sql} = {compiled_args[0]}"
        elif lower_method == "length":
            return f"LENGTH({obj_sql})"

        # Fallback: executa como função sobre o objeto
        all_args = [obj_sql] + compiled_args
        return f"{node.method_name}({', '.join(all_args)})"
