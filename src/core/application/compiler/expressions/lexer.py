from enum import Enum, auto
from dataclasses import dataclass
from typing import List, Optional


class TokenType(Enum):
    # Literais
    STRING = auto()
    NUMBER = auto()
    BOOLEAN = auto()
    NULL = auto()

    # Identificadores e Palavras-chave
    IDENTIFIER = auto()

    # Operadores de Comparação e Lógicos
    EQ = auto()          # ==
    NEQ = auto()         # !=
    LT = auto()          # <
    LTE = auto()         # <=
    GT = auto()          # >
    GTE = auto()         # >=
    AND = auto()         # &&
    OR = auto()          # ||
    NOT = auto()         # !

    # Operadores Aritméticos e Concatenação
    PLUS = auto()        # +
    MINUS = auto()       # -
    STAR = auto()        # *
    SLASH = auto()       # /
    PERCENT = auto()     # %

    # Operador Ternário
    QUESTION = auto()    # ?
    COLON = auto()       # :

    # Delimitadores e Pontuação
    LPAREN = auto()      # (
    RPAREN = auto()      # )
    COMMA = auto()       # ,
    DOT = auto()         # .
    PIPE_PIPE = auto()   # || (já mapeado em OR, mas suporta concat se necessário)

    EOF = auto()


@dataclass
class Token:
    type: TokenType
    value: str
    raw: str
    position: int


class LexerError(Exception):
    def __init__(self, message: str, position: int):
        super().__init__(f"Lexer error at position {position}: {message}")
        self.position = position


class Lexer:
    """Analisador léxico robusto para expressões Java-like do tMap com imunidade a literais."""

    def __init__(self, source: str):
        self.source = source
        self.pos = 0
        self.length = len(source)

    def _peek(self, offset: int = 0) -> Optional[str]:
        idx = self.pos + offset
        if idx < self.length:
            return self.source[idx]
        return None

    def _advance(self) -> str:
        ch = self.source[self.pos]
        self.pos += 1
        return ch

    def tokenize(self) -> List[Token]:
        tokens: List[Token] = []

        while self.pos < self.length:
            ch = self.source[self.pos]

            # Ignora espaços em branco
            if ch.isspace():
                self.pos += 1
                continue

            start_pos = self.pos

            # Strings com aspas duplas ("...") ou aspas simples ('...')
            if ch in ('"', "'"):
                quote_char = self._advance()
                chars = []
                while self.pos < self.length:
                    curr = self._advance()
                    if curr == '\\':
                        if self.pos < self.length:
                            escaped = self._advance()
                            if escaped == 'n':
                                chars.append('\n')
                            elif escaped == 't':
                                chars.append('\t')
                            elif escaped == 'r':
                                chars.append('\r')
                            elif escaped in ('"', "'", '\\'):
                                chars.append(escaped)
                            else:
                                chars.append(escaped)
                        else:
                            chars.append('\\')
                    elif curr == quote_char:
                        break
                    else:
                        chars.append(curr)
                val = "".join(chars)
                raw_str = self.source[start_pos:self.pos]
                tokens.append(Token(TokenType.STRING, val, raw_str, start_pos))
                continue

            # Template wrappers: {{identifier}} ou {identifier}
            if ch == '{':
                # Verifica se é {{...}} ou {...}
                if self._peek(1) == '{':
                    self.pos += 2
                    end_idx = self.source.find('}}', self.pos)
                    if end_idx != -1:
                        inner_ident = self.source[self.pos:end_idx].strip()
                        self.pos = end_idx + 2
                        tokens.append(Token(TokenType.IDENTIFIER, inner_ident, f"{{{{{inner_ident}}}}}", start_pos))
                        continue
                    else:
                        # Fallback se não fechar
                        self.pos = start_pos
                else:
                    self.pos += 1
                    end_idx = self.source.find('}', self.pos)
                    if end_idx != -1:
                        inner_ident = self.source[self.pos:end_idx].strip()
                        self.pos = end_idx + 1
                        tokens.append(Token(TokenType.IDENTIFIER, inner_ident, f"{{{inner_ident}}}", start_pos))
                        continue
                    else:
                        self.pos = start_pos

            # Números (inteiros e decimais)
            if ch.isdigit():
                num_chars = []
                has_dot = False
                while self.pos < self.length:
                    c = self.source[self.pos]
                    if c.isdigit():
                        num_chars.append(self._advance())
                    elif c == '.' and not has_dot and self._peek(1) and self._peek(1).isdigit():
                        has_dot = True
                        num_chars.append(self._advance())
                    else:
                        break
                num_str = "".join(num_chars)
                tokens.append(Token(TokenType.NUMBER, num_str, num_str, start_pos))
                continue

            # Identificadores e palavras-chave (true, false, null, etc.)
            if ch.isalpha() or ch == '_':
                ident_chars = []
                while self.pos < self.length and (self.source[self.pos].isalnum() or self.source[self.pos] == '_'):
                    ident_chars.append(self._advance())
                ident_str = "".join(ident_chars)
                lower_ident = ident_str.lower()
                if lower_ident == "true":
                    tokens.append(Token(TokenType.BOOLEAN, "true", ident_str, start_pos))
                elif lower_ident == "false":
                    tokens.append(Token(TokenType.BOOLEAN, "false", ident_str, start_pos))
                elif lower_ident == "null":
                    tokens.append(Token(TokenType.NULL, "null", ident_str, start_pos))
                else:
                    tokens.append(Token(TokenType.IDENTIFIER, ident_str, ident_str, start_pos))
                continue

            # Operadores de dois caracteres
            two_chars = self.source[self.pos:self.pos+2]
            if two_chars == "==":
                self.pos += 2
                tokens.append(Token(TokenType.EQ, "==", "==", start_pos))
                continue
            elif two_chars == "!=":
                self.pos += 2
                tokens.append(Token(TokenType.NEQ, "!=", "!=", start_pos))
                continue
            elif two_chars == "<=":
                self.pos += 2
                tokens.append(Token(TokenType.LTE, "<=", "<=", start_pos))
                continue
            elif two_chars == ">=":
                self.pos += 2
                tokens.append(Token(TokenType.GTE, ">=", ">=", start_pos))
                continue
            elif two_chars == "&&":
                self.pos += 2
                tokens.append(Token(TokenType.AND, "&&", "&&", start_pos))
                continue
            elif two_chars == "||":
                self.pos += 2
                tokens.append(Token(TokenType.OR, "||", "||", start_pos))
                continue

            # Operadores e pontuação de um caractere
            single = self._advance()
            if single == '<':
                tokens.append(Token(TokenType.LT, "<", "<", start_pos))
            elif single == '>':
                tokens.append(Token(TokenType.GT, ">", ">", start_pos))
            elif single == '!':
                tokens.append(Token(TokenType.NOT, "!", "!", start_pos))
            elif single == '+':
                tokens.append(Token(TokenType.PLUS, "+", "+", start_pos))
            elif single == '-':
                tokens.append(Token(TokenType.MINUS, "-", "-", start_pos))
            elif single == '*':
                tokens.append(Token(TokenType.STAR, "*", "*", start_pos))
            elif single == '/':
                tokens.append(Token(TokenType.SLASH, "/", "/", start_pos))
            elif single == '%':
                tokens.append(Token(TokenType.PERCENT, "%", "%", start_pos))
            elif single == '?':
                tokens.append(Token(TokenType.QUESTION, "?", "?", start_pos))
            elif single == ':':
                tokens.append(Token(TokenType.COLON, ":", ":", start_pos))
            elif single == '(':
                tokens.append(Token(TokenType.LPAREN, "(", "(", start_pos))
            elif single == ')':
                tokens.append(Token(TokenType.RPAREN, ")", ")", start_pos))
            elif single == ',':
                tokens.append(Token(TokenType.COMMA, ",", ",", start_pos))
            elif single == '.':
                tokens.append(Token(TokenType.DOT, ".", ".", start_pos))
            else:
                raise LexerError(f"Caractere inesperado '{single}'", start_pos)

        tokens.append(Token(TokenType.EOF, "", "", self.pos))
        return tokens
