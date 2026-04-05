export enum TokenType {
  Identifier = "Identifier",
  String = "String",
  Number = "Number",
  Operator = "Operator",
  LParen = "LParen",
  RParen = "RParen",
  LBracket = "LBracket",
  RBracket = "RBracket",
  LBrace = "LBrace",
  RBrace = "RBrace",
  Comma = "Comma",
  Semicolon = "Semicolon",
  Whitespace = "Whitespace",
  Unknown = "Unknown",
}

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

const PATTERNS: [TokenType, RegExp][] = [
  [TokenType.String, /^"(?:""|[^"])*"/],
  [TokenType.Number, /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
  [TokenType.Identifier, /^[A-Za-z_][A-Za-z0-9_.]*/],
  [TokenType.LParen, /^\(/],
  [TokenType.RParen, /^\)/],
  [TokenType.LBracket, /^\[/],
  [TokenType.RBracket, /^\]/],
  [TokenType.LBrace, /^\{/],
  [TokenType.RBrace, /^\}/],
  [TokenType.Comma, /^,/],
  [TokenType.Semicolon, /^;/],
  [TokenType.Operator, /^[+\-*/^&=<>!:]+/],
  [TokenType.Whitespace, /^\s+/],
];

export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < formula.length) {
    let matched = false;

    for (const [type, pattern] of PATTERNS) {
      const match = pattern.exec(formula.slice(pos));
      if (match) {
        const value = match[0];
        tokens.push({ type, value, start: pos, end: pos + value.length });
        pos += value.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({
        type: TokenType.Unknown,
        value: formula[pos],
        start: pos,
        end: pos + 1,
      });
      pos += 1;
    }
  }

  return tokens;
}

export function reconstruct(tokens: Token[]): string {
  return tokens.map((t) => t.value).join("");
}
