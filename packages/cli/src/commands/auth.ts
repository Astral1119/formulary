import { oauthLogin, listProfiles, removeProfile } from "../oauth.js";
import { authenticate } from "../auth.js";

export async function auth(profileName: string = "default"): Promise<void> {
  // Step 1: Playwright browser login (for GSheets UI automation)
  console.log("Step 1: Browser authentication (for named function management)");
  await authenticate(profileName);

  // Step 2: OAuth token (for Sheets API — metadata/lockfile)
  console.log("\nStep 2: OAuth authentication (for Sheets API)");
  await oauthLogin(profileName);
}

export function authRemove(profileName: string): void {
  if (removeProfile(profileName)) {
    console.log(`✓ Removed profile "${profileName}"`);
  } else {
    console.error(`Profile "${profileName}" not found`);
    process.exit(1);
  }
}

export async function authList(): Promise<void> {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log("No profiles. Run `formulary auth` to authenticate.");
    return;
  }

  console.log("Profiles:");
  for (const p of profiles) {
    const email = p.email ? ` — ${p.email}` : "";
    console.log(`  ${p.name}${email}`);
  }
}
