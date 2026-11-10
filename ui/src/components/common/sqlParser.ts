// ============================================================
// RocketDataForge — SQL Parser, Tokenizer & Linter Engine
// ============================================================

export type TokenType =
  | "keyword"
  | "function"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "variable"
  | "punctuation"
  | "plain";

export interface SqlToken {
  type: TokenType;
  text: string;
}

export interface SqlLintIssue {
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

export interface SqlLintResult {
  isValid: boolean;
  issues: SqlLintIssue[];
  stats: {
    lineCount: number;
    keywordCount: number;
    charCount: number;
  };
}

// ─── SQL Keywords and Built-in Functions Catalog ─────────────
export const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS",
  "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "VIEW", "DROP",
  "ALTER", "WITH", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "ILIKE",
  "BETWEEN", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "OVER", "PARTITION",
  "DESC", "ASC", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "CHECK", "INDEX",
  "TABLESPACE", "RETURNING", "CONFLICT", "DO", "NOTHING", "SHOW", "EXPLAIN", "ANALYZE"
]);

export const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CONCAT", "SUBSTRING",
  "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM", "ROUND", "FLOOR", "CEIL", "CEILING",
  "ABS", "MOD", "POWER", "SQRT", "DATE_TRUNC", "NOW", "CURRENT_TIMESTAMP", "CURRENT_DATE",
  "DATE_ADD", "DATE_SUB", "DATEDIFF", "EXTRACT", "ROW_NUMBER", "RANK", "DENSE_RANK",
  "LEAD", "LAG", "FIRST_VALUE", "LAST_VALUE", "READ_PARQUET", "READ_CSV", "READ_JSON",
  "TO_DATE", "TO_CHAR", "TO_TIMESTAMP", "CAST", "TRY_CAST", "LENGTH", "REPLACE"
]);

/**
 * Tokeniza código SQL para colorização de sintaxe profissional (Syntax Highlighting)
 */
export function tokenizeSql(sql: string): SqlToken[] {
  if (!sql) return [];
  const tokens: SqlToken[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // ── 1. Comentários de Linha: -- ...
    if (ch === "-" && sql[i + 1] === "-") {
      let end = sql.indexOf("\n", i);
      if (end === -1) end = len;
      tokens.push({ type: "comment", text: sql.slice(i, end) });
      i = end;
      continue;
    }

    // ── 2. Comentários de Bloco: /* ... */
    if (ch === "/" && sql[i + 1] === "*") {
      let end = sql.indexOf("*/", i + 2);
      if (end === -1) end = len;
      else end += 2;
      tokens.push({ type: "comment", text: sql.slice(i, end) });
      i = end;
      continue;
    }

    // ── 3. Variáveis de Contexto / Interpolação: {{ ... }}
    if (ch === "{" && sql[i + 1] === "{") {
      let end = sql.indexOf("}}", i + 2);
      if (end === -1) end = len;
      else end += 2;
      tokens.push({ type: "variable", text: sql.slice(i, end) });
      i = end;
      continue;
    }

    // ── 4. Strings com Aspas Simples: '...' ou Duplas: "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (sql[j] === quote) {
          // Escaped quote (ex: '' em SQL)
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        if (sql[j] === "\n") {
          // Quebra de linha sem fechar aspas
          break;
        }
        j++;
      }
      tokens.push({ type: "string", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── 5. Números (Inteiros e Decimais)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] || ""))) {
      let j = i;
      while (j < len && /[0-9.]/.test(sql[j])) {
        j++;
      }
      tokens.push({ type: "number", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── 6. Identificadores, Palavras-Chave e Funções
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j])) {
        j++;
      }
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();

      // Checa se é seguido de "(" para classificar como função
      let nextCharIdx = j;
      while (nextCharIdx < len && /\s/.test(sql[nextCharIdx])) {
        nextCharIdx++;
      }
      const isCall = sql[nextCharIdx] === "(";

      if (SQL_FUNCTIONS.has(upper) || (isCall && !SQL_KEYWORDS.has(upper))) {
        tokens.push({ type: "function", text: word });
      } else if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", text: word });
      } else if (word.toLowerCase().startsWith("context.") || word.toLowerCase().startsWith("row.")) {
        tokens.push({ type: "variable", text: word });
      } else {
        tokens.push({ type: "plain", text: word });
      }
      i = j;
      continue;
    }

    // ── 7. Operadores (=, !=, <>, >=, <=, +, -, *, /, %, ::)
    if (/[:=<>!+\-*/%]/.test(ch)) {
      let op = ch;
      if (i + 1 < len && /[:=<>!+\-*/%]/.test(sql[i + 1])) {
        op += sql[i + 1];
        i += 2;
      } else {
        i++;
      }
      tokens.push({ type: "operator", text: op });
      continue;
    }

    // ── 8. Pontuação (vírgulas, ponto e vírgula, parênteses)
    if (/[,;()[\]{}]/.test(ch)) {
      tokens.push({ type: "punctuation", text: ch });
      i++;
      continue;
    }

    // ── 9. Espaços em branco e outros
    tokens.push({ type: "plain", text: ch });
    i++;
  }

  return tokens;
}

/**
 * Interpretador & Linter de SQL:
 * Detecta erros de sintaxe em tempo real:
 * - Parênteses desbalanceados '(' e ')'
 * - Aspas não finalizadas
 * - Vírgula pendente antes de cláusulas
 * - Ordem incorreta de cláusulas ANSI SQL (ex: WHERE após ORDER BY)
 * - SELECT vazio
 */
export function lintSql(sql: string): SqlLintResult {
  const issues: SqlLintIssue[] = [];
  const lines = sql.split("\n");
  let keywordCount = 0;

  if (!sql.trim()) {
    return {
      isValid: true,
      issues: [],
      stats: { lineCount: 1, keywordCount: 0, charCount: 0 }
    };
  }

  // 1. Verificação de Parênteses e Aspas com posições exatas
  const parenStack: Array<{ char: string; line: number; col: number }> = [];
  let inSingleQuote = false;
  let quoteStartPos = { line: 1, col: 1 };
  let inDoubleQuote = false;
  let dQuoteStartPos = { line: 1, col: 1 };
  let inLineComment = false;
  let inBlockComment = false;

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l];
    inLineComment = false;

    for (let c = 0; c < lineText.length; c++) {
      const ch = lineText[c];
      const next = lineText[c + 1] || "";

      // Comentários de linha
      if (!inSingleQuote && !inDoubleQuote && !inBlockComment && ch === "-" && next === "-") {
        inLineComment = true;
        break; // Ignora o resto da linha
      }

      // Início de comentário de bloco
      if (!inSingleQuote && !inDoubleQuote && !inBlockComment && ch === "/" && next === "*") {
        inBlockComment = true;
        c++;
        continue;
      }

      // Fim de comentário de bloco
      if (inBlockComment && ch === "*" && next === "/") {
        inBlockComment = false;
        c++;
        continue;
      }

      if (inBlockComment || inLineComment) continue;

      // Aspas simples
      if (ch === "'" && !inDoubleQuote) {
        if (inSingleQuote && next === "'") {
          // Aspas escapadas ''
          c++;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        if (inSingleQuote) quoteStartPos = { line: l + 1, col: c + 1 };
        continue;
      }

      // Aspas duplas
      if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        if (inDoubleQuote) dQuoteStartPos = { line: l + 1, col: c + 1 };
        continue;
      }

      if (inSingleQuote || inDoubleQuote) continue;

      // Parênteses
      if (ch === "(") {
        parenStack.push({ char: "(", line: l + 1, col: c + 1 });
      } else if (ch === ")") {
        if (parenStack.length === 0) {
          issues.push({
            severity: "error",
            message: "Parêntese de fechamento ')' inesperado sem correspondente.",
            line: l + 1,
            column: c + 1,
          });
        } else {
          parenStack.pop();
        }
      }
    }
  }

  // Notifica parêntese não fechado
  if (parenStack.length > 0) {
    const unclosed = parenStack[parenStack.length - 1];
    issues.push({
      severity: "error",
      message: `Parêntese '(' aberto na linha ${unclosed.line}, coluna ${unclosed.col} não foi fechado.`,
      line: unclosed.line,
      column: unclosed.col,
    });
  }

  // Notifica aspas não fechadas
  if (inSingleQuote) {
    issues.push({
      severity: "error",
      message: `Literal de texto (aspas simples ') aberto na linha ${quoteStartPos.line} não foi fechado.`,
      line: quoteStartPos.line,
      column: quoteStartPos.col,
    });
  }
  if (inDoubleQuote) {
    issues.push({
      severity: "error",
      message: `Identificador (aspas duplas ") aberto na linha ${dQuoteStartPos.line} não foi fechado.`,
      line: dQuoteStartPos.line,
      column: dQuoteStartPos.col,
    });
  }

  // 2. Análise Semântica de Cláusulas e Vírgula Trailing
  const cleanedLines = lines.map((line) => {
    return line.replace(/'(?:''|[^'])*'/g, "''").replace(/--.*$/, "");
  });
  const cleanedText = cleanedLines.join("\n");

  // Regex para vírgula antes de FROM, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT ou fecha-parêntese
  const trailingCommaRegex = /,\s*(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|\))/i;
  const trailingMatch = cleanedText.match(trailingCommaRegex);
  if (trailingMatch && trailingMatch.index !== undefined) {
    const sub = cleanedText.slice(0, trailingMatch.index);
    const lineNum = sub.split("\n").length;
    issues.push({
      severity: "warning",
      message: `Vírgula pendente (trailing comma) antes de '${trailingMatch[1].toUpperCase()}'.`,
      line: lineNum,
      column: 1,
    });
  }

  // 3. Ordem de Cláusulas Principais (em queries sem subqueries aninhadas)
  if (!cleanedText.includes("(")) {
    const clauseSequence: Array<{ name: string; pos: number; line: number }> = [];
    const checkClauses = ["SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT"];

    checkClauses.forEach((cl) => {
      const reg = new RegExp(`\\b${cl.replace(" ", "\\s+")}\\b`, "i");
      const match = cleanedText.match(reg);
      if (match && match.index !== undefined) {
        const sub = cleanedText.slice(0, match.index);
        clauseSequence.push({
          name: cl,
          pos: match.index,
          line: sub.split("\n").length,
        });
        keywordCount++;
      }
    });

    clauseSequence.sort((a, b) => a.pos - b.pos);

    // Valida se WHERE veio após ORDER BY
    const whereItem = clauseSequence.find((c) => c.name === "WHERE");
    const orderItem = clauseSequence.find((c) => c.name === "ORDER BY");
    if (whereItem && orderItem && whereItem.pos > orderItem.pos) {
      issues.push({
        severity: "error",
        message: "Cláusula WHERE não pode aparecer após ORDER BY.",
        line: whereItem.line,
        column: 1,
      });
    }

    // Valida se FROM veio após WHERE
    const fromItem = clauseSequence.find((c) => c.name === "FROM");
    if (whereItem && fromItem && fromItem.pos > whereItem.pos) {
      issues.push({
        severity: "error",
        message: "Cláusula FROM deve vir antes de WHERE.",
        line: fromItem.line,
        column: 1,
      });
    }
  }

  return {
    isValid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    stats: {
      lineCount: lines.length,
      keywordCount,
      charCount: sql.length,
    },
  };
}

/**
 * Formatador Automático de SQL (Beautifier / Indentador Inteligente)
 */
export function formatSql(sql: string): string {
  if (!sql.trim()) return sql;

  const rootClauses = [
    "SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "UNION ALL", "UNION",
    "GROUP BY", "ORDER BY", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM"
  ];

  const subClauses = [
    "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN", "JOIN",
    "AND", "OR", "ON"
  ];

  let formatted = sql.trim();

  rootClauses.forEach((clause) => {
    const reg = new RegExp(`\\s*\\b${clause.replace(" ", "\\s+")}\\b\\s*`, "gi");
    formatted = formatted.replace(reg, `\n${clause} `);
  });

  subClauses.forEach((clause) => {
    const reg = new RegExp(`\\s*\\b${clause.replace(" ", "\\s+")}\\b\\s*`, "gi");
    formatted = formatted.replace(reg, `\n  ${clause} `);
  });

  const cleanLines = formatted
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l, idx, arr) => !(l.trim() === "" && arr[idx - 1]?.trim() === ""));

  return cleanLines.join("\n").trim();
}
