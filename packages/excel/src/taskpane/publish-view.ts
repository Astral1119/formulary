/**
 * Publish modal view — orchestrates the publish UI state machine.
 *
 * States: preview → (auth?) → progress → (success | error)
 *
 * The view reads the current workbook via the OfficeJSAdapter, runs the
 * extract logic and preflight checks, and on confirm hands off to the
 * GitHubApiBackend through the publish-flow module.
 */

import type { Manifest, FunctionDef, NamedFunction } from "@formulary/core";
import type { OfficeJSAdapter } from "../adapter/officejs-adapter.js";
import {
  extractForPublish,
  buildFunctionsJson,
  runPreflightChecks,
  runPublish,
  type PreflightCheck,
  type ExtractResult,
} from "../publish/publish-flow.js";
import {
  signInWithDialog,
  signInWithPAT,
  getStoredToken,
  getStoredUser,
  GitHubClient,
  PAT_GENERATION_URL,
} from "../publish/github.js";
import { GitHubApiBackend } from "../publish/backend.js";

type State = "preview" | "auth" | "progress" | "success" | "error";

interface PublishContext {
  manifest: Manifest;
  functions: Record<string, FunctionDef>;
  excluded: ExtractResult["excludedFunctions"];
  checks: PreflightCheck[];
}

let currentContext: PublishContext | null = null;
let currentAdapter: OfficeJSAdapter | null = null;

// ─── Public API ───────────────────────────────────────────────────

export async function openPublishModal(
  adapter: OfficeJSAdapter,
  manifest: Manifest,
): Promise<void> {
  currentAdapter = adapter;

  showModal();
  setState("preview");

  // Load preview content
  const extracted = await extractForPublish(adapter);
  const functions = buildFunctionsJson(extracted.authorFunctions);
  const checks = runPreflightChecks(manifest, functions);

  currentContext = {
    manifest,
    functions,
    excluded: extracted.excludedFunctions,
    checks,
  };

  renderPreview(currentContext);
}

export function bindPublishModal(): void {
  document
    .getElementById("btn-publish-back")!
    .addEventListener("click", closeModal);
  document
    .getElementById("btn-publish-confirm")!
    .addEventListener("click", onConfirm);
  document
    .getElementById("btn-publish-done")!
    .addEventListener("click", closeModal);
  document
    .getElementById("btn-publish-retry")!
    .addEventListener("click", onConfirm);
  document
    .getElementById("btn-publish-pat-save")!
    .addEventListener("click", onPATSave);

  // Set the PAT generation link once
  const link = document.getElementById("publish-pat-link") as HTMLAnchorElement;
  link.href = PAT_GENERATION_URL;
}

// ─── Modal show/hide ──────────────────────────────────────────────

function showModal(): void {
  document.getElementById("publish-modal")!.hidden = false;
}

function closeModal(): void {
  document.getElementById("publish-modal")!.hidden = true;
  setState("preview");
}

function setState(state: State): void {
  for (const s of ["preview", "auth", "progress", "success", "error"] as const) {
    const el = document.getElementById(`publish-state-${s}`)!;
    el.hidden = s !== state;
  }
}

// ─── Preview state ────────────────────────────────────────────────

function renderPreview(ctx: PublishContext): void {
  document.getElementById("publish-title")!.textContent =
    `Publish ${ctx.manifest.name}@${ctx.manifest.version}`;

  // Functions list
  const fnList = document.getElementById("publish-functions")!;
  const fnNames = Object.keys(ctx.functions);
  fnList.innerHTML = fnNames.length
    ? fnNames.map((n) => `<li class="func-item">${esc(n)}</li>`).join("")
    : `<li class="func-item" style="color:var(--fg-faint)">none</li>`;

  // Excluded
  const excludedLabel = document.getElementById("publish-excluded-label")!;
  const excluded = document.getElementById("publish-excluded")!;
  if (ctx.excluded.length > 0) {
    excludedLabel.hidden = false;
    excluded.innerHTML = ctx.excluded
      .map(
        (e) =>
          `<li class="func-item"><span>${esc(e.name)}</span> <span style="color:var(--fg-faint);font-size:11px">${esc(e.package)}</span></li>`,
      )
      .join("");
  } else {
    excludedLabel.hidden = true;
    excluded.innerHTML = "";
  }

  // Checks
  const checks = document.getElementById("publish-checks")!;
  checks.innerHTML = ctx.checks
    .map(
      (c) => `
    <li>
      <span class="check-icon ${c.ok ? "ok" : "fail"}">${c.ok ? "✓" : "✕"}</span>
      <div>
        <div>${esc(c.label)}</div>
        ${c.detail ? `<span class="check-detail">${esc(c.detail)}</span>` : ""}
      </div>
    </li>`,
    )
    .join("");

  // Auth status
  const auth = document.getElementById("publish-auth-status")!;
  const user = getStoredUser();
  if (user) {
    auth.textContent = `GitHub: @${user.login}`;
    auth.classList.add("signed-in");
  } else {
    auth.textContent = "Not signed in to GitHub (you'll be prompted)";
    auth.classList.remove("signed-in");
  }

  // Confirm button enabled only if all checks pass
  const allOk = ctx.checks.every((c) => c.ok);
  const confirm = document.getElementById(
    "btn-publish-confirm",
  ) as HTMLButtonElement;
  confirm.disabled = !allOk;
  confirm.textContent = allOk
    ? user
      ? "Publish"
      : "Sign in & Publish"
    : "Fix issues to continue";
}

// ─── Confirm handler ──────────────────────────────────────────────

async function onConfirm(): Promise<void> {
  if (!currentContext || !currentAdapter) return;

  let token = getStoredToken();
  if (!token) {
    // Try the dialog flow first (preferred). Falls back to PAT panel
    // if the worker isn't reachable or the dialog fails.
    try {
      const auth = await signInWithDialog();
      token = auth.token;
    } catch (err) {
      console.warn("dialog auth failed, showing PAT fallback", err);
      setState("auth");
      const tick = document.getElementById("publish-auth-tick")!;
      tick.textContent = `dialog sign-in failed: ${(err as Error).message}`;
      return;
    }
  }

  await runPublishStep(token);
}

async function onPATSave(): Promise<void> {
  const input = document.getElementById("publish-pat-input") as HTMLInputElement;
  const token = input.value.trim();
  if (!token) return;

  const tick = document.getElementById("publish-auth-tick")!;
  tick.textContent = "verifying token...";

  try {
    const auth = await signInWithPAT(token);
    tick.textContent = `signed in as @${auth.user.login}`;
    input.value = "";
    await runPublishStep(token);
  } catch (err) {
    tick.textContent = `failed: ${(err as Error).message}`;
  }
}

async function runPublishStep(token: string): Promise<void> {
  if (!currentContext) return;
  const ctx = currentContext;

  try {
    setState("progress");
    setProgress("connecting to GitHub...");

    const client = new GitHubClient(token);
    const backend = new GitHubApiBackend(client);

    setProgress("creating bundle...");
    const user = getStoredUser();
    const prUrl = await runPublish(ctx.manifest, ctx.functions, backend, {
      publisherUsername: user?.login,
    });

    setState("success");
    const link = document.getElementById("publish-pr-link") as HTMLAnchorElement;
    link.href = prUrl;
  } catch (err) {
    console.error("publish failed", err);
    setState("error");
    document.getElementById("publish-error-msg")!.textContent =
      (err as Error).message;
  }
}

function setProgress(msg: string): void {
  document.getElementById("publish-progress-msg")!.textContent = msg;
}

// ─── Util ─────────────────────────────────────────────────────────

function esc(s: string): string {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
