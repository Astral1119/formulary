/**
 * Google Sheets adapter using Playwright for named functions
 * and Sheets API v4 for metadata/lockfile (hidden sheets).
 *
 * Ported from the Python formulary (git ref b134bb0).
 */

import type {
  PlatformAdapter,
  NamedFunction,
  ProjectMetadata,
  Lockfile,
  LockEntry,
} from "@formulary/core";
import type { Page } from "playwright";
import { GSheetsDriver } from "./gsheets-driver.js";
import { getAccessToken } from "../oauth.js";
import { unwrapLambda, wrapLambda } from "./lambda.js";

const MANIFEST_SHEET = "__manifest__";
const LOCK_SHEET = "__lock__";

export class GSheetsAdapter implements PlatformAdapter {
  readonly platform = "gsheets" as const;
  private sidebarOpened = false;

  constructor(
    private driver: GSheetsDriver,
    private spreadsheetUrl: string,
    private profileName: string = "default",
  ) {}

  private get page(): Page {
    return this.driver.page;
  }

  /** Extract spreadsheet ID from URL. */
  private get spreadsheetId(): string {
    const match = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(
      this.spreadsheetUrl,
    );
    if (!match) throw new Error(`Invalid spreadsheet URL: ${this.spreadsheetUrl}`);
    return match[1];
  }

  private log(msg: string): void {
    this.driver.log(msg);
  }

  /** Navigate to the spreadsheet and dismiss popups. */
  async connect(): Promise<void> {
    this.log(`navigating to spreadsheet...`);
    await this.page.goto(this.spreadsheetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // Wait for the sheet to actually load (toolbar appears)
    this.log("waiting for sheet to load...");
    await this.page.waitForSelector('#docs-editor', { timeout: 30_000 }).catch(() => {
      // try alternate selector
      return this.page.waitForSelector('.waffle-spreadsheet-container', { timeout: 15_000 });
    });
    this.log("sheet loaded");
    // Dismiss "Got it" if present
    try {
      const gotIt = this.page.getByRole("button", { name: "Got it" });
      if ((await gotIt.count()) > 0) await gotIt.first().click();
    } catch {
      // ignore
    }
  }

  // ─── Named Functions (Playwright UI) ─────────────────────────────

  private async openSidebar(): Promise<void> {
    const dataMenu = this.page.getByRole("menuitem", { name: "Data" }).first();
    await dataMenu.click();
    await this.page.keyboard.press("k"); // shortcut for named functions

    if (!this.sidebarOpened) {
      // Check for empty state quickly
      try {
        await this.page.waitForSelector(
          ".waffle-named-formulas-sidebar-list-view-zero-state-promo-wrapper",
          { timeout: 200 },
        );
        this.sidebarOpened = true;
        return;
      } catch {
        // not empty
      }
    }

    // Wait for list or footer
    try {
      await this.page.waitForSelector(
        ".waffle-named-formulas-sidebar-list-view-card",
        { timeout: 2000 },
      );
    } catch {
      try {
        await this.page.waitForSelector(
          ".waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button",
          { timeout: 1000 },
        );
      } catch {
        // best effort
      }
    }
    this.sidebarOpened = true;
  }

  async listFunctions(): Promise<NamedFunction[]> {
    await this.openSidebar();

    // Check empty state
    const empty = await this.page.$(
      ".waffle-named-formulas-sidebar-list-view-zero-state-promo-wrapper",
    );
    if (empty && (await empty.isVisible())) return [];

    const rows = await this.page.$$(
      ".waffle-named-formulas-sidebar-list-view-card",
    );

    // Collect names first
    const names: string[] = [];
    for (const row of rows) {
      const nameEl = await row.$(
        ".waffle-named-formulas-sidebar-list-view-card-function-signature",
      );
      if (nameEl) {
        const text = await nameEl.innerText();
        names.push(text.split("(")[0].trim());
      }
    }

    // Get details for each
    const functions: NamedFunction[] = [];
    for (const name of names) {
      const fn = await this.getFunctionDetails(name);
      if (fn) functions.push(fn);
    }
    return functions;
  }

  private async getFunctionDetails(
    name: string,
  ): Promise<NamedFunction | null> {
    const rows = await this.page.$$(
      ".waffle-named-formulas-sidebar-list-view-card",
    );

    let targetRow = null;
    let argNames: string[] = [];
    for (const row of rows) {
      const nameEl = await row.$(
        ".waffle-named-formulas-sidebar-list-view-card-function-signature",
      );
      if (nameEl) {
        const text = await nameEl.innerText();
        const funcName = text.split("(")[0].trim();
        if (funcName === name) {
          targetRow = row;
          // Parse args from signature: "HELLO(name)" → ["name"]
          const sigMatch = /\(([^)]*)\)/.exec(text);
          if (sigMatch && sigMatch[1].trim()) {
            argNames = sigMatch[1].split(",").map((a) => a.trim());
          }
          break;
        }
      }
    }
    if (!targetRow) return null;

    // Click the menu icon → Edit
    const docsIcon = await targetRow.$(".docs-icon");
    if (docsIcon) await docsIcon.click();

    await this.page.waitForSelector(
      ".waffle-named-formulas-sidebar-list-view-card-action-menu-item",
    );
    await this.page
      .locator(
        ".waffle-named-formulas-sidebar-list-view-card-action-menu-item-action-name",
      )
      .filter({ hasText: "Edit" })
      .click();

    // Wait for edit form
    await this.page
      .locator("div[aria-label='Enter formula description']")
      .filter({ visible: true })
      .first()
      .waitFor({ state: "visible", timeout: 2000 });

    // Extract description + body
    const descInput = this.page
      .locator("div[aria-label='Enter formula description']")
      .filter({ visible: true });
    const description =
      (await descInput.count()) > 0 ? await descInput.innerText() : "";

    const defInput = this.page
      .locator("div[aria-label='= Write formula here']")
      .filter({ visible: true });
    const body =
      (await defInput.count()) > 0 ? await defInput.innerText() : "";

    // Cancel to go back
    await this.page.getByRole("button", { name: "Cancel" }).click();
    try {
      await this.page.waitForSelector(
        ".waffle-named-formulas-sidebar-list-view-card",
        { timeout: 2000 },
      );
    } catch {
      // best effort
    }

    // Re-wrap as LAMBDA for consistent storage format
    const definition = wrapLambda(argNames, body);
    return { name, definition, description };
  }

  async createFunction(fn: NamedFunction): Promise<void> {
    await this.openSidebar();
    const { args, body } = unwrapLambda(fn.definition);
    this.log(`creating ${fn.name}(${args.join(", ")})`);

    // Click Add
    const addBtn = await this.page.waitForSelector(
      ".waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button",
    );
    await addBtn.press("Enter");

    // Fill name
    const nameInput = await this.page.waitForSelector(
      ".waffle-named-formulas-sidebar-create-step-a-function-name-field-input",
    );
    await nameInput.fill(fn.name);
    await this.page.waitForTimeout(100);

    // Fill description
    const descInputs = await this.page.$$(
      "div[aria-label='Enter formula description']",
    );
    for (const inp of descInputs) {
      if (await inp.isVisible()) {
        await inp.fill(fn.description ?? "");
        break;
      }
    }

    // Add arguments
    for (const arg of args) {
      const argInput = await this.page.$(
        "input.waffle-named-formulas-sidebar-create-step-a-new-argument-name-field-input",
      );
      if (argInput) {
        await argInput.fill(arg);
        await argInput.press("Enter");
        await this.page.waitForTimeout(100);
      }
    }

    // Fill definition (body only, without LAMBDA wrapper)
    const defInputs = await this.page.$$(
      "div[aria-label='= Write formula here']",
    );
    for (const inp of defInputs) {
      if (await inp.isVisible()) {
        try {
          await inp.fill(body);
        } catch {
          await inp.evaluate(
            (el: HTMLElement, val: string) => (el.innerText = val),
            body,
          );
        }
        await this.page.waitForTimeout(200);
        break;
      }
    }

    // Click Next
    const nextBtn = await this.page.$(
      ".waffle-named-formulas-sidebar-create-step-a-next-button",
    );
    if (nextBtn) {
      await nextBtn.press("Enter");
      try {
        await this.page
          .locator(
            ".waffle-named-formulas-sidebar-create-step-b-named-formula-summary-message",
          )
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: 2000 });
      } catch {
        // may not appear
      }
    }

    // Click Create
    const createBtn = await this.page.$(
      ".waffle-named-formulas-sidebar-create-step-b-create-button",
    );
    if (createBtn) {
      await createBtn.press("Enter");
      await this.page.waitForTimeout(500);
    }

    // Wait for list view
    try {
      await this.page.waitForSelector(
        ".waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button",
        { state: "visible", timeout: 3000 },
      );
    } catch {
      // best effort
    }
  }

  async updateFunction(fn: NamedFunction): Promise<void> {
    await this.openSidebar();
    const { args, body } = unwrapLambda(fn.definition);
    this.log(`updating ${fn.name}(${args.join(", ")})`);

    // Find the target row
    const rows = await this.page.$$(
      ".waffle-named-formulas-sidebar-list-view-card",
    );
    let targetRow = null;
    for (const row of rows) {
      const nameEl = await row.$(
        ".waffle-named-formulas-sidebar-list-view-card-function-signature",
      );
      if (nameEl) {
        const text = await nameEl.innerText();
        if (text.startsWith(fn.name)) {
          targetRow = row;
          break;
        }
      }
    }

    if (!targetRow) {
      // Doesn't exist yet, create instead
      await this.createFunction(fn);
      return;
    }

    // Open menu → Edit
    const docsIcon = await targetRow.$(".docs-icon");
    if (docsIcon) {
      await docsIcon.click();
      await this.page
        .locator(
          '.waffle-named-formulas-sidebar-list-view-card-action-menu[role="menu"]',
        )
        .filter({ visible: true })
        .first()
        .waitFor({ state: "visible", timeout: 2000 });

      const actions = await this.page.$$(
        ".waffle-named-formulas-sidebar-list-view-card-action-menu-item",
      );
      for (const action of actions) {
        if ((await action.innerText()).trim() === "Edit") {
          await action.click();
          break;
        }
      }
    }

    // Wait for edit form
    await this.page
      .locator("div[aria-label='Enter formula description']")
      .filter({ visible: true })
      .first()
      .waitFor({ state: "visible", timeout: 2000 });

    // Update description
    const descInputs = await this.page.$$(
      "div[aria-label='Enter formula description']",
    );
    for (const inp of descInputs) {
      if (await inp.isVisible()) {
        await inp.fill(fn.description ?? "");
        break;
      }
    }

    // Update definition (body only)
    const defInputs = await this.page.$$(
      "div[aria-label='= Write formula here']",
    );
    for (const inp of defInputs) {
      if (await inp.isVisible()) {
        try {
          await inp.fill(body);
        } catch {
          await inp.evaluate(
            (el: HTMLElement, val: string) => (el.innerText = val),
            fn.definition,
          );
        }
        break;
      }
    }

    // Click Next
    const nextBtn = await this.page.$(
      ".waffle-named-formulas-sidebar-create-step-a-next-button:visible",
    );
    if (nextBtn) {
      await nextBtn.press("Enter");
      try {
        await this.page
          .locator(
            ".waffle-named-formulas-sidebar-create-step-b-named-formula-summary-message",
          )
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: 2000 });
      } catch {
        // may not appear
      }
    }

    // Click Save
    const saveBtn = await this.page.$(
      ".waffle-named-formulas-sidebar-create-step-b-create-button:visible",
    );
    if (saveBtn) {
      await saveBtn.press("Enter");
      await this.page.waitForTimeout(500);
    }

    try {
      await this.page.waitForSelector(
        ".waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button",
        { state: "visible", timeout: 3000 },
      );
    } catch {
      // best effort
    }
  }

  async deleteFunction(name: string): Promise<void> {
    await this.openSidebar();

    const rows = await this.page.$$(
      ".waffle-named-formulas-sidebar-list-view-card",
    );
    for (const row of rows) {
      const nameEl = await row.$(
        ".waffle-named-formulas-sidebar-list-view-card-function-signature",
      );
      if (nameEl) {
        const text = await nameEl.innerText();
        if (text.startsWith(name)) {
          const menuBtn = await row.$(
            ".waffle-named-formulas-sidebar-list-view-card-action-menu-button",
          );
          if (menuBtn) {
            await menuBtn.click();
            await this.page
              .locator(
                '.waffle-named-formulas-sidebar-list-view-card-action-menu[role="menu"]',
              )
              .filter({ visible: true })
              .first()
              .waitFor({ state: "visible", timeout: 2000 });

            const actions = await this.page.$$(
              ".waffle-named-formulas-sidebar-list-view-card-action-menu-item-action-name",
            );
            for (const action of actions) {
              if ((await action.innerText()) === "Remove") {
                await action.click();
                try {
                  await this.page
                    .locator(
                      `.waffle-named-formulas-sidebar-list-view-card:has-text("${name}")`,
                    )
                    .waitFor({ state: "detached", timeout: 5000 });
                } catch {
                  await this.page.waitForTimeout(500);
                }
                return;
              }
            }
          }
        }
      }
    }
  }

  // ─── Metadata (Sheets API with OAuth token) ───────────────────────

  /**
   * Make Sheets API calls using an OAuth token extracted from the browser session.
   */
  private async sheetsApiFetch(
    path: string,
    options: { method?: string; body?: string } = {},
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    const token = await getAccessToken(this.profileName);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (options.body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    });
    const body = await res.text();

    const result = { ok: res.ok, status: res.status, body };

    if (!result.ok) {
      this.log(`API ${options.method ?? "GET"} ${path} → ${result.status}: ${result.body.slice(0, 200)}`);
    }

    return {
      ok: result.ok,
      status: result.status,
      json: async () => JSON.parse(result.body),
    };
  }

  private async ensureSheet(name: string): Promise<void> {
    // Check if sheet exists
    const res = await this.sheetsApiFetch("");
    const data = (await res.json()) as {
      sheets: Array<{ properties: { title: string; sheetId: number } }>;
    };

    const existing = data.sheets?.find(
      (s) => s.properties.title === name,
    );
    if (existing) return;

    // Create and hide the sheet
    await this.sheetsApiFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: name,
                hidden: true,
              },
            },
          },
        ],
      }),
    });
  }

  async readMetadata(): Promise<ProjectMetadata | null> {
    try {
      const res = await this.sheetsApiFetch(
        `/values/'${MANIFEST_SHEET}'!A:B?valueRenderOption=UNFORMATTED_VALUE`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { values?: string[][] };
      if (!data.values?.length) return null;

      const meta: ProjectMetadata = { dependencies: {} };
      // Skip header row
      for (let i = 1; i < data.values.length; i++) {
        const key = (data.values[i][0] ?? "").trim();
        const val = (data.values[i][1] ?? "").trim();
        if (!key) continue;
        if (key.startsWith("dep:")) {
          meta.dependencies[key.slice(4)] = val;
        } else {
          (meta as Record<string, unknown>)[key] = val;
        }
      }
      return meta;
    } catch {
      return null;
    }
  }

  async writeMetadata(meta: ProjectMetadata): Promise<void> {
    this.log("writing metadata to hidden sheet...");
    await this.ensureSheet(MANIFEST_SHEET);

    const rows: string[][] = [["key", "value"]];
    for (const [key, val] of Object.entries(meta)) {
      if (key === "dependencies" || val === undefined) continue;
      rows.push([key, String(val)]);
    }
    for (const [name, version] of Object.entries(meta.dependencies)) {
      rows.push([`dep:${name}`, version]);
    }

    // Clear then write
    await this.sheetsApiFetch(
      `/values/'${MANIFEST_SHEET}'!A:B:clear`,
      { method: "POST" },
    );
    await this.sheetsApiFetch(
      `/values/'${MANIFEST_SHEET}'!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({ values: rows }),
      },
    );
  }

  async readLockfile(): Promise<Lockfile | null> {
    try {
      const res = await this.sheetsApiFetch(
        `/values/'${LOCK_SHEET}'!A:E?valueRenderOption=UNFORMATTED_VALUE`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { values?: string[][] };
      if (!data.values?.length) return null;

      const lock: Lockfile = { packages: {} };
      for (let i = 1; i < data.values.length; i++) {
        const name = (data.values[i][0] ?? "").trim();
        if (!name) continue;
        lock.packages[name] = {
          version: (data.values[i][1] ?? "").trim(),
          integrity: (data.values[i][2] ?? "").trim() || undefined,
          dependencies: splitComma(data.values[i][3] ?? ""),
          functions: splitComma(data.values[i][4] ?? ""),
        };
      }
      return lock;
    } catch {
      return null;
    }
  }

  async writeLockfile(lock: Lockfile): Promise<void> {
    this.log("writing lockfile to hidden sheet...");
    await this.ensureSheet(LOCK_SHEET);

    const rows: string[][] = [
      ["package", "version", "integrity", "dependencies", "functions"],
    ];
    for (const name of Object.keys(lock.packages).sort()) {
      const entry = lock.packages[name];
      rows.push([
        name,
        entry.version,
        entry.integrity ?? "",
        (entry.dependencies ?? []).join(", "),
        (entry.functions ?? []).join(", "),
      ]);
    }

    await this.sheetsApiFetch(
      `/values/'${LOCK_SHEET}'!A:E:clear`,
      { method: "POST" },
    );
    await this.sheetsApiFetch(
      `/values/'${LOCK_SHEET}'!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({ values: rows }),
      },
    );
  }

  // ─── Network ──────────────────────────────────────────────────────

  async fetchJSON(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.json();
  }

  async fetchBinary(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.arrayBuffer();
  }
}

function splitComma(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((x) => x.trim());
}

