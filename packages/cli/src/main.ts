#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { install } from "./commands/install.js";
import { remove } from "./commands/remove.js";
import { list } from "./commands/list.js";
import { init } from "./commands/init.js";
import { upgrade } from "./commands/upgrade.js";
import { pack } from "./commands/pack.js";
import { publish } from "./commands/publish.js";
import { extract } from "./commands/extract.js";
import { auth, authList, authRemove } from "./commands/auth.js";

const USAGE = `formulary — spreadsheet package manager

Usage:
  formulary install <package> [file.xlsx]    Install a package
  formulary remove <package> <file.xlsx>     Remove a package and orphaned deps
  formulary upgrade <package> <file.xlsx>    Upgrade a package to latest compatible
  formulary list <file.xlsx>                 List installed packages
  formulary pack <dir> [--output <path>]     Pack a directory into an .fpkg bundle
  formulary publish <dir-or-fpkg>           Publish a package to the registry via PR
  formulary publish <dir-or-fpkg> --dry-run Preview what would be published
  formulary extract <file.xlsx> -o <dir>    Extract functions from a workbook into a package dir
  formulary init [file.xlsx]                 Create a new xlsx with metadata sheets
  formulary auth [profile]                   Authenticate with Google (for --gsheets)
  formulary auth list                        List authenticated profiles
  formulary auth remove <profile>            Remove an authenticated profile
  formulary help                             Show this help

  <package> can be:
    ./path/to/package    Local package directory
    name                 Package from the registry (latest version)
    name@1.2.0           Package from the registry (specific version)

Options:
  --create              Create the xlsx file if it doesn't exist (install only)
  --gsheets <url>       Target a Google Sheets spreadsheet instead of xlsx
  --headed              Show the browser window (for debugging)
  --profile <name>      Google auth profile (default: "default")
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];

  if (command === "auth") {
    if (args[1] === "list") {
      await authList();
    } else if (args[1] === "remove" || args[1] === "rm") {
      if (!args[2]) {
        console.error("Usage: formulary auth remove <profile>");
        process.exit(1);
      }
      authRemove(args[2]);
    } else {
      const profile = args[1] ?? "default";
      await auth(profile);
    }
  } else if (command === "install") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        create: { type: "boolean", default: false },
        gsheets: { type: "string" },
        profile: { type: "string", default: "default" },
        headed: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: install requires a package source");
      console.error("Usage: formulary install <package-or-path> [file.xlsx]");
      process.exit(1);
    }

    if (values.gsheets) {
      const { openGSheets } = await import("./adapter/gsheets-open.js");
      const { adapter, cleanup } = await openGSheets(
        values.gsheets,
        values.profile ?? "default",
        values.headed ?? false,
      );
      try {
        await install(positionals[0], "", {
          create: false,
          adapter,
        });
      } finally {
        await cleanup();
      }
    } else {
      const source = positionals[0];
      const xlsxPath = positionals[1]
        ? resolve(positionals[1])
        : resolve("workbook.xlsx");
      await install(source, xlsxPath, { create: values.create ?? false });
    }
  } else if (command === "remove") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        gsheets: { type: "string" },
        profile: { type: "string", default: "default" },
        headed: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: remove requires a package name");
      process.exit(1);
    }

    if (values.gsheets) {
      const { openGSheets } = await import("./adapter/gsheets-open.js");
      const { adapter, cleanup } = await openGSheets(
        values.gsheets,
        values.profile ?? "default",
        values.headed ?? false,
      );
      try {
        await remove(positionals[0], "", { adapter });
      } finally {
        await cleanup();
      }
    } else {
      if (positionals.length < 2) {
        console.error("Error: remove requires a package name and xlsx path");
        process.exit(1);
      }
      await remove(positionals[0], resolve(positionals[1]));
    }
  } else if (command === "upgrade") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        gsheets: { type: "string" },
        profile: { type: "string", default: "default" },
        headed: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: upgrade requires a package name");
      process.exit(1);
    }

    if (values.gsheets) {
      const { openGSheets } = await import("./adapter/gsheets-open.js");
      const { adapter, cleanup } = await openGSheets(
        values.gsheets,
        values.profile ?? "default",
        values.headed ?? false,
      );
      try {
        await upgrade(positionals[0], "", { adapter });
      } finally {
        await cleanup();
      }
    } else {
      if (positionals.length < 2) {
        console.error("Error: upgrade requires a package name and xlsx path");
        process.exit(1);
      }
      await upgrade(positionals[0], resolve(positionals[1]));
    }
  } else if (command === "extract") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        output: { type: "string", short: "o" },
        platform: { type: "string" },
        force: { type: "boolean", default: false },
        gsheets: { type: "string" },
        profile: { type: "string", default: "default" },
        headed: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (!values.output) {
      console.error("Error: extract requires --output <dir>");
      console.error(
        "Usage: formulary extract <file.xlsx> --output <dir> [--platform excel|gsheets] [--force]",
      );
      process.exit(1);
    }

    const platform = values.platform as
      | "excel"
      | "gsheets"
      | "lattice"
      | undefined;

    if (values.gsheets) {
      const { openGSheets } = await import("./adapter/gsheets-open.js");
      const { adapter, cleanup } = await openGSheets(
        values.gsheets,
        values.profile ?? "default",
        values.headed ?? false,
      );
      try {
        await extract("", {
          output: values.output,
          adapter,
          platform,
          force: values.force ?? false,
        });
      } finally {
        await cleanup();
      }
    } else {
      if (positionals.length < 1) {
        console.error("Error: extract requires an xlsx path or --gsheets URL");
        process.exit(1);
      }
      await extract(resolve(positionals[0]), {
        output: values.output,
        platform,
        force: values.force ?? false,
      });
    }
  } else if (command === "publish") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        "dry-run": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: publish requires a directory or .fpkg path");
      console.error("Usage: formulary publish <dir-or-fpkg> [--dry-run]");
      process.exit(1);
    }

    await publish(resolve(positionals[0]), {
      dryRun: values["dry-run"] ?? false,
    });
  } else if (command === "list") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        gsheets: { type: "string" },
        profile: { type: "string", default: "default" },
        headed: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (values.gsheets) {
      const { openGSheets } = await import("./adapter/gsheets-open.js");
      const { adapter, cleanup } = await openGSheets(
        values.gsheets,
        values.profile ?? "default",
        values.headed ?? false,
      );
      try {
        await list("", { adapter });
      } finally {
        await cleanup();
      }
    } else {
      const xlsxPath = positionals[0]
        ? resolve(positionals[0])
        : resolve("workbook.xlsx");
      await list(xlsxPath);
    }
  } else if (command === "pack") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Error: pack requires a directory path");
      console.error("Usage: formulary pack <dir> [--output <path>]");
      process.exit(1);
    }

    await pack(resolve(positionals[0]), values.output);
  } else if (command === "init") {
    const xlsxPath = args[1] ? resolve(args[1]) : resolve("workbook.xlsx");
    await init(xlsxPath);
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
