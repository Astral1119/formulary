import { readFile, writeFile } from "node:fs/promises";
import type { PlatformAdapter } from "@formulary/core";
import { ExcelAdapter } from "../adapter/excel-adapter.js";

interface RemoveOptions {
  adapter?: PlatformAdapter;
}

export async function remove(
  packageName: string,
  xlsxPath: string,
  options: RemoveOptions = {},
): Promise<void> {
  let adapter: PlatformAdapter;
  let isExcel = false;

  if (options.adapter) {
    adapter = options.adapter;
  } else {
    const data = await readFile(xlsxPath);
    adapter = await ExcelAdapter.open(new Uint8Array(data));
    isExcel = true;
  }

  const lock = await adapter.readLockfile();
  if (!lock?.packages[packageName]) {
    throw new Error(`Package "${packageName}" is not installed`);
  }

  const meta = (await adapter.readMetadata()) ?? {
    dependencies: {} as Record<string, string>,
  };

  // Delete functions belonging to this package
  const removedFunctions = lock.packages[packageName].functions ?? [];
  delete lock.packages[packageName];

  // Find orphaned transitive deps: walk from remaining direct deps
  const directDeps = new Set(
    Object.keys(meta.dependencies).filter((d) => d !== packageName),
  );

  const needed = new Set<string>(directDeps);
  const queue = [...needed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entry = lock.packages[current];
    if (!entry) continue;
    for (const dep of entry.dependencies) {
      if (!needed.has(dep)) {
        needed.add(dep);
        queue.push(dep);
      }
    }
  }

  // Remove orphaned packages
  const orphaned: string[] = [];
  for (const name of Object.keys(lock.packages)) {
    if (!needed.has(name)) {
      orphaned.push(name);
      removedFunctions.push(...(lock.packages[name].functions ?? []));
      delete lock.packages[name];
    }
  }

  // Delete named functions
  for (const fn of removedFunctions) {
    await adapter.deleteFunction(fn);
  }

  // Update metadata
  delete meta.dependencies[packageName];
  await adapter.writeMetadata(meta);
  await adapter.writeLockfile(lock);

  // Save xlsx if applicable
  if (isExcel) {
    await writeFile(xlsxPath, await (adapter as ExcelAdapter).save());
  }

  let msg = `✓ Removed ${packageName}`;
  if (orphaned.length > 0) {
    msg += ` (and orphaned: ${orphaned.join(", ")})`;
  }
  msg += ` — ${removedFunctions.length} functions deleted`;
  console.log(msg);
}
