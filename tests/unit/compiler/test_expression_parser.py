import pytest
from src.core.application.compiler.expressions.compiler import compile_expression, validate_expression


class TestExpressionParser:
    """Suíte de testes para o parser e compilador AST de expressões Java-like do tMap."""

    # ─── 1. Literais e Preservação de Strings (Imunidade a Aspas Mistas) ───

    def test_literal_with_mixed_quotes_it_is_valid(self):
        """RF-05.2: Literais com aspas mistas como "it's valid" não podem quebrar o escape SQL."""
        # Java expression: "it's valid"
        compiled = compile_expression('"it\'s valid"')
        # DuckDB SQL string literal must escape the single quote as ''
        assert compiled == "'it''s valid'"

    def test_literal_simple_strings(self):
        """Valida compilação de strings simples com aspas duplas e simples."""
        assert compile_expression('"hello world"') == "'hello world'"
        assert compile_expression("'hello world'") == "'hello world'"

    def test_literal_numbers_and_booleans(self):
        """Valida literais numéricos inteiros, decimais, booleanos e null."""
        assert compile_expression("123") == "123"
        assert compile_expression("45.67") == "45.67"
        assert compile_expression("true") == "TRUE"
        assert compile_expression("false") == "FALSE"
        assert compile_expression("null") == "NULL"

    # ─── 2. Operadores Java (==, !=, &&, ||, !) e Comparações ───

    def test_equality_and_inequality_operators(self):
        """Operadores Java == e != convertidos para SQL = e != ou IS (NOT) NULL."""
        assert compile_expression('row1.status == "ACTIVE"') == "row1.status = 'ACTIVE'"
        assert compile_expression('row1.status != "INACTIVE"') == "row1.status != 'INACTIVE'"
        assert compile_expression("row1.status == null") == "row1.status IS NULL"
        assert compile_expression("row1.status != null") == "row1.status IS NOT NULL"

    def test_logical_operators(self):
        """Operadores lógicos &&, || e ! com precedência correta."""
        # && -> AND
        assert compile_expression('row1.age > 18 && row1.active == true') == "(row1.age > 18) AND (row1.active = TRUE)"
        # || -> OR
        assert compile_expression('row1.status == "A" || row1.status == "B"') == "(row1.status = 'A') OR (row1.status = 'B')"
        # ! -> NOT
        assert compile_expression('!row1.is_deleted') == "NOT (row1.is_deleted)"

    def test_comparison_operators(self):
        """Operadores relacionais <, <=, >, >=."""
        assert compile_expression("row1.score >= 70") == "row1.score >= 70"
        assert compile_expression("row1.score < 50") == "row1.score < 50"

    # ─── 3. Concatenação de Strings com + vs Adição Numérica ───

    def test_string_concatenation_with_plus(self):
        """Concatenação de strings com + deve converter para operador SQL ||."""
        expr = 'row1.first_name + " " + row1.last_name'
        compiled = compile_expression(expr)
        assert compiled == "row1.first_name || ' ' || row1.last_name"

    def test_numeric_addition_preserved(self):
        """Adição puramente numérica (ex: salary + 500) não pode virar concatenação ||."""
        expr = "row1.salary + 500"
        compiled = compile_expression(expr)
        assert compiled == "row1.salary + 500"

    # ─── 4. Operador Ternário Aninhado (cond ? val1 : val2) ───

    def test_simple_ternary(self):
        """Ternário simples convertido para CASE WHEN ... THEN ... ELSE ... END."""
        expr = 'row1.age >= 18 ? "Adult" : "Minor"'
        compiled = compile_expression(expr)
        assert compiled == "CASE WHEN row1.age >= 18 THEN 'Adult' ELSE 'Minor' END"

    def test_nested_ternary(self):
        """Ternário aninhado (cond1 ? val1 : cond2 ? val2 : val3)."""
        expr = 'row1.score >= 90 ? "A" : row1.score >= 80 ? "B" : "C"'
        compiled = compile_expression(expr)
        assert compiled == "CASE WHEN row1.score >= 90 THEN 'A' ELSE CASE WHEN row1.score >= 80 THEN 'B' ELSE 'C' END END"

    # ─── 5. Catálogo de Rotinas (StringHandling, Relational, TalendDate, Numeric, Wrappers) ───

    def test_string_handling_routines(self):
        """Rotinas StringHandling: UPCASE, DOWNCASE, TRIM, LEN, LEFT, RIGHT."""
        assert compile_expression('StringHandling.UPCASE(row1.name)') == "UPPER(row1.name)"
        assert compile_expression('StringHandling.DOWNCASE(row1.name)') == "LOWER(row1.name)"
        assert compile_expression('StringHandling.TRIM(row1.name)') == "TRIM(row1.name)"
        assert compile_expression('StringHandling.LEN(row1.name)') == "LENGTH(row1.name)"
        assert compile_expression('StringHandling.LEFT(row1.code, 3)') == "LEFT(row1.code, 3)"
        assert compile_expression('StringHandling.RIGHT(row1.code, 4)') == "RIGHT(row1.code, 4)"

    def test_relational_routines(self):
        """Rotinas Relational: isNull, not_null."""
        assert compile_expression('Relational.isNull(row1.val)') == "row1.val IS NULL"
        assert compile_expression('!Relational.isNull(row1.val)') == "row1.val IS NOT NULL"
        assert compile_expression('Relational.NOT_NULL(row1.val)') == "row1.val IS NOT NULL"

    def test_java_type_wrappers(self):
        """Wrappers de parsing Java: Integer.parseInt, Double.parseDouble, String.valueOf, etc."""
        assert compile_expression('Integer.parseInt(row1.num_str)') == "TRY_CAST(row1.num_str AS INTEGER)"
        assert compile_expression('Double.parseDouble(row1.num_str)') == "TRY_CAST(row1.num_str AS DOUBLE)"
        assert compile_expression('String.valueOf(row1.id)') == "TRY_CAST(row1.id AS VARCHAR)"
        assert compile_expression('row1.id.toString()') == "TRY_CAST(row1.id AS VARCHAR)"

    def test_numeric_sequence(self):
        """Rotina Numeric.sequence(name, start, step)."""
        compiled = compile_expression('Numeric.sequence("s1", 1, 1)')
        assert "ROW_NUMBER() OVER ()" in compiled

    # ─── 6. Aliasing e Resolução de Namespaces com alias_map e vars_map ───

    def test_alias_map_and_var_replacement(self):
        """Substituição segura de namespaces e variáveis."""
        alias_map = {
            "main": {"table_ref": "_tmap_working", "columns": {"id": "id", "name": "name"}},
            "lkp": {"table_ref": "_tmap_working", "columns": {"city": "city"}}
        }
        vars_map = {"v_discount": "v_discount"}

        # main.name -> _tmap_working."main.name"
        # Var.v_discount -> _tmap_working."Var.v_discount"
        expr = 'main.name + " (" + Var.v_discount + ")"'
        compiled = compile_expression(expr, alias_map=alias_map, vars_map=vars_map)
        assert '_tmap_working."main.name"' in compiled
        assert '_tmap_working."Var.v_discount"' in compiled

    # ─── 7. Validação de Expressões (API / Syntax Checking) ───

    def test_validation_success_and_syntax_error(self):
        """Função validate_expression retorna status de validação e mensagem amigável."""
        valid_res = validate_expression('row1.status == "ACTIVE" ? 1 : 0')
        assert valid_res["valid"] is True
        assert "sql" in valid_res

        invalid_res = validate_expression('row1.status == ? : 0')
        assert invalid_res["valid"] is False
        assert "error" in invalid_res
