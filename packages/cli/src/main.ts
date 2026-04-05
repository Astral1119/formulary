#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { install } from "./commands/install.js";

const USAGE = `formulary — spreadsheet package manager

Usage:
  formulary install <package-dir> <file.xlsx>   Install a local package into an xlsx file
  formulary help                                Show this help

Options:
  --create   Create the xlsx file if it doesn't exist
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];

  if (command === "install") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        create: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: install requires a package directory path");
      console.error("Usage: formulary install <package-dir> <file.xlsx>");
      process.exit(1);
    }

    const packageDir = resolve(positionals[0]);
    const xlsxPath = positionals[1]
      ? resolve(positionals[1])
      : resolve("workbook.xlsx");

    await install(packageDir, xlsxPath, { create: values.create ?? false });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(USAGE);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
