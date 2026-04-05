import { tokenize, TokenType, type Token, reconstruct } from "./refactoring/tokenizer.js";
import {
  parse,
  nodeToString,
  type Node,
  type TokenNode,
  type FunctionCallNode,
} from "./refactoring/parser.js";

/**
 * Functions that require _xlfn._xlws. prefix — worksheet functions that
 * shadow legacy names.
 */
const XLWS_FUNCTIONS = new Set(["FILTER", "SORT"]);

/**
 * Functions that require _xlfn. prefix in xlsx storage.
 * Complete list from XlsxWriter (Excel 2010+ "future functions").
 */
const XLFN_FUNCTIONS = new Set([
  "ACOT", "ACOTH", "AGGREGATE", "ANCHORARRAY", "ARABIC", "ARRAYTOTEXT",
  "BASE", "BETA.DIST", "BETA.INV", "BINOM.DIST", "BINOM.DIST.RANGE",
  "BINOM.INV", "BITAND", "BITLSHIFT", "BITOR", "BITRSHIFT", "BITXOR",
  "BYCOL", "BYROW", "CEILING.MATH", "CEILING.PRECISE", "CHISQ.DIST",
  "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "CHISQ.TEST",
  "CHOOSECOLS", "CHOOSEROWS", "COMBINA", "CONCAT", "CONFIDENCE.NORM",
  "CONFIDENCE.T", "COT", "COTH", "COVARIANCE.P", "COVARIANCE.S",
  "CSC", "CSCH", "DAYS", "DECIMAL", "DROP", "ERF.PRECISE",
  "ERFC.PRECISE", "EXPAND", "EXPON.DIST", "F.DIST", "F.DIST.RT",
  "F.INV", "F.INV.RT", "F.TEST", "FILTER", "FILTERXML", "FLOOR.MATH",
  "FLOOR.PRECISE", "FORECAST.ETS", "FORECAST.ETS.CONFINT",
  "FORECAST.ETS.SEASONALITY", "FORECAST.ETS.STAT", "FORECAST.LINEAR",
  "FORMULATEXT", "GAMMA", "GAMMA.DIST", "GAMMA.INV",
  "GAMMALN.PRECISE", "GAUSS", "HSTACK", "HYPGEOM.DIST", "IFNA",
  "IFS", "IMAGE", "IMCOSH", "IMCOT", "IMCSC", "IMCSCH", "IMSEC",
  "IMSECH", "IMSINH", "IMTAN", "ISFORMULA", "ISOMITTED",
  "ISOWEEKNUM", "LAMBDA", "LET", "LOGNORM.DIST", "LOGNORM.INV",
  "MAKEARRAY", "MAP", "MAXIFS", "MINIFS", "MODE.MULT", "MODE.SNGL",
  "MUNIT", "NEGBINOM.DIST", "NORM.DIST", "NORM.INV", "NORM.S.DIST",
  "NORM.S.INV", "NUMBERVALUE", "PDURATION", "PERCENTILE.EXC",
  "PERCENTILE.INC", "PERCENTRANK.EXC", "PERCENTRANK.INC",
  "PERMUTATIONA", "PHI", "POISSON.DIST", "QUARTILE.EXC",
  "QUARTILE.INC", "QUERYSTRING", "RANDARRAY", "RANK.AVG", "RANK.EQ",
  "REDUCE", "RRI", "SCAN", "SEC", "SECH", "SEQUENCE", "SHEET",
  "SHEETS", "SINGLE", "SKEW.P", "SORT", "SORTBY", "STDEV.P",
  "STDEV.S", "SWITCH", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV",
  "T.INV.2T", "T.TEST", "TAKE", "TEXTAFTER", "TEXTBEFORE",
  "TEXTJOIN", "TEXTSPLIT", "TOCOL", "TOROW", "UNICHAR", "UNICODE",
  "UNIQUE", "VALUETOTEXT", "VAR.P", "VAR.S", "VSTACK", "WEBSERVICE",
  "WEIBULL.DIST", "WRAPCOLS", "WRAPROWS", "XLOOKUP", "XMATCH",
  "XOR", "Z.TEST",
]);

/**
 * Add _xlfn./_xlpm. prefixes for xlsx storage.
 *
 * - _xlfn. on modern function names (LAMBDA, LET, MAP, etc.)
 * - _xlpm. on LAMBDA parameter declarations and their in-scope references
 * - _xlpm. on LET binding name declarations and their in-scope references
 */
export function addPrefixes(formula: string): string {
  const tokens = tokenize(formula);
  const nodes = parse(tokens);
  const transformed = nodes.map((n) => walk(n, new Set()));
  return transformed.map(nodeToString).join("");
}

/**
 * Strip _xlfn./_xlpm. prefixes from xlsx storage back to human-readable form.
 * Token-level only — no AST needed.
 */
export function stripPrefixes(formula: string): string {
  const tokens = tokenize(formula);
  const stripped = tokens.map((t) => {
    if (t.type !== TokenType.Identifier) return t;
    let value = t.value;
    if (value.startsWith("_xlfn._xlws.")) {
      value = value.slice(12);
    } else if (value.startsWith("_xlfn.")) {
      value = value.slice(6);
    } else if (value.startsWith("_xlop.")) {
      // Optional param declaration: _xlop.x → [x]
      value = "[" + value.slice(6) + "]";
    } else if (value.startsWith("_xlpm.")) {
      value = value.slice(6);
    }
    return { ...t, value };
  });
  return reconstruct(stripped);
}

// ─── AST walker ─────────────────────────────────────────────────────────────

function walk(node: Node, scope: Set<string>): Node {
  if (node.kind === "call") return walkCall(node, scope);
  return walkToken(node, scope);
}

function walkToken(node: TokenNode, scope: Set<string>): TokenNode {
  if (node.token.type !== TokenType.Identifier) return node;
  const name = node.token.value;
  if (scope.has(name)) {
    return { kind: "token", token: { ...node.token, value: "_xlpm." + name } };
  }
  return node;
}

function walkCall(
  node: FunctionCallNode,
  scope: Set<string>,
): FunctionCallNode {
  const funcName = node.name.token.value.toUpperCase();

  // Determine the new function name token
  let newName: TokenNode;
  if (XLFN_FUNCTIONS.has(funcName)) {
    // FILTER and SORT need _xlfn._xlws. (they shadow legacy functions)
    const prefix = XLWS_FUNCTIONS.has(funcName) ? "_xlfn._xlws." : "_xlfn.";
    newName = {
      kind: "token",
      token: { ...node.name.token, value: prefix + node.name.token.value },
    };
  } else {
    // Non-XLFN function: prefix with _xlpm. if it's a scoped reference
    newName = walkToken(node.name, scope);
  }

  if (funcName === "LAMBDA") return walkLambda(node, scope, newName);
  if (funcName === "LET") return walkLet(node, scope, newName);

  // Standard function call: just recurse into args
  const newArgs = node.args.map((arg) =>
    arg.map((n) => walk(n, scope)),
  );
  return { ...node, name: newName, args: newArgs };
}

function walkLambda(
  node: FunctionCallNode,
  scope: Set<string>,
  newName: TokenNode,
): FunctionCallNode {
  // LAMBDA(param1, param2, ..., body)
  // Prefix each param with _xlpm., add original to scope, walk body.
  const currentScope = new Set(scope);
  const newArgs: Node[][] = [];
  const numArgs = node.args.length;

  for (let i = 0; i < numArgs; i++) {
    const arg = node.args[i];

    if (i === numArgs - 1) {
      // body — walk with all params in scope
      newArgs.push(arg.map((n) => walk(n, currentScope)));
    } else {
      // parameter declaration — add to scope
      // Optional params have brackets: [_ctx] → _xlop._ctx (no brackets)
      // Required params: _ctx → _xlpm._ctx
      const isOptional = arg.some(
        (n) => n.kind === "token" && n.token.type === TokenType.LBracket,
      );
      const prefix = isOptional ? "_xlop." : "_xlpm.";
      const newArg: Node[] = [];
      for (const n of arg) {
        if (n.kind === "token" && n.token.type === TokenType.Identifier) {
          currentScope.add(n.token.value);
          newArg.push({
            kind: "token" as const,
            token: { ...n.token, value: prefix + n.token.value },
          });
        } else if (
          isOptional &&
          n.kind === "token" &&
          (n.token.type === TokenType.LBracket ||
            n.token.type === TokenType.RBracket)
        ) {
          // Drop brackets — _xlop. prefix replaces them
        } else {
          newArg.push(n);
        }
      }
      newArgs.push(newArg);
    }
  }

  return { ...node, name: newName, args: newArgs };
}

function walkLet(
  node: FunctionCallNode,
  scope: Set<string>,
  newName: TokenNode,
): FunctionCallNode {
  // LET(name1, value1, name2, value2, ..., expression)
  // Prefix each binding name with _xlpm., add original to scope after its value.
  const currentScope = new Set(scope);
  const newArgs: Node[][] = [];
  const numArgs = node.args.length;

  let i = 0;
  while (i < numArgs) {
    const arg = node.args[i];

    // last arg is the body expression
    if (i === numArgs - 1) {
      newArgs.push(arg.map((n) => walk(n, currentScope)));
      i++;
      continue;
    }

    // name declaration — prefix Identifier with _xlpm.
    let declName: string | undefined;
    const newArg = arg.map((n) => {
      if (n.kind === "token" && n.token.type === TokenType.Identifier) {
        declName = n.token.value;
        return {
          kind: "token" as const,
          token: { ...n.token, value: "_xlpm." + n.token.value },
        };
      }
      return n;
    });
    newArgs.push(newArg);

    // value — walk with current scope (before adding declName)
    if (i + 1 < numArgs) {
      const valArg = node.args[i + 1];
      newArgs.push(valArg.map((n) => walk(n, currentScope)));
      if (declName) currentScope.add(declName);
      i += 2;
    } else {
      i++;
    }
  }

  return { ...node, name: newName, args: newArgs };
}
