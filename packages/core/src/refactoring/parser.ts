import { type Token, TokenType } from "./tokenizer.js";

export interface TokenNode {
  kind: "token";
  token: Token;
}

export interface FunctionCallNode {
  kind: "call";
  name: TokenNode;
  preParenWhitespace: TokenNode[];
  lparen: TokenNode;
  args: Node[][]; // each arg is a list of nodes; separators are included at the end of each arg group
  rparen: TokenNode;
}

export type Node = TokenNode | FunctionCallNode;

export function nodeToString(node: Node): string {
  if (node.kind === "token") {
    return node.token.value;
  }
  let s = nodeToString(node.name);
  for (const ws of node.preParenWhitespace) {
    s += nodeToString(ws);
  }
  s += nodeToString(node.lparen);
  for (const arg of node.args) {
    for (const n of arg) {
      s += nodeToString(n);
    }
  }
  s += nodeToString(node.rparen);
  return s;
}

export function parse(tokens: Token[]): Node[] {
  const parser = new Parser(tokens);
  return parser.parse();
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  parse(): Node[] {
    const nodes: Node[] = [];
    while (this.pos < this.tokens.length) {
      const node = this.parseNext();
      if (node) nodes.push(node);
      else break;
    }
    return nodes;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private tokenNode(token: Token): TokenNode {
    return { kind: "token", token };
  }

  private parseNext(): Node | undefined {
    const token = this.peek();
    if (!token) return undefined;

    if (token.type === TokenType.Identifier) {
      // look ahead for LPAREN (possibly with whitespace in between)
      let lookahead = this.pos + 1;
      const wsTokens: Token[] = [];

      while (lookahead < this.tokens.length) {
        const t = this.tokens[lookahead];
        if (t.type === TokenType.Whitespace) {
          wsTokens.push(t);
          lookahead++;
        } else if (t.type === TokenType.LParen) {
          // it's a function call
          return this.parseFunctionCall(wsTokens, lookahead);
        } else {
          break;
        }
      }
    }

    return this.tokenNode(this.consume());
  }

  private parseFunctionCall(
    wsTokens: Token[],
    lparenPos: number,
  ): FunctionCallNode {
    const nameToken = this.consume();
    const nameNode = this.tokenNode(nameToken);

    // consume whitespace tokens
    const preParenWhitespace: TokenNode[] = [];
    for (const _ of wsTokens) {
      preParenWhitespace.push(this.tokenNode(this.consume()));
    }

    const lparen = this.tokenNode(this.consume()); // consume LPAREN

    const args: Node[][] = [];
    let currentArg: Node[] = [];
    let parenDepth = 0;

    while (true) {
      const t = this.peek();
      if (!t) break; // unexpected EOF

      if (t.type === TokenType.RParen) {
        if (parenDepth > 0) {
          // Closing a standalone paren group, not this function call
          parenDepth--;
          currentArg.push(this.tokenNode(this.consume()));
          continue;
        }
        if (currentArg.length > 0) {
          args.push(currentArg);
        }
        break;
      }

      if (
        parenDepth === 0 &&
        (t.type === TokenType.Comma || t.type === TokenType.Semicolon)
      ) {
        const sep = this.consume();
        currentArg.push(this.tokenNode(sep));
        args.push(currentArg);
        currentArg = [];
      } else {
        const node = this.parseNext();
        if (node) {
          currentArg.push(node);
          // Track standalone parens (LParen not consumed by a function call)
          if (node.kind === "token" && node.token.type === TokenType.LParen) {
            parenDepth++;
          }
        }
      }
    }

    const rparen = this.tokenNode(this.consume()); // consume RPAREN

    return {
      kind: "call",
      name: nameNode,
      preParenWhitespace,
      lparen,
      args,
      rparen,
    };
  }
}
