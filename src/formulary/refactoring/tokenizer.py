from enum import Enum, auto
from typing import List, NamedTuple
import re

class TokenType(Enum):
    IDENTIFIER = auto()
    STRING = auto()
    NUMBER = auto()
    OPERATOR = auto()
    LPAREN = auto()
    RPAREN = auto()
    LBRACKET = auto()
    RBRACKET = auto()
    LBRACE = auto()
    RBRACE = auto()
    COMMA = auto()
    SEMICOLON = auto()
    WHITESPACE = auto()
    UNKNOWN = auto()

class Token(NamedTuple):
    type: TokenType
    value: str
    start: int
    end: int

class FormulaTokenizer:
    """
    a lossless tokenizer for Google Sheets / Excel formulas.
    preserves whitespace to allow exact reconstruction.
    """
    
    # regex patterns for tokens
    # order matters!
    PATTERNS = [
        (TokenType.STRING, r'"(?:""|[^"])*"'), # double-quoted string, escaping with double quotes
        (TokenType.NUMBER, r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?'),
        (TokenType.IDENTIFIER, r'[A-Za-z_][A-Za-z0-9_.]*'), # simple identifier
        (TokenType.LPAREN, r'\('),
        (TokenType.RPAREN, r'\)'),
        (TokenType.LBRACKET, r'\['),
        (TokenType.RBRACKET, r'\]'),
        (TokenType.LBRACE, r'\{'),
        (TokenType.RBRACE, r'\}'),
        (TokenType.COMMA, r','),
        (TokenType.SEMICOLON, r';'),
        (TokenType.OPERATOR, r'[+\-*/^&=<>!:]+'), # basic operators including range colon
        (TokenType.WHITESPACE, r'\s+'),
    ]

    def tokenize(self, formula: str) -> List[Token]:
        tokens = []
        pos = 0
        length = len(formula)
        
        while pos < length:
            match = None
            for token_type, pattern in self.PATTERNS:
                regex = re.compile(pattern)
                match = regex.match(formula, pos)
                if match:
                    value = match.group(0)
                    tokens.append(Token(token_type, value, pos, pos + len(value)))
                    pos += len(value)
                    break
            
            if not match:
                # unknown character
                tokens.append(Token(TokenType.UNKNOWN, formula[pos], pos, pos + 1))
                pos += 1
                
        return tokens

    def reconstruct(self, tokens: List[Token]) -> str:
        return "".join(t.value for t in tokens)
