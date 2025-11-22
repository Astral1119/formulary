from typing import Dict, Set
from .tokenizer import FormulaTokenizer, TokenType
from .parser import FormulaParser, Node, TokenNode, FunctionCallNode

class Refactorer:
    def __init__(self, rename_map: Dict[str, str]):
        self.rename_map = rename_map
        self.tokenizer = FormulaTokenizer()

    def refactor(self, formula: str) -> str:
        tokens = self.tokenizer.tokenize(formula)
        parser = FormulaParser(tokens)
        nodes = parser.parse()
        
        # traverse and transform
        transformed_nodes = [self._transform(node, set()) for node in nodes]
        
        # reconstruct
        return "".join(node.to_string() for node in transformed_nodes)

    def _transform(self, node: Node, scope: Set[str]) -> Node:
        if isinstance(node, FunctionCallNode):
            return self._transform_function(node, scope)
        elif isinstance(node, TokenNode):
            return self._transform_token(node, scope)
        return node

    def _transform_token(self, node: TokenNode, scope: Set[str]) -> Node:
        if node.token.type == TokenType.IDENTIFIER:
            name = node.token.value
            if name in scope:
                # shadowed, don't rename
                return node
            if name in self.rename_map:
                from .tokenizer import Token
                new_token = Token(
                    TokenType.IDENTIFIER, 
                    self.rename_map[name], 
                    node.token.start, 
                    node.token.end
                )
                return TokenNode(new_token)
        return node

    def _transform_function(self, node: FunctionCallNode, scope: Set[str]) -> FunctionCallNode:
        func_name = node.name_node.token.value.upper()
        
        # handle Scoping
        if func_name == "LET":
            return self._transform_let(node, scope)
        elif func_name == "LAMBDA":
            return self._transform_lambda(node, scope)
        
        # standard function call
        # 1. transform the function name itself (it's an identifier)
        new_name_node = self._transform_token(node.name_node, scope)
        
        # 2. transform args
        new_args = []
        for arg in node.args:
            new_arg = [self._transform(n, scope) for n in arg]
            new_args.append(new_arg)
            
        return FunctionCallNode(
            new_name_node, # type: ignore
            node.lparen,
            new_args,
            node.rparen,
            node.pre_paren_whitespace
        )

    def _transform_let(self, node: FunctionCallNode, scope: Set[str]) -> FunctionCallNode:
        # LET(name1, value1, name2, value2, ..., expression)
        # args are in node.args
        # we need to iterate args and update scope incrementally
        
        current_scope = scope.copy()
        new_args = []
        
        # LET args come in pairs, except the last one
        # but node.args is a list of lists of nodes (including separators)
        # we need to identify which args are names and which are values.
        
        # the parser groups tokens between commas as "args".
        # so node.args[0] is name1, node.args[1] is value1, etc.
        
        num_args = len(node.args)
        
        for i, arg in enumerate(node.args):
            # check if it's the last arg (expression)
            if i == num_args - 1:
                # expression: transform with full scope
                new_arg = [self._transform(n, current_scope) for n in arg]
                new_args.append(new_arg)
                continue
            
            is_name_decl = (i % 2 == 0)
            
            if is_name_decl:
                # extract name from arg nodes
                # usually it's just one Identifier node, maybe whitespace.
                decl_name = None
                for n in arg:
                    if isinstance(n, TokenNode) and n.token.type == TokenType.IDENTIFIER:
                        decl_name = n.token.value
                        break
                
                if decl_name:
                    current_scope.add(decl_name)
                
                new_args.append(arg) 
            else:
                pass

        # let's restart the loop with correct logic
        current_scope = scope.copy()
        new_args = []
        
        i = 0
        while i < num_args:
            arg = node.args[i]
            
            # if last arg, it's expression
            if i == num_args - 1:
                new_arg = [self._transform(n, current_scope) for n in arg]
                new_args.append(new_arg)
                i += 1
                continue
            
            # it's a name declaration (i)
            # don't transform
            new_args.append(arg)
            
            # extract name to update scope for FUTURE args
            decl_name = None
            for n in arg:
                if isinstance(n, TokenNode) and n.token.type == TokenType.IDENTIFIER:
                    decl_name = n.token.value
                    break
            
            # next arg (i+1) is value
            if i + 1 < num_args:
                val_arg = node.args[i+1]
                # transform value with CURRENT scope (before adding decl_name)
                new_val_arg = [self._transform(n, current_scope) for n in val_arg]
                new_args.append(new_val_arg)
                
                # nOW add decl_name to scope
                if decl_name:
                    current_scope.add(decl_name)
                
                i += 2
            else:
                i += 1
        
        return FunctionCallNode(
            node.name_node, # LET is not renamed
            node.lparen,
            new_args,
            node.rparen,
            node.pre_paren_whitespace
        )

    def _transform_lambda(self, node: FunctionCallNode, scope: Set[str]) -> FunctionCallNode:
        # LAMBDA(name1, name2, ..., expression)
        # all args except last are name declarations.
        # last arg is expression.
        
        current_scope = scope.copy()
        new_args = []
        num_args = len(node.args)
        
        for i, arg in enumerate(node.args):
            if i == num_args - 1:
                # expression: transform with full scope
                new_arg = [self._transform(n, current_scope) for n in arg]
                new_args.append(new_arg)
            else:
                # name declaration
                # don't transform
                new_args.append(arg)
                
                # add to scope
                for n in arg:
                    if isinstance(n, TokenNode) and n.token.type == TokenType.IDENTIFIER:
                        current_scope.add(n.token.value)
                        break
        
        return FunctionCallNode(
            node.name_node, # LAMBDA is not renamed
            node.lparen,
            new_args,
            node.rparen,
            node.pre_paren_whitespace
        )
