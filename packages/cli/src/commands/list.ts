import { readFile } from "node:fs/promises";
import type { PlatformAdapter } from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";

interface ListOptions {
  adapter?: PlatformAdapter;
}

export async function list(
  xlsxPath: string,
  options: ListOptions = {},
): Promise<void> {
  const adapter =
    options.adapter ??
    (await ExcelAdapter.open(new Uint8Array(await readFile(xlsxPath))));

  const lock = await adapter.readLockfile();
  if (!lock || Object.keys(lock.packages).length === 0) {
    console.log("No packages installed.");
    return;
  }

  const meta = await adapter.readMetadata();
  const directDeps = new Set(Object.keys(meta?.dependencies ?? {}));

  const names = Object.keys(lock.packages).sort();
  for (const name of names) {
    const entry = lock.packages[name];
    const direct = directDeps.has(name) ? "" : " (transitive)";
    const fnCount = entry.functions?.length ?? 0;
    console.log(`  ${name}@${entry.version}${direct} — ${fnCount} functions`);
  }
}
