/**
 * Helper to open a GSheets adapter for CLI commands.
 * Lazily imports Playwright to avoid loading it for Excel-only usage.
 */

import { getProfileDir } from "../auth.js";
import { GSheetsDriver } from "./gsheets-driver.js";
import { GSheetsAdapter } from "./gsheets-adapter.js";

export async function openGSheets(
  url: string,
  profileName: string,
  headed: boolean = false,
): Promise<{ adapter: GSheetsAdapter; cleanup: () => Promise<void> }> {
  const profileDir = getProfileDir(profileName);
  const driver = new GSheetsDriver(profileDir, !headed);

  await driver.start();

  const adapter = new GSheetsAdapter(driver, url, profileName);
  await adapter.connect();

  return {
    adapter,
    cleanup: () => driver.stop(),
  };
}
