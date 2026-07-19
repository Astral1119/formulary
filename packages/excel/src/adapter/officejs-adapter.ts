/**
 * Office JS adapter for live Excel workbooks.
 *
 * Implements PlatformAdapter using the Excel JavaScript API (Office.js).
 * Unlike the CLI's ExcelAdapter (which works on jszip in memory), this
 * operates on the active workbook in real time via Excel.run().
 */

// NOTE: No addPrefixes/stripPrefixes here. The Office JS Names API operates at
// the formula level (human-readable), not the xlsx XML storage level. Prefixes
// like _xlfn.LAMBDA/_xlpm. are only needed for raw xlsx XML manipulation (CLI).
//
// The Names API requires formulas to start with "=", but stored definitions in
// functions.json omit it. We normalize on the way in/out.
import type {
  PlatformAdapter,
  NamedFunction,
  ProjectMetadata,
  Lockfile,
  LockEntry,
} from "@formulary/core";

const MANIFEST_SHEET = "__manifest__";
const LOCK_SHEET = "__lock__";

export class OfficeJSAdapter implements PlatformAdapter {
  readonly platform = "excel" as const;

  // ─── Named Functions ──────────────────────────────────────────────

  async listFunctions(): Promise<NamedFunction[]> {
    return Excel.run(async (ctx) => {
      const names = ctx.workbook.names;
      names.load("items/name,items/formula,items/comment");
      await ctx.sync();

      return names.items
        .filter((item) => {
          // Skip Excel's internal compatibility names. These are added by
          // Excel itself for cross-version LAMBDA support and aren't user
          // functions.
          if (item.name.startsWith("_xl")) return false;
          // Only include LAMBDAs — other defined names (cell refs, constants)
          // aren't packageable.
          const def = item.formula?.startsWith("=")
            ? item.formula.slice(1)
            : item.formula ?? "";
          return /^\s*(?:_xlfn\.)?LAMBDA\s*\(/i.test(def);
        })
        .map((item) => ({
          name: item.name,
          definition: item.formula?.startsWith("=")
            ? item.formula.slice(1)
            : item.formula,
          description: item.comment ?? undefined,
        }));
    });
  }

  async createFunction(fn: NamedFunction): Promise<void> {
    await Excel.run(async (ctx) => {
      const formula = fn.definition.startsWith("=") ? fn.definition : "=" + fn.definition;
      ctx.workbook.names.add(fn.name, formula);
      if (fn.description) {
        const item = ctx.workbook.names.getItem(fn.name);
        item.comment = fn.description;
      }
      await ctx.sync();
    });
  }

  async updateFunction(fn: NamedFunction): Promise<void> {
    await Excel.run(async (ctx) => {
      const item = ctx.workbook.names.getItem(fn.name);
      item.formula = fn.definition.startsWith("=") ? fn.definition : "=" + fn.definition;
      if (fn.description) {
        item.comment = fn.description;
      }
      await ctx.sync();
    });
  }

  async deleteFunction(name: string): Promise<void> {
    await Excel.run(async (ctx) => {
      const item = ctx.workbook.names.getItem(name);
      item.delete();
      await ctx.sync();
    });
  }

  // ─── Metadata (hidden sheet) ──────────────────────────────────────

  async readMetadata(): Promise<ProjectMetadata | null> {
    return Excel.run(async (ctx) => {
      const sheet = this.getSheet(ctx, MANIFEST_SHEET);
      if (!sheet) return null;

      sheet.load("visibility");
      await ctx.sync();

      const range = sheet.getUsedRangeOrNullObject();
      range.load("values");
      await ctx.sync();

      if (range.isNullObject) return null;

      const meta: ProjectMetadata = { dependencies: {} };
      const rows: unknown[][] = range.values;

      // Skip header row. Col 0 = key, Col 1 = value.
      for (let i = 1; i < rows.length; i++) {
        const key = String(rows[i][0] ?? "").trim();
        const val = String(rows[i][1] ?? "").trim();
        if (!key) continue;

        if (key.startsWith("dep:")) {
          meta.dependencies[key.slice(4)] = val;
        } else {
          (meta as Record<string, unknown>)[key] = val;
        }
      }
      return meta;
    });
  }

  async writeMetadata(meta: ProjectMetadata): Promise<void> {
    await Excel.run(async (ctx) => {
      const sheet = await this.ensureHiddenSheet(ctx, MANIFEST_SHEET);

      const rows: string[][] = [["key", "value"]];

      for (const [key, val] of Object.entries(meta)) {
        if (key === "dependencies" || val === undefined) continue;
        rows.push([key, String(val)]);
      }

      for (const [name, version] of Object.entries(meta.dependencies)) {
        rows.push([`dep:${name}`, version]);
      }

      // Clear and write
      sheet.getUsedRangeOrNullObject().clear();
      await ctx.sync();

      if (rows.length > 0) {
        const range = sheet.getRangeByIndexes(0, 0, rows.length, 2);
        range.values = rows;
      }
      await ctx.sync();
    });
  }

  // ─── Lockfile (hidden sheet) ──────────────────────────────────────

  async readLockfile(): Promise<Lockfile | null> {
    return Excel.run(async (ctx) => {
      const sheet = this.getSheet(ctx, LOCK_SHEET);
      if (!sheet) return null;

      sheet.load("visibility");
      await ctx.sync();

      const range = sheet.getUsedRangeOrNullObject();
      range.load("values");
      await ctx.sync();

      if (range.isNullObject) return null;

      const lock: Lockfile = { packages: {} };
      const rows: unknown[][] = range.values;

      // Headers in row 0: package, version, integrity, dependencies, functions
      for (let i = 1; i < rows.length; i++) {
        const name = String(rows[i][0] ?? "").trim();
        if (!name) continue;

        lock.packages[name] = {
          version: String(rows[i][1] ?? "").trim(),
          integrity: String(rows[i][2] ?? "").trim() || undefined,
          dependencies: splitComma(String(rows[i][3] ?? "")),
          functions: splitComma(String(rows[i][4] ?? "")),
        };
      }
      return lock;
    });
  }

  async writeLockfile(lock: Lockfile): Promise<void> {
    await Excel.run(async (ctx) => {
      const sheet = await this.ensureHiddenSheet(ctx, LOCK_SHEET);

      const rows: string[][] = [
        ["package", "version", "integrity", "dependencies", "functions"],
      ];

      for (const name of Object.keys(lock.packages).sort()) {
        const entry = lock.packages[name];
        rows.push([
          name,
          entry.version,
          entry.integrity ?? "",
          (entry.dependencies ?? []).join(", "),
          (entry.functions ?? []).join(", "),
        ]);
      }

      sheet.getUsedRangeOrNullObject().clear();
      await ctx.sync();

      if (rows.length > 0) {
        const range = sheet.getRangeByIndexes(0, 0, rows.length, 5);
        range.values = rows;
      }
      await ctx.sync();
    });
  }

  // ─── Network ──────────────────────────────────────────────────────

  async fetchJSON(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.json();
  }

  async fetchBinary(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.arrayBuffer();
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /** Get a worksheet by name, or null if it doesn't exist. */
  private getSheet(
    ctx: Excel.RequestContext,
    name: string,
  ): Excel.Worksheet | null {
    const sheet = ctx.workbook.worksheets.getItemOrNullObject(name);
    return sheet;
  }

  /** Ensure a very-hidden sheet exists; create if needed. */
  private async ensureHiddenSheet(
    ctx: Excel.RequestContext,
    name: string,
  ): Promise<Excel.Worksheet> {
    let sheet = ctx.workbook.worksheets.getItemOrNullObject(name);
    sheet.load("isNullObject");
    await ctx.sync();

    if (sheet.isNullObject) {
      sheet = ctx.workbook.worksheets.add(name);
    }
    sheet.visibility = Excel.SheetVisibility.veryHidden;
    await ctx.sync();
    return sheet;
  }
}

function splitComma(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((x) => x.trim());
}
