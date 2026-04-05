import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, "dist");
const src = join(__dirname, "src");
const coreIIFE = join(
  __dirname,
  "..",
  "core",
  "dist",
  "formulary.gas.js",
);

mkdirSync(dist, { recursive: true });

// Copy core IIFE bundle
if (existsSync(coreIIFE)) {
  cpSync(coreIIFE, join(dist, "core.js"));
} else {
  console.error(
    "Core IIFE not found. Run `pnpm --filter @formulary/core build:gas` first.",
  );
  process.exit(1);
}

// Copy all source files
for (const pattern of ["*.js", "*.html"]) {
  // Simple copy of all .js and .html files from src/
  const { readdirSync } = await import("fs");
  for (const file of readdirSync(src)) {
    if (
      (pattern === "*.js" && file.endsWith(".js")) ||
      (pattern === "*.html" && file.endsWith(".html"))
    ) {
      cpSync(join(src, file), join(dist, file));
    }
  }
}

// Copy appsscript.json
cpSync(join(src, "appsscript.json"), join(dist, "appsscript.json"));

// Copy .clasp.json if it exists (user must create from template)
const claspJson = join(__dirname, ".clasp.json");
if (existsSync(claspJson)) {
  // Rewrite rootDir to point at dist
  const clasp = JSON.parse(readFileSync(claspJson, "utf8"));
  clasp.rootDir = "dist";
  writeFileSync(join(__dirname, ".clasp.json"), JSON.stringify(clasp, null, 2));
}

console.log("Build complete → dist/");
