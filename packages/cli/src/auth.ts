/**
 * Google authentication via persistent Chromium profile.
 *
 * First run: opens a headed browser for the user to sign in.
 * Subsequent runs: reuses the session from the persistent profile.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { GSheetsDriver } from "./adapter/gsheets-driver.js";

const PROFILES_DIR = join(homedir(), ".formulary", "profiles");

export function getProfileDir(name: string = "default"): string {
  return join(PROFILES_DIR, name);
}

/**
 * Interactive auth: opens a headed browser for the user to sign in to Google.
 * The session persists in the profile directory for future headless use.
 */
export async function authenticate(
  profileName: string = "default",
): Promise<string> {
  const profileDir = getProfileDir(profileName);
  const driver = new GSheetsDriver(profileDir, false); // headed

  try {
    await driver.start();

    console.log("Opening browser for Google authentication...");
    console.log("Please sign in with your Google account.");

    await driver.page.goto("https://docs.google.com/spreadsheets/", {
      waitUntil: "networkidle",
    });

    // Dismiss "Got it" banner if present
    try {
      const gotIt = driver.page.getByRole("button", { name: "Got it" });
      if ((await gotIt.count()) > 0) await gotIt.first().click();
    } catch {
      // ignore
    }

    // Wait for signed-in state (profile icon)
    console.log("Waiting for authentication (up to 5 minutes for MFA)...");
    await driver.page.waitForSelector(
      'a[aria-label*="Google Account"], [data-ogpc="gb-google-account"]',
      { timeout: 300_000 },
    );

    // Extract email
    let email = "unknown";
    try {
      const accountLink = driver.page.locator(
        'a[aria-label*="Google Account"]',
      );
      if ((await accountLink.count()) > 0) {
        const label = await accountLink.first().getAttribute("aria-label");
        const match = label?.match(/([^\s(]+@[^\s)]+)/);
        if (match) email = match[1];
      }
    } catch {
      // best effort
    }

    console.log(`✓ Authenticated as ${email}`);
    console.log(`  Profile saved to ${profileDir}`);

    return email;
  } finally {
    await driver.stop();
  }
}
