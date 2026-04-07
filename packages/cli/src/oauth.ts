/**
 * OAuth 2.0 for Google Sheets API with named profile support.
 *
 * Profiles are stored at ~/.formulary/profiles/<name>/token.json.
 *
 * Requires a credentials.json (Google Cloud OAuth client).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const FORMULARY_DIR = join(homedir(), ".formulary");
const PROFILES_DIR = join(FORMULARY_DIR, "profiles");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const REDIRECT_PORT = 8090;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email?: string;
}

// ─── Credentials ──────────────────────────────────────────────────

function loadCredentials(): ClientCredentials {
  const candidates = [
    join(FORMULARY_DIR, "credentials.json"),
    join(process.cwd(), "credentials.json"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const creds = raw.installed || raw.web;
      if (!creds) continue;
      return {
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
      };
    }
  }

  throw new Error(
    "credentials.json not found.\n" +
      "Download OAuth client credentials from Google Cloud Console\n" +
      "and place at ~/.formulary/credentials.json",
  );
}

// ─── Profile management ───────────────────────────────────────────

function profileTokenPath(name: string): string {
  return join(PROFILES_DIR, name, "token.json");
}

function readToken(profileName: string): TokenData | null {
  const path = profileTokenPath(profileName);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8"));
  }
  return null;
}

function writeToken(profileName: string, data: TokenData): void {
  const dir = join(PROFILES_DIR, profileName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(profileTokenPath(profileName), JSON.stringify(data, null, 2));
}

export function listProfiles(): Array<{ name: string; email?: string }> {
  const profiles: Array<{ name: string; email?: string }> = [];

  if (existsSync(PROFILES_DIR)) {
    for (const name of readdirSync(PROFILES_DIR)) {
      const token = readToken(name);
      profiles.push({ name, email: token?.email });
    }
  }

  return profiles;
}

export function removeProfile(name: string): boolean {
  const dir = join(PROFILES_DIR, name);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
    return true;
  }
  return false;
}

// ─── Token access ─────────────────────────────────────────────────

export async function getAccessToken(profileName: string = "default"): Promise<string> {
  const data = readToken(profileName);
  if (!data) {
    throw new Error(
      `Profile "${profileName}" not found. Run \`formulary auth ${profileName}\` first.`,
    );
  }

  // Refresh if expired (with 60s buffer)
  if (Date.now() > data.expiry_date - 60_000) {
    const refreshed = await refreshToken(profileName, data.refresh_token);
    if (!refreshed) {
      throw new Error(
        `Token refresh failed for profile "${profileName}". Run \`formulary auth ${profileName}\` again.`,
      );
    }
    return refreshed.access_token;
  }

  return data.access_token;
}

// ─── Login flow ───────────────────────────────────────────────────

export async function oauthLogin(profileName: string = "default"): Promise<void> {
  const creds = loadCredentials();

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${creds.clientId}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES.join(" "))}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log("Opening browser for Google authentication...");
  console.log(`Profile: ${profileName}\n`);

  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${authUrl}"`);

  const code = await waitForAuthCode();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Fetch email for profile display
  let email: string | undefined;
  try {
    const userRes = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (userRes.ok) {
      const user = (await userRes.json()) as { email: string };
      email = user.email;
    }
  } catch {
    // best effort
  }

  const tokenData: TokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    email,
  };

  writeToken(profileName, tokenData);
  console.log(`✓ Authenticated as ${email ?? "unknown"}`);
  console.log(`  Profile "${profileName}" saved.`);
}

// ─── Internals ────────────────────────────────────────────────────

async function refreshToken(
  profileName: string,
  refreshTokenStr: string,
): Promise<TokenData | null> {
  const creds = loadCredentials();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshTokenStr,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;

  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Preserve existing email and refresh token
  const existing = readToken(profileName);

  const tokenData: TokenData = {
    access_token: tokens.access_token,
    refresh_token: refreshTokenStr,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    email: existing?.email,
  };

  writeToken(profileName, tokenData);
  return tokenData;
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h2>Authentication failed: ${error}</h2><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`Auth failed: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h2>Authenticated!</h2><p>You can close this tab and return to the terminal.</p>`);
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(400);
      res.end("Missing code parameter");
    });

    server.listen(REDIRECT_PORT, () => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Authentication timed out"));
      }, 120_000);
      timeout.unref();
    });
  });
}
