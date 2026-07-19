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
import { newProject } from "./commands/new.js";
import { check } from "./commands/check.js";
import { info } from "./commands/info.js";
import { search } from "./commands/search.js";
import { dev } from "./commands/dev.js";
import { test as testCommand } from "./commands/test.js";
import { preview } from "./commands/preview.js";
import {
  versionShow,
  versionBump,
  versionSet,
} from "./commands/version.js";
import {
  useProject,
  projectsList,
  forgetProjectCommand,
} from "./commands/use.js";
import { getActive } from "./projects.js";
import type { PlatformAdapter } from "@formulary/core";

const USAGE = `formulary — spreadsheet package manager

Project workflow:
  formulary new <target>                     Create a new project
    formulary new ./mypkg/                     - directory (agent / power user)
    formulary new mypkg.xlsx                   - local xlsx file
    formulary new --gsheets --name <name>      - new Google Sheet
  formulary use <name>                       Switch active project
  formulary projects                         List known projects
  formulary forget <name>                    Remove project from registry

Authoring:
  formulary check [dir]                      Validate the active project's manifest
  formulary info <package>                   Show registry info for a package
  formulary search [query]                   Search the registry
  formulary dev <package> [target]           Fetch a package as a dev workspace
  formulary version                          Show the active project's version
  formulary version bump (major|minor|patch) Bump the active project's version
  formulary version set <x.y.z>              Set the active project's version
  formulary test                             Run tests/ against the active project
  formulary preview                          Build a temp xlsx with the project + deps installed
  formulary preview --teardown               Remove the active preview workbook
  formulary extract --output <dir>           Extract functions from a workbook to a directory
  formulary pack <dir> [--output <path>]     Pack a directory into a .fpkg
  formulary publish <dir-or-fpkg>            Publish to the registry

Installation:
  formulary install <package> [target]       Install a package (target = active project if omitted)
  formulary remove <package> [target]        Remove a package and orphaned deps
  formulary upgrade <package> [target]       Upgrade a package to latest compatible
  formulary list [target]                    List installed packages
  formulary init [file.xlsx]                 Create an empty workbook with metadata sheets

Auth:
  formulary auth [profile]                   Sign in with Google + GitHub
  formulary auth list                        List authenticated profiles
  formulary auth remove <profile>            Remove a profile

  formulary help                             Show this help

Targets:
  Most commands accept a target. If omitted, the active project is used:
    file.xlsx                                  - local xlsx workbook
    --gsheets <url>                            - Google Sheets spreadsheet
    (omitted)                                  - active project from \`formulary projects\`

Options (where applicable):
  --create              Create the xlsx file if it doesn't exist
  --gsheets <url>       Target a Google Sheets spreadsheet
  --headed              Show the browser window (Playwright)
  --profile <name>      Auth profile (default: "default")
  --dry-run             Preview without making changes (publish)
  --force               Skip preflight blocking (publish, extract)
`;

// ─── Active project resolution ────────────────────────────────────

interface ResolvedTarget {
  /** xlsx file path, or empty if using a custom adapter */
  xlsxPath: string;
  /** Custom adapter (used for gsheets and active-project gsheets) */
  adapter?: PlatformAdapter;
  /** Cleanup callback for adapter */
  cleanup?: () => Promise<void>;
}

interface TargetFlags {
  gsheets?: string;
  profile?: string;
  headed?: boolean;
}

/**
 * Resolve the target for a workbook-bound command. Order:
 *   1. --gsheets URL (explicit gsheets)
 *   2. positional xlsx path (explicit local)
 *   3. active project (xlsx or gsheets)
 *   4. error
 */
async function resolveTarget(
  positionalPath: string | undefined,
  flags: TargetFlags,
): Promise<ResolvedTarget> {
  // Explicit --gsheets URL
  if (flags.gsheets) {
    const { openGSheets } = await import("./adapter/gsheets-open.js");
    const { adapter, cleanup } = await openGSheets(
      flags.gsheets,
      flags.profile ?? "default",
      flags.headed ?? false,
    );
    return { xlsxPath: "", adapter, cleanup };
  }

  // Explicit positional xlsx
  if (positionalPath) {
    return { xlsxPath: resolve(positionalPath) };
  }

  // Fall back to active project
  const active = getActive();
  if (!active) {
    throw new Error(
      "no target specified and no active project.\n" +
        "  pass a file.xlsx, --gsheets <url>, or run `formulary use <name>`",
    );
  }

  if (active.target.kind === "xlsx") {
    return { xlsxPath: active.target.path };
  }
  if (active.target.kind === "gsheets") {
    const { openGSheets } = await import("./adapter/gsheets-open.js");
    const { adapter, cleanup } = await openGSheets(
      active.target.url,
      active.target.profile,
      flags.headed ?? false,
    );
    return { xlsxPath: "", adapter, cleanup };
  }

  throw new Error(
    `active project "${active.name}" is a directory project. ` +
      `Pass a workbook target explicitly.`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];

  // Project commands
  if (command === "new") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        name: { type: "string" },
        "depends-on": { type: "string" },
        platforms: { type: "string" },
        owner: { type: "string" },
        description: { type: "string" },
        gsheets: { type: "boolean", default: false },
        profile: { type: "string", default: "default" },
      },
      allowPositionals: true,
    });

    await newProject(positionals[0], {
      name: values.name,
      dependsOn: values["depends-on"],
      platforms: values.platforms,
      owner: values.owner,
      description: values.description,
      gsheets: values.gsheets,
      profile: values.profile,
    });
    return;
  }

  if (command === "use") {
    if (!args[1]) {
      console.error("Usage: formulary use <project-name>");
      process.exit(1);
    }
    useProject(args[1]);
    return;
  }

  if (command === "projects") {
    projectsList();
    return;
  }

  if (command === "forget") {
    if (!args[1]) {
      console.error("Usage: formulary forget <project-name>");
      process.exit(1);
    }
    forgetProjectCommand(args[1]);
    return;
  }

  if (command === "check") {
    const dir = args[1];
    await check({ dir });
    return;
  }

  if (command === "info") {
    if (!args[1]) {
      console.error("Usage: formulary info <package>");
      process.exit(1);
    }
    await info(args[1]);
    return;
  }

  if (command === "search") {
    await search(args[1]);
    return;
  }

  if (command === "version") {
    const sub = args[1];
    if (!sub) {
      await versionShow();
      return;
    }
    if (sub === "bump") {
      const kind = args[2];
      if (kind !== "major" && kind !== "minor" && kind !== "patch") {
        console.error("Usage: formulary version bump (major|minor|patch)");
        process.exit(1);
      }
      await versionBump(kind);
      return;
    }
    if (sub === "set") {
      if (!args[2]) {
        console.error("Usage: formulary version set <x.y.z>");
        process.exit(1);
      }
      await versionSet(args[2]);
      return;
    }
    console.error(`Unknown version subcommand: ${sub}`);
    process.exit(1);
  }

  if (command === "test") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        tags: { type: "string" },
      },
      allowPositionals: true,
    });
    await testCommand({
      dir: positionals[0],
      tags: values.tags,
    });
    return;
  }

  if (command === "preview") {
    const restArgs = args.slice(1);
    const { values } = parseArgs({
      args: restArgs,
      options: {
        teardown: { type: "boolean", default: false },
      },
    });
    await preview({ teardown: values.teardown });
    return;
  }

  if (command === "dev") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        version: { type: "string" },
        output: { type: "string", short: "o" },
        gsheets: { type: "boolean", default: false },
        profile: { type: "string", default: "default" },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      console.error("Usage: formulary dev <package> [target] [options]");
      process.exit(1);
    }

    const pkgName = positionals[0];
    const xlsxPath = positionals[1]?.endsWith(".xlsx") ? positionals[1] : undefined;

    await dev(pkgName, {
      version: values.version,
      output: values.output,
      gsheets: values.gsheets,
      profile: values.profile,
      xlsxPath,
    });
    return;
  }

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
    return;
  }

  // ─── Workbook-targeting commands ────────────────────────────────

  if (command === "install") {
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
      console.error("Usage: formulary install <package-or-path> [target]");
      process.exit(1);
    }

    const target = await resolveTarget(positionals[1], values);
    try {
      await install(positionals[0], target.xlsxPath, {
        create: values.create ?? false,
        adapter: target.adapter,
      });
    } finally {
      if (target.cleanup) await target.cleanup();
    }
    return;
  }

  if (command === "remove") {
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

    const target = await resolveTarget(positionals[1], values);
    try {
      await remove(positionals[0], target.xlsxPath, {
        adapter: target.adapter,
      });
    } finally {
      if (target.cleanup) await target.cleanup();
    }
    return;
  }

  if (command === "upgrade") {
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

    const target = await resolveTarget(positionals[1], values);
    try {
      await upgrade(positionals[0], target.xlsxPath, {
        adapter: target.adapter,
      });
    } finally {
      if (target.cleanup) await target.cleanup();
    }
    return;
  }

  if (command === "list") {
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

    const target = await resolveTarget(positionals[0], values);
    try {
      await list(target.xlsxPath, { adapter: target.adapter });
    } finally {
      if (target.cleanup) await target.cleanup();
    }
    return;
  }

  if (command === "extract") {
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
      process.exit(1);
    }

    const platform = values.platform as
      | "excel"
      | "gsheets"
      | "lattice"
      | undefined;

    const target = await resolveTarget(positionals[0], values);
    try {
      await extract(target.xlsxPath, {
        output: values.output,
        adapter: target.adapter,
        platform,
        force: values.force ?? false,
      });
    } finally {
      if (target.cleanup) await target.cleanup();
    }
    return;
  }

  if (command === "publish") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    // Default to active project's directory if no source given
    let source = positionals[0];
    if (!source) {
      const active = getActive();
      if (active && active.target.kind === "directory") {
        source = active.target.path;
      } else {
        console.error("Error: publish requires a directory or .fpkg path");
        console.error("Usage: formulary publish <dir-or-fpkg> [--dry-run] [--force]");
        process.exit(1);
      }
    }

    await publish(resolve(source), {
      dryRun: values["dry-run"] ?? false,
      force: values.force ?? false,
    });
    return;
  }

  if (command === "pack") {
    const restArgs = args.slice(1);
    const { values, positionals } = parseArgs({
      args: restArgs,
      options: {
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    let source = positionals[0];
    if (!source) {
      const active = getActive();
      if (active && active.target.kind === "directory") {
        source = active.target.path;
      } else {
        console.error("Error: pack requires a directory path");
        process.exit(1);
      }
    }

    await pack(resolve(source), values.output);
    return;
  }

  if (command === "init") {
    const xlsxPath = args[1] ? resolve(args[1]) : resolve("workbook.xlsx");
    await init(xlsxPath);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error(USAGE);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
