/**
 * GitHub REST API client + device flow auth for the Excel add-in.
 *
 * Device flow lets us authenticate without a client secret (which can't
 * safely live in browser code) and without popups (which are unreliable
 * in Office Add-in webviews). User sees a code, opens GitHub in any
 * browser, enters the code; we poll for the token.
 *
 * Token storage: localStorage["formulary:github:token"]
 */

const TOKEN_KEY = "formulary:github:token";
const USER_KEY = "formulary:github:user";

/**
 * GitHub OAuth client ID for the Formulary OAuth app.
 *
 * Public identifier — safe to ship in browser code. The device flow
 * does not require a client secret. Registered at https://formulary.dev.
 */
const CLIENT_ID = "Ov23licPLQb7ZRU8RuOp";

const API_BASE = "https://api.github.com";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

// ─── Device flow ──────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AuthState {
  token: string;
  user: { login: string };
}

/**
 * Step 1 of device flow: request a code from GitHub.
 *
 * Returns the user_code to display, and the device_code used to poll.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "public_repo",
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Step 2 of device flow: poll until the user authorizes.
 *
 * Returns the access token. Throws if the user denies, the code expires,
 * or after `maxAttempts` polls.
 */
export async function pollForToken(
  device: DeviceCodeResponse,
  onTick?: (status: string) => void,
): Promise<string> {
  const interval = device.interval * 1000; // ms
  const expiresAt = Date.now() + device.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval));

    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) {
      throw new Error(`Token poll failed: ${res.status}`);
    }

    const data = (await res.json()) as
      | { access_token: string; token_type: string; scope: string }
      | { error: string };

    if ("access_token" in data) {
      return data.access_token;
    }

    // Standard pending/slow_down errors — keep polling
    if (data.error === "authorization_pending") {
      onTick?.("waiting for authorization...");
      continue;
    }
    if (data.error === "slow_down") {
      onTick?.("rate limited, slowing down...");
      await new Promise((r) => setTimeout(r, interval));
      continue;
    }

    throw new Error(`Auth failed: ${data.error}`);
  }

  throw new Error("Authorization timed out");
}

// ─── Office Dialog OAuth flow (preferred) ─────────────────────────

/**
 * URL of the auth-start page served from the same origin as the
 * taskpane. Office Add-in dialogs require the initial URL to be on
 * the same domain as the add-in itself; the start page then redirects
 * to the cross-origin OAuth worker.
 */
const AUTH_START_PATH = "/auth-start.html";

/**
 * Sign in via the Office dialog. Opens a top-level browser window
 * (not subject to the taskpane's CORS), navigates to the OAuth worker,
 * which redirects to GitHub for consent, then back to the worker which
 * exchanges the code and posts the token back via messageParent.
 *
 * Requires the auth worker to be deployed at AUTH_WORKER_BASE.
 */
export function signInWithDialog(): Promise<AuthState> {
  return new Promise((resolve, reject) => {
    if (typeof Office === "undefined" || !Office.context?.ui) {
      reject(new Error("Office dialog API not available"));
      return;
    }

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const dialogUrl = `${window.location.origin}${AUTH_START_PATH}`;
    console.log("[fm-auth] displayDialogAsync starting:", dialogUrl);

    Office.context.ui.displayDialogAsync(
      dialogUrl,
      { height: 60, width: 40, promptBeforeOpen: false },
      (result) => {
        console.log("[fm-auth] displayDialogAsync result:", result.status);

        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          console.error("[fm-auth] dialog open failed:", result.error);
          settle(() =>
            reject(new Error(result.error?.message ?? "failed to open dialog")),
          );
          return;
        }

        const dialog = result.value;
        console.log("[fm-auth] dialog opened, registering handlers");

        dialog.addEventHandler(
          Office.EventType.DialogMessageReceived,
          (arg) => {
            console.log("[fm-auth] DialogMessageReceived fired:", arg);
            try {
              const message = "message" in arg ? arg.message ?? "" : "";
              const data = JSON.parse(message);

              if (data.type === "auth-success" && data.token) {
                const token = data.token;
                settled = true;
                dialog.close();
                console.log("[fm-auth] got token, storing auth");
                storeAuth(token).then(resolve).catch(reject);
              } else if (data.type === "auth-error") {
                settle(() => reject(new Error(data.message ?? "auth failed")));
                dialog.close();
              } else {
                settle(() => reject(new Error("unexpected dialog message")));
                dialog.close();
              }
            } catch (err) {
              console.error("[fm-auth] message handler threw:", err);
              settle(() => reject(err as Error));
              try {
                dialog.close();
              } catch {
                // ignore
              }
            }
          },
        );

        dialog.addEventHandler(
          Office.EventType.DialogEventReceived,
          (arg) => {
            const evt = "error" in arg ? arg.error : 0;
            console.log("[fm-auth] DialogEventReceived:", evt);
            if (evt === 12006) {
              settle(() =>
                reject(new Error("sign-in cancelled (dialog closed)")),
              );
            } else if (evt) {
              settle(() => reject(new Error(`dialog event ${evt}`)));
            }
          },
        );

        console.log("[fm-auth] handlers registered, waiting for dialog");
      },
    );
  });
}

// ─── PAT (Personal Access Token) flow (fallback) ──────────────────

/**
 * Authenticate with a GitHub Personal Access Token.
 *
 * Fallback path when the OAuth worker isn't deployed or reachable.
 * User generates a fine-grained PAT and pastes it in.
 */
export async function signInWithPAT(token: string): Promise<AuthState> {
  return storeAuth(token);
}

/** URL the user should visit to generate a fine-grained PAT. */
export const PAT_GENERATION_URL =
  "https://github.com/settings/personal-access-tokens/new";

// ─── Token storage ────────────────────────────────────────────────

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): { login: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function storeAuth(token: string): Promise<AuthState> {
  localStorage.setItem(TOKEN_KEY, token);
  const client = new GitHubClient(token);
  const user = await client.getUser();
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { token, user };
}

/**
 * High-level: complete device flow and store credentials.
 * Calls `onCode` once the user code is available so the UI can display it.
 */
export async function signIn(
  onCode: (device: DeviceCodeResponse) => void,
  onTick?: (status: string) => void,
): Promise<AuthState> {
  const device = await requestDeviceCode();
  onCode(device);
  const token = await pollForToken(device, onTick);
  return storeAuth(token);
}

// ─── REST client ──────────────────────────────────────────────────

export interface GitHubUser {
  login: string;
}

export interface GitHubRef {
  ref: string;
  object: { sha: string; type: string };
}

export interface GitHubCommit {
  sha: string;
  tree: { sha: string };
}

export interface GitHubTree {
  sha: string;
}

export interface GitHubBlob {
  sha: string;
}

export interface GitHubPR {
  html_url: string;
  number: number;
}

export class GitHubClient {
  constructor(private token: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return res.json() as Promise<T>;
  }

  // ─── User / repo ────────────────────────────────────────────────

  async getUser(): Promise<GitHubUser> {
    return this.request("GET", "/user");
  }

  async getRepo(owner: string, repo: string): Promise<unknown> {
    return this.request("GET", `/repos/${owner}/${repo}`);
  }

  async hasRepo(owner: string, repo: string): Promise<boolean> {
    try {
      await this.getRepo(owner, repo);
      return true;
    } catch {
      return false;
    }
  }

  async createFork(owner: string, repo: string): Promise<unknown> {
    return this.request("POST", `/repos/${owner}/${repo}/forks`);
  }

  async syncFork(owner: string, repo: string, branch = "main"): Promise<void> {
    try {
      await this.request("POST", `/repos/${owner}/${repo}/merge-upstream`, {
        branch,
      });
    } catch {
      // ignore — fork may already be up to date
    }
  }

  // ─── Git data API ───────────────────────────────────────────────

  async getRef(owner: string, repo: string, ref: string): Promise<GitHubRef> {
    return this.request("GET", `/repos/${owner}/${repo}/git/ref/${ref}`);
  }

  async getCommit(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<GitHubCommit> {
    return this.request("GET", `/repos/${owner}/${repo}/git/commits/${sha}`);
  }

  /**
   * Create a blob from raw bytes (base64) or text (utf-8).
   */
  async createBlob(
    owner: string,
    repo: string,
    content: { kind: "text"; data: string } | { kind: "bytes"; data: Uint8Array },
  ): Promise<GitHubBlob> {
    const body =
      content.kind === "text"
        ? { content: content.data, encoding: "utf-8" }
        : { content: bytesToBase64(content.data), encoding: "base64" };
    return this.request("POST", `/repos/${owner}/${repo}/git/blobs`, body);
  }

  async createTree(
    owner: string,
    repo: string,
    baseTree: string,
    entries: Array<{ path: string; mode: string; type: "blob"; sha: string }>,
  ): Promise<GitHubTree> {
    return this.request("POST", `/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTree,
      tree: entries,
    });
  }

  async createCommit(
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parentSha: string,
  ): Promise<GitHubCommit> {
    return this.request("POST", `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: treeSha,
      parents: [parentSha],
    });
  }

  async createRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
  ): Promise<GitHubRef> {
    return this.request("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref,
      sha,
    });
  }

  /**
   * Force-update an existing ref to point at a new commit.
   * Used to recover from leftover branches in the fork.
   */
  async updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
  ): Promise<GitHubRef> {
    // ref here is "heads/branchname", not "refs/heads/branchname"
    const apiRef = ref.replace(/^refs\//, "");
    return this.request("PATCH", `/repos/${owner}/${repo}/git/refs/${apiRef}`, {
      sha,
      force: true,
    });
  }

  /** Create the ref, or force-update if it already exists. */
  async upsertRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
  ): Promise<GitHubRef> {
    try {
      return await this.createRef(owner, repo, ref, sha);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("422") && msg.includes("already exists")) {
        return this.updateRef(owner, repo, ref, sha);
      }
      throw err;
    }
  }

  /** Read file content from a repo (returns text). */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      const data = await this.request<{ content: string; encoding: string }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`,
      );
      if (data.encoding === "base64") {
        return atob(data.content.replace(/\n/g, ""));
      }
      return data.content;
    } catch {
      return null;
    }
  }

  // ─── Pull requests ──────────────────────────────────────────────

  async createPR(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base = "main",
  ): Promise<GitHubPR> {
    return this.request("POST", `/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      head,
      base,
    });
  }

  /** Look up an open PR by its head ref (e.g. "user:branch"). */
  async findPRByHead(
    owner: string,
    repo: string,
    head: string,
  ): Promise<GitHubPR | null> {
    const list = await this.request<GitHubPR[]>(
      "GET",
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(head)}`,
    );
    return list[0] ?? null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(bin);
}
