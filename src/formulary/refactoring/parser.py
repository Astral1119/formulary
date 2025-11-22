from typing import List, Optional
from .tokenizer import Token, TokenType

class Node:
    def to_string(self) -> str:
        raise NotImplementedError

class TokenNode(Node):
    def __init__(self, token: Token):
        self.token = token
    
    def to_string(self) -> str:
        return self.token.value
    
    def __repr__(self):
        return f"TokenNode({self.token.value})"

class FormulaParser:
    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.pos = 0
    
    def parse(self) -> List[Node]:
        nodes = []
        while self.pos < len(self.tokens):
            node = self._parse_next()
            if node:
                nodes.append(node)
            else:
                break
        return nodes

    def _peek(self) -> Optional[Token]:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return None

    def _consume(self) -> Optional[Token]:
        if self.pos < len(self.tokens):
            t = self.tokens[self.pos]
            self.pos += 1
            return t
        return None

    def _parse_next(self) -> Optional[Node]:
        token = self._peek()
        if not token:
            return None

        # check if it's a function call: Identifier followed by LPAREN
        # sheets allows whitespace between name and paren: ADD ( 1, 2 )
        
        if token.type == TokenType.IDENTIFIER:
            # look ahead for LPAREN
            lookahead_pos = self.pos + 1
            whitespace_tokens = []
            is_func = False
            
            while lookahead_pos < len(self.tokens):
                t = self.tokens[lookahead_pos]
                if t.type == TokenType.WHITESPACE:
                    whitespace_tokens.append(t)
                    lookahead_pos += 1
                elif t.type == TokenType.LPAREN:
                    is_func = True
                    break
                else:
                    break
            
            if is_func:
                # parse as FunctionCall
                name_token = self._consume()
                name_node = TokenNode(name_token)
                
                # consume whitespace
                ws_nodes = [TokenNode(self._consume()) for _ in whitespace_tokens]
                
                lparen_token = self._consume()
                lparen_node = TokenNode(lparen_token)
                
                args = []
                current_arg = []
                
                # parse args until RPAREN
                while True:
                    t = self._peek()
                    if not t:
                        break # error: unexpected EOF
                    
                    if t.type == TokenType.RPAREN:
                        if current_arg:
                            args.append(current_arg)
                        elif not args and not current_arg:
                             # empty args list "()"
                             pass
                        break
                    elif t.type == TokenType.COMMA or t.type == TokenType.SEMICOLON:
                        # separator
                        sep = self._consume()
                        current_arg.append(TokenNode(sep))
                        args.append(current_arg)
                        current_arg = []
                    else:
                        # we need to check if the next token is a separator for THIS level.
                        if t.type in (TokenType.COMMA, TokenType.SEMICOLON, TokenType.RPAREN):
                            # handled by loop
                            pass
                        else:
                            # it's content
                            node = self._parse_next()
                            current_arg.append(node)
                
                rparen_token = self._consume()
                rparen_node = TokenNode(rparen_token)
                
                return FunctionCallNode(name_node, lparen_node, args, rparen_node, ws_nodes)

        # default: consume as TokenNode
        return TokenNode(self._consume())

class FunctionCallNode(Node):
    def __init__(self, name_node: TokenNode, lparen: TokenNode, args: List[List[Node]], rparen: TokenNode, pre_paren_whitespace: List[TokenNode] = None):
        self.name_node = name_node
        self.lparen = lparen
        self.args = args 
        self.rparen = rparen
        self.pre_paren_whitespace = pre_paren_whitespace or []
    
    def to_string(self) -> str:
        parts = [self.name_node.to_string()]
        for ws in self.pre_paren_whitespace:
            parts.append(ws.to_string())
        parts.append(self.lparen.to_string())
        
        for arg in self.args:
            for node in arg:
                parts.append(node.to_string())
        
        parts.append(self.rparen.to_string())
        return "".join(parts)
    
    def __repr__(self):
        return f"FunctionCall({self.name_node.token.value}, args={len(self.args)})"
