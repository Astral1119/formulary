import { addPrefixes, stripPrefixes } from "@formulary/core";
import type {
  PlatformAdapter,
  NamedFunction,
  ProjectMetadata,
  Lockfile,
  LockEntry,
} from "@formulary/core";
import { XlsxFile, type SheetCell } from "./xlsx.js";
import { unwrapLambda } from "./lambda.js";

const MANIFEST_SHEET = "__manifest__";
const LOCK_SHEET = "__lock__";

export class ExcelAdapter implements PlatformAdapter {
  readonly platform = "excel" as const;

  private constructor(private xlsx: XlsxFile) {}

  static async open(data: Uint8Array): Promise<ExcelAdapter> {
    const xlsx = await XlsxFile.open(data);
    return new ExcelAdapter(xlsx);
  }

  static async create(): Promise<ExcelAdapter> {
    const xlsx = await XlsxFile.create();
    return new ExcelAdapter(xlsx);
  }

  async save(): Promise<Uint8Array> {
    return this.xlsx.save();
  }

  // ─── Named Functions ────────────────────────────────────────────────

  async listFunctions(): Promise<NamedFunction[]> {
    return this.xlsx.readDefinedNames().map((dn) => {
      const definition = stripPrefixes(dn.value);
      const { args } = unwrapLambda(definition);
      return {
        name: dn.name,
        definition,
        description: dn.comment,
        arguments: args,
      };
    });
  }

  async createFunction(fn: NamedFunction): Promise<void> {
    const existing = this.xlsx.readDefinedNames();
    existing.push({
      name: fn.name,
      value: addPrefixes(fn.definition),
      comment: fn.description,
    });
    this.xlsx.writeDefinedNames(existing);
  }

  async updateFunction(fn: NamedFunction): Promise<void> {
    const existing = this.xlsx.readDefinedNames();
    const idx = existing.findIndex(
      (d) => d.name.toUpperCase() === fn.name.toUpperCase(),
    );
    if (idx >= 0) {
      existing[idx] = {
        name: fn.name,
        value: addPrefixes(fn.definition),
        comment: fn.description,
      };
    } else {
      existing.push({
        name: fn.name,
        value: addPrefixes(fn.definition),
        comment: fn.description,
      });
    }
    this.xlsx.writeDefinedNames(existing);
  }

  async deleteFunction(name: string): Promise<void> {
    const existing = this.xlsx.readDefinedNames();
    const filtered = existing.filter(
      (d) => d.name.toUpperCase() !== name.toUpperCase(),
    );
    this.xlsx.writeDefinedNames(filtered);
  }

  // ─── Metadata (hidden sheet) ────────────────────────────────────────

  async readMetadata(): Promise<ProjectMetadata | null> {
    const cells = await this.xlsx.readHiddenSheet(MANIFEST_SHEET);
    if (cells.length === 0) return null;

    const meta: ProjectMetadata = { dependencies: {} };
    // Skip header row (row 1). Key in col 1, value in col 2.
    for (const cell of cells) {
      if (cell.row <= 1) continue;
      if (cell.col !== 1) continue;
      const key = cell.value.trim();
      if (!key) continue;

      const valCell = cells.find((c) => c.row === cell.row && c.col === 2);
      const val = valCell?.value.trim() ?? "";

      if (key.startsWith("dep:")) {
        meta.dependencies[key.slice(4)] = val;
      } else {
        (meta as any)[key] = val;
      }
    }
    return meta;
  }

  async writeMetadata(meta: ProjectMetadata): Promise<void> {
    const cells: SheetCell[] = [
      { row: 1, col: 1, value: "key" },
      { row: 1, col: 2, value: "value" },
    ];

    let row = 2;
    for (const [key, val] of Object.entries(meta)) {
      if (key === "dependencies") continue;
      if (val === undefined) continue;
      cells.push({ row, col: 1, value: key });
      cells.push({ row, col: 2, value: String(val) });
      row++;
    }

    for (const [name, version] of Object.entries(meta.dependencies)) {
      cells.push({ row, col: 1, value: `dep:${name}` });
      cells.push({ row, col: 2, value: version });
      row++;
    }

    await this.xlsx.writeHiddenSheet(MANIFEST_SHEET, cells);
  }

  // ─── Lockfile (hidden sheet) ────────────────────────────────────────

  async readLockfile(): Promise<Lockfile | null> {
    const cells = await this.xlsx.readHiddenSheet(LOCK_SHEET);
    if (cells.length === 0) return null;

    const lock: Lockfile = { packages: {} };
    // Headers in row 1: package, version, integrity, dependencies, functions
    const dataRows = new Map<number, Map<number, string>>();
    for (const cell of cells) {
      if (cell.row <= 1) continue;
      let rowMap = dataRows.get(cell.row);
      if (!rowMap) {
        rowMap = new Map();
        dataRows.set(cell.row, rowMap);
      }
      rowMap.set(cell.col, cell.value);
    }

    for (const rowMap of dataRows.values()) {
      const name = (rowMap.get(1) ?? "").trim();
      if (!name) continue;

      lock.packages[name] = {
        version: (rowMap.get(2) ?? "").trim(),
        resolved: undefined,
        integrity: (rowMap.get(3) ?? "").trim() || undefined,
        dependencies: splitComma(rowMap.get(4) ?? ""),
        functions: splitComma(rowMap.get(5) ?? ""),
      };
    }
    return lock;
  }

  async writeLockfile(lock: Lockfile): Promise<void> {
    const headers = ["package", "version", "integrity", "dependencies", "functions"];
    const cells: SheetCell[] = headers.map((h, i) => ({
      row: 1,
      col: i + 1,
      value: h,
    }));

    let row = 2;
    for (const name of Object.keys(lock.packages).sort()) {
      const entry = lock.packages[name];
      cells.push({ row, col: 1, value: name });
      cells.push({ row, col: 2, value: entry.version });
      cells.push({ row, col: 3, value: entry.integrity ?? "" });
      cells.push({ row, col: 4, value: (entry.dependencies ?? []).join(", ") });
      cells.push({ row, col: 5, value: (entry.functions ?? []).join(", ") });
      row++;
    }

    await this.xlsx.writeHiddenSheet(LOCK_SHEET, cells);
  }

  // ─── Network (deferred) ────────────────────────────────────────────

  async fetchJSON(_url: string): Promise<unknown> {
    throw new Error("Network operations not yet implemented");
  }

  async fetchBinary(_url: string): Promise<ArrayBuffer> {
    throw new Error("Network operations not yet implemented");
  }
}

function splitComma(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((x) => x.trim());
}
