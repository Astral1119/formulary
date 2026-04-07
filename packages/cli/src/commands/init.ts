import { access, writeFile } from "node:fs/promises";
import { ExcelAdapter } from "../adapter/excel-adapter.js";

export async function init(xlsxPath: string): Promise<void> {
  // Don't overwrite existing files
  try {
    await access(xlsxPath);
    throw new Error(`File already exists: ${xlsxPath}`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }

  const adapter = await ExcelAdapter.create();

  // Write empty metadata and lockfile to initialize hidden sheets
  await adapter.writeMetadata({ dependencies: {} });
  await adapter.writeLockfile({ packages: {} });

  await writeFile(xlsxPath, await adapter.save());
  console.log(`✓ Created ${xlsxPath}`);
}
