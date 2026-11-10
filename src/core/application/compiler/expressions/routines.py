from typing import Callable, Dict, List, Optional
from src.core.application.compiler.expressions.nodes import ASTNode


class RoutineRegistry:
    """Catálogo centralizado de funções e rotinas Java-like para DuckDB SQL."""

    @staticmethod
    def is_routine(name: str) -> bool:
        lower_name = name.lower()
        return (
            lower_name.startswith("stringhandling.") or
            lower_name.startswith("relational.") or
            lower_name.startswith("talenddate.") or
            lower_name.startswith("numeric.") or
            lower_name.startswith("integer.") or
            lower_name.startswith("long.") or
            lower_name.startswith("double.") or
            lower_name.startswith("float.") or
            lower_name.startswith("boolean.") or
            lower_name.startswith("string.") or
            lower_name.startswith("cast_") or
            lower_name in ("previous", "prev", "lag", "next", "lead", "running_sum", "accumulate", "sum_accum", "sequence", "row_number")
        )

    @staticmethod
    def translate_call(name: str, compiled_args: List[str]) -> Optional[str]:
        lower_name = name.lower()

        # ─── 1. StringHandling ───
        if lower_name == "stringhandling.upcase" and len(compiled_args) == 1:
            return f"UPPER({compiled_args[0]})"
        if lower_name == "stringhandling.downcase" and len(compiled_args) == 1:
            return f"LOWER({compiled_args[0]})"
        if lower_name == "stringhandling.trim" and len(compiled_args) == 1:
            return f"TRIM({compiled_args[0]})"
        if lower_name == "stringhandling.len" and len(compiled_args) == 1:
            return f"LENGTH({compiled_args[0]})"
        if lower_name == "stringhandling.left" and len(compiled_args) == 2:
            return f"LEFT({compiled_args[0]}, {compiled_args[1]})"
        if lower_name == "stringhandling.right" and len(compiled_args) == 2:
            return f"RIGHT({compiled_args[0]}, {compiled_args[1]})"
        if lower_name == "stringhandling.change" and len(compiled_args) == 3:
            return f"REPLACE({compiled_args[0]}, {compiled_args[1]}, {compiled_args[2]})"
        if lower_name == "stringhandling.index" and len(compiled_args) == 2:
            return f"INSTR({compiled_args[0]}, {compiled_args[1]})"
        if lower_name == "stringhandling.ereplace" and len(compiled_args) == 3:
            return f"REGEXP_REPLACE({compiled_args[0]}, {compiled_args[1]}, {compiled_args[2]})"

        # ─── 2. Relational ───
        if lower_name == "relational.isnull" and len(compiled_args) == 1:
            return f"{compiled_args[0]} IS NULL"
        if lower_name in ("relational.not_null", "relational.notnull") and len(compiled_args) == 1:
            return f"{compiled_args[0]} IS NOT NULL"

        # ─── 3. TalendDate ───
        if lower_name == "talenddate.getcurrentdate":
            return "CURRENT_TIMESTAMP"
        if lower_name == "talenddate.formatdate" and len(compiled_args) >= 2:
            # TalendDate.formatDate(pattern, date) -> STRFTIME(date, pattern)
            return f"STRFTIME({compiled_args[1]}, {compiled_args[0]})"
        if lower_name == "talenddate.parsedate" and len(compiled_args) >= 2:
            # TalendDate.parseDate(pattern, str) -> STRPTIME(str, pattern)
            return f"STRPTIME({compiled_args[1]}, {compiled_args[0]})"
        if lower_name == "talenddate.adddate" and len(compiled_args) == 3:
            # TalendDate.addDate(date, amount, unit)
            return f"DATE_ADD({compiled_args[0]}, INTERVAL ({compiled_args[1]}) {compiled_args[2]})"
        if lower_name == "talenddate.diffdate" and len(compiled_args) >= 2:
            unit = compiled_args[2] if len(compiled_args) > 2 else "'day'"
            return f"DATE_DIFF({unit}, {compiled_args[1]}, {compiled_args[0]})"

        # ─── 4. Numeric & Window Functions ───
        if lower_name == "numeric.sequence":
            start = compiled_args[1] if len(compiled_args) > 1 else "1"
            step = compiled_args[2] if len(compiled_args) > 2 else "1"
            if start == "1" and step == "1":
                return "ROW_NUMBER() OVER ()"
            return f"(ROW_NUMBER() OVER () * ({step}) + ({start}) - ({step}))"
        if lower_name in ("sequence", "row_number"):
            return "ROW_NUMBER() OVER ()"
        if lower_name in ("previous", "prev", "lag") and len(compiled_args) >= 1:
            offset = compiled_args[1] if len(compiled_args) > 1 else "1"
            return f"LAG({compiled_args[0]}, {offset}) OVER (ORDER BY _tmap_main_idx)"
        if lower_name in ("next", "lead") and len(compiled_args) >= 1:
            offset = compiled_args[1] if len(compiled_args) > 1 else "1"
            return f"LEAD({compiled_args[0]}, {offset}) OVER (ORDER BY _tmap_main_idx)"
        if lower_name in ("running_sum", "accumulate", "sum_accum") and len(compiled_args) == 1:
            return f"SUM({compiled_args[0]}) OVER (ORDER BY _tmap_main_idx)"

        # ─── 5. Java Type Parsing & Casting Wrappers ───
        if lower_name in ("integer.parseint", "cast_integer", "cast_int") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS INTEGER)"
        if lower_name in ("long.parselong", "cast_long") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS BIGINT)"
        if lower_name in ("double.parsedouble", "cast_double") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS DOUBLE)"
        if lower_name in ("float.parsefloat", "cast_float") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS FLOAT)"
        if lower_name in ("boolean.parseboolean", "cast_boolean", "cast_bool") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS BOOLEAN)"
        if lower_name in ("string.valueof", "cast_string") and len(compiled_args) == 1:
            return f"TRY_CAST({compiled_args[0]} AS VARCHAR)"

        return None
