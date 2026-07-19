/**
 * Formulary OAuth proxy worker.
 *
 * Two routes:
 *   GET /auth/github/start    — kick off the OAuth flow
 *   GET /auth/github/callback — exchange the code, return HTML that posts
 *                                the token back to the parent Office dialog
 *
 * The worker holds the GITHUB_CLIENT_SECRET so it never touches the
 * browser. State is bound to the user's session via an HMAC-signed
 * cookie that the start endpoint sets and the callback verifies.
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  ALLOWED_RETURN_ORIGIN: string;
}

const STATE_COOKIE = "formulary_oauth_state";
const RETURN_COOKIE = "formulary_oauth_return";
const STATE_TTL_SECONDS = 600; // 10 minutes

// Origins allowed to receive the token via messageParent.
// Add taskpane origins here. Localhost is allowed for dev.
const ALLOWED_RETURN_ORIGINS = new Set([
  "https://formulary.dev",
  "https://localhost:3000",
  "http://localhost:3000",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/auth/github/start") {
      return handleStart(env, url);
    }
    if (url.pathname === "/auth/github/callback") {
      return handleCallback(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

// ─── Start ────────────────────────────────────────────────────────

async function handleStart(env: Env, url: URL): Promise<Response> {
  const state = randomString(32);
  const signedState = await signState(state, env.COOKIE_SECRET);

  // Capture the parent origin so the callback page can pass it as
  // targetOrigin when calling messageParent. Default to the configured
  // production origin.
  const requestedReturn = url.searchParams.get("return_origin") ?? "";
  const returnOrigin = ALLOWED_RETURN_ORIGINS.has(requestedReturn)
    ? requestedReturn
    : env.ALLOWED_RETURN_ORIGIN;

  const redirectUri = `${url.origin}/auth/github/callback`;

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "public_repo");
  authUrl.searchParams.set("state", state);

  // Two cookies: state (signed, for CSRF) and return origin
  const headers = new Headers({ Location: authUrl.toString() });
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=${signedState}; Max-Age=${STATE_TTL_SECONDS}; Path=/auth/github; Secure; HttpOnly; SameSite=Lax`,
  );
  headers.append(
    "Set-Cookie",
    `${RETURN_COOKIE}=${encodeURIComponent(returnOrigin)}; Max-Age=${STATE_TTL_SECONDS}; Path=/auth/github; Secure; HttpOnly; SameSite=Lax`,
  );

  return new Response(null, { status: 302, headers });
}

// ─── Callback ─────────────────────────────────────────────────────

async function handleCallback(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return errorPage(`GitHub returned: ${errorParam}`, env.ALLOWED_RETURN_ORIGIN);
  }
  if (!code || !stateParam) {
    return errorPage("missing code or state", env.ALLOWED_RETURN_ORIGIN);
  }

  // Verify state matches the signed cookie
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookieState = parseCookie(cookieHeader, STATE_COOKIE);
  if (!cookieState) {
    return errorPage("missing state cookie (start the flow again)", env.ALLOWED_RETURN_ORIGIN);
  }
  const valid = await verifyState(stateParam, cookieState, env.COOKIE_SECRET);
  if (!valid) {
    return errorPage("state mismatch (possible CSRF)", env.ALLOWED_RETURN_ORIGIN);
  }

  // Determine the targetOrigin for messageParent
  const returnFromCookie = parseCookie(cookieHeader, RETURN_COOKIE) ?? "";
  const targetOrigin = ALLOWED_RETURN_ORIGINS.has(returnFromCookie)
    ? returnFromCookie
    : env.ALLOWED_RETURN_ORIGIN;

  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "formulary-auth-worker",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/github/callback`,
    }),
  });

  if (!tokenRes.ok) {
    return errorPage(`token exchange failed: ${tokenRes.status}`, targetOrigin);
  }

  const tokenData = (await tokenRes.json()) as
    | { access_token: string; token_type: string; scope: string }
    | { error: string; error_description?: string };

  if ("error" in tokenData) {
    return errorPage(
      `${tokenData.error}: ${tokenData.error_description ?? ""}`,
      targetOrigin,
    );
  }

  return successPage(tokenData.access_token, targetOrigin);
}

// ─── HTML responses ───────────────────────────────────────────────

function successPage(token: string, targetOrigin: string): Response {
  // The Office dialog hosts office.js and uses messageParent() to send
  // the token back to the parent taskpane. The parent then closes the
  // dialog.
  //
  // Status updates go to BOTH document.title (always reflected in the
  // dialog window's title bar) and the in-page #status div, so we can
  // diagnose failures even if the DOM is partially broken.
  const tokenJson = JSON.stringify(token);
  const targetOriginJson = JSON.stringify(targetOrigin);
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>fm: starting</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #f6f8fa;
        color: #1a1d21;
      }
      .card {
        background: #fff;
        padding: 32px 40px;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        text-align: center;
      }
      .check { font-size: 32px; color: #0f7b6c; }
      h1 { font-size: 18px; margin: 8px 0 4px; }
      p { color: #5c6370; font-size: 14px; margin: 0; }
      #status { font-family: ui-monospace, monospace; font-size: 11px;
                color: #8b919a; margin-top: 16px; max-width: 320px;
                word-break: break-word; }
    </style>
    <script>
      // Run as early as possible. Track progress via document.title in
      // case DOM access or office.js init fails.
      window.__FM_TOKEN = ${tokenJson};
      window.__FM_TARGET_ORIGIN = ${targetOriginJson};
      document.title = "fm: head-script-ran";
    </script>
    <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
            onload="document.title='fm: office-loaded'"
            onerror="document.title='fm: office-load-error'"></script>
  </head>
  <body>
    <div class="card">
      <div class="check">✓</div>
      <h1>Signed in</h1>
      <p>You can close this window.</p>
      <div id="status">script not run</div>
    </div>
    <script>
      (function () {
        document.title = "fm: body-script-running";
        var statusEl = document.getElementById("status");
        function setStatus(msg) {
          document.title = "fm: " + msg;
          if (statusEl) statusEl.textContent = msg;
        }

        try {
          setStatus("body-script-ok");
        } catch (e) {
          document.title = "fm: setStatus-threw";
          return;
        }

        function sendToParent() {
          try {
            if (typeof Office === "undefined") {
              setStatus("office-undefined");
              return;
            }
            if (!Office.context || !Office.context.ui || !Office.context.ui.messageParent) {
              setStatus("messageParent-missing");
              return;
            }
            Office.context.ui.messageParent(
              JSON.stringify({
                type: "auth-success",
                token: window.__FM_TOKEN
              }),
              { targetOrigin: window.__FM_TARGET_ORIGIN }
            );
            setStatus("sent to " + window.__FM_TARGET_ORIGIN);
          } catch (e) {
            setStatus("send-failed: " + (e && e.message ? e.message : String(e)));
          }
        }

        if (typeof Office !== "undefined" && Office.onReady) {
          setStatus("awaiting-onReady");
          Office.onReady(function (info) {
            setStatus("ready-" + (info && info.host));
            sendToParent();
          });
        } else if (typeof Office !== "undefined") {
          setStatus("office-no-onReady");
          // Try direct send anyway
          sendToParent();
        } else {
          setStatus("no-office-yet");
          // Maybe office.js is still loading. Retry on window load.
          window.addEventListener("load", function () {
            setStatus("window-loaded");
            if (typeof Office !== "undefined" && Office.onReady) {
              Office.onReady(function () {
                setStatus("ready-after-load");
                sendToParent();
              });
            } else {
              setStatus("still-no-office-after-load");
            }
          });
        }
      })();
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Clear the state cookie so it can't be replayed
      "Set-Cookie": `${STATE_COOKIE}=; Max-Age=0; Path=/auth/github; Secure; HttpOnly; SameSite=Lax`,
    },
  });
}

function errorPage(message: string, targetOrigin: string): Response {
  const targetOriginJson = JSON.stringify(targetOrigin);
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Formulary — Sign-in failed</title>
    <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #f6f8fa;
        color: #1a1d21;
      }
      .card {
        background: #fff;
        padding: 32px 40px;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        text-align: center;
        max-width: 320px;
      }
      .x { font-size: 32px; color: #c4392d; }
      h1 { font-size: 18px; margin: 8px 0 4px; }
      p { color: #5c6370; font-size: 13px; margin: 0; word-wrap: break-word; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="x">!</div>
      <h1>Sign-in failed</h1>
      <p>${escapeHtml(message)}</p>
    </div>
    <script>
      Office.onReady(function () {
        Office.context.ui.messageParent(
          JSON.stringify({
            type: "auth-error",
            message: ${JSON.stringify(message)}
          }),
          { targetOrigin: ${targetOriginJson} }
        );
      });
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// ─── State signing ────────────────────────────────────────────────

async function signState(state: string, secret: string): Promise<string> {
  const sig = await hmacSha256(state, secret);
  return `${state}.${sig}`;
}

async function verifyState(
  state: string,
  signed: string,
  secret: string,
): Promise<boolean> {
  const dot = signed.indexOf(".");
  if (dot < 0) return false;
  const cookieState = signed.slice(0, dot);
  const cookieSig = signed.slice(dot + 1);
  if (cookieState !== state) return false;
  const expected = await hmacSha256(state, secret);
  // Constant-time-ish compare
  return timingSafeEqual(cookieSig, expected);
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Helpers ──────────────────────────────────────────────────────

function randomString(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(header: string, name: string): string | null {
  const parts = header.split(";");
  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
