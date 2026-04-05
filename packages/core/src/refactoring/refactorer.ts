import { tokenize, TokenType, type Token } from "./tokenizer.js";
import {
  parse,
  nodeToString,
  type Node,
  type TokenNode,
  type FunctionCallNode,
} from "./parser.js";

export function refactor(
  formula: string,
  renameMap: Map<string, string>,
): string {
  const tokens = tokenize(formula);
  const nodes = parse(tokens);
  const transformed = nodes.map((n) => transform(n, new Set(), renameMap));
  return transformed.map(nodeToString).join("");
}

function transform(
  node: Node,
  scope: Set<string>,
  renameMap: Map<string, string>,
): Node {
  if (node.kind === "call") {
    return transformCall(node, scope, renameMap);
  }
  return transformToken(node, scope, renameMap);
}

function transformToken(
  node: TokenNode,
  scope: Set<string>,
  renameMap: Map<string, string>,
): TokenNode {
  if (node.token.type !== TokenType.Identifier) return node;

  const name = node.token.value;
  if (scope.has(name)) return node; // shadowed
  const renamed = renameMap.get(name);
  if (!renamed) return node;

  return {
    kind: "token",
    token: { ...node.token, value: renamed },
  };
}

function transformCall(
  node: FunctionCallNode,
  scope: Set<string>,
  renameMap: Map<string, string>,
): FunctionCallNode {
  const funcName = node.name.token.value.toUpperCase();

  if (funcName === "LET") return transformLet(node, scope, renameMap);
  if (funcName === "LAMBDA") return transformLambda(node, scope, renameMap);

  // standard function call: rename the function name + transform args
  const newName = transformToken(node.name, scope, renameMap);
  const newArgs = node.args.map((arg) =>
    arg.map((n) => transform(n, scope, renameMap)),
  );

  return { ...node, name: newName, args: newArgs };
}

function transformLet(
  node: FunctionCallNode,
  scope: Set<string>,
  renameMap: Map<string, string>,
): FunctionCallNode {
  // LET(name1, value1, name2, value2, ..., expression)
  // Names are not renamed. Values are transformed with the scope at that point.
  // Each name is added to scope AFTER its value is transformed.
  const currentScope = new Set(scope);
  const newArgs: Node[][] = [];
  const numArgs = node.args.length;

  let i = 0;
  while (i < numArgs) {
    const arg = node.args[i];

    // last arg is the body expression
    if (i === numArgs - 1) {
      newArgs.push(arg.map((n) => transform(n, currentScope, renameMap)));
      i++;
      continue;
    }

    // name declaration — don't transform, just pass through
    newArgs.push(arg);

    // extract the declared name
    let declName: string | undefined;
    for (const n of arg) {
      if (n.kind === "token" && n.token.type === TokenType.Identifier) {
        declName = n.token.value;
        break;
      }
    }

    // value — transform with current scope (before adding declName)
    if (i + 1 < numArgs) {
      const valArg = node.args[i + 1];
      newArgs.push(valArg.map((n) => transform(n, currentScope, renameMap)));
      if (declName) currentScope.add(declName);
      i += 2;
    } else {
      i++;
    }
  }

  return { ...node, args: newArgs };
}

function transformLambda(
  node: FunctionCallNode,
  scope: Set<string>,
  renameMap: Map<string, string>,
): FunctionCallNode {
  // LAMBDA(param1, param2, ..., body)
  // Params are not renamed. Body is transformed with params added to scope.
  const currentScope = new Set(scope);
  const newArgs: Node[][] = [];
  const numArgs = node.args.length;

  for (let i = 0; i < numArgs; i++) {
    const arg = node.args[i];

    if (i === numArgs - 1) {
      // body expression — transform with all params in scope
      newArgs.push(arg.map((n) => transform(n, currentScope, renameMap)));
    } else {
      // parameter declaration — don't transform, add to scope
      newArgs.push(arg);
      for (const n of arg) {
        if (n.kind === "token" && n.token.type === TokenType.Identifier) {
          currentScope.add(n.token.value);
          break;
        }
      }
    }
  }

  return { ...node, args: newArgs };
}
