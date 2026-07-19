/**
 * LAMBDA wrap/unwrap utilities.
 *
 * Used by both adapters (Excel, GSheets) and by the publish/extract flows
 * in both the CLI and the Excel add-in. Pure string manipulation, zero deps.
 *
 * GSheets named functions store arguments separately from the body, so we
 * convert between the wrapped form ("LAMBDA(x, x+1)") and the unwrapped
 * form ({args: ["x"], body: "x+1"}).
 *
 * Excel stores the full LAMBDA wrapper as the formula, but we still need
 * to parse it during extract to populate argument names.
 */

/**
 * Unwrap a LAMBDA definition into parameter names and body expression.
 *
 * "LAMBDA(x, y, x + y)" → { args: ["x", "y"], body: "x + y" }
 *
 * Handles nested LAMBDAs/parens AND quoted strings (so the comma in
 * "Hello, " doesn't get treated as an argument separator).
 */
export function unwrapLambda(definition: string): {
  args: string[];
  body: string;
} {
  let def = definition.trim();
  if (def.startsWith("=")) def = def.slice(1).trim();

  const match = /^LAMBDA\s*\(/i.exec(def);
  if (!match) {
    return { args: [], body: def };
  }

  const innerStart = match[0].length;
  let depth = 1;
  let i = innerStart;
  while (i < def.length && depth > 0) {
    if (def[i] === "(") depth++;
    else if (def[i] === ")") depth--;
    i++;
  }
  const inner = def.slice(innerStart, i - 1);

  // Split on top-level commas, respecting nested parens AND quoted strings.
  const parts: string[] = [];
  let current = "";
  depth = 0;
  let inString = false;
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j];
    if (ch === '"' && !inString) {
      inString = true;
    } else if (ch === '"' && inString) {
      if (j + 1 < inner.length && inner[j + 1] === '"') {
        current += ch;
        j++;
        current += inner[j];
        continue;
      }
      inString = false;
    }

    if (!inString) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  parts.push(current.trim());

  if (parts.length < 2) {
    return { args: [], body: inner };
  }

  const body = parts[parts.length - 1];
  const args = parts.slice(0, -1).map((a) => a.trim());

  return { args, body };
}

/**
 * Re-wrap arguments and body into a LAMBDA definition.
 * Inverse of unwrapLambda.
 */
export function wrapLambda(args: string[], body: string): string {
  if (args.length === 0) return body;
  return `LAMBDA(${args.join(", ")}, ${body})`;
}
