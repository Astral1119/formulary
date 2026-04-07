/**
 * Playwright driver for Google Sheets browser automation.
 *
 * Manages a persistent Chromium browser context. Google auth persists
 * in the user data directory between runs.
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";

export class GSheetsDriver {
  private _context: BrowserContext | null = null;
  private _page: Page | null = null;
  verbose: boolean = true;

  constructor(
    private profileDir: string,
    private headless: boolean = true,
  ) {}

  log(msg: string): void {
    if (this.verbose) console.log(`  [gsheets] ${msg}`);
  }

  async start(): Promise<void> {
    await mkdir(this.profileDir, { recursive: true });
    this.log(`profile: ${this.profileDir}`);
    this.log(`headless: ${this.headless}`);

    this._context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--password-store=basic",
        "--use-mock-keychain",
      ],
      viewport: { width: 1400, height: 900 },
    });

    this._page =
      this._context.pages()[0] ?? (await this._context.newPage());
  }

  async stop(): Promise<void> {
    if (this._context) {
      await this._context.close();
      this._context = null;
      this._page = null;
    }
  }

  get page(): Page {
    if (!this._page) throw new Error("Driver not started. Call start() first.");
    return this._page;
  }

  get context(): BrowserContext {
    if (!this._context)
      throw new Error("Driver not started. Call start() first.");
    return this._context;
  }

  /** Extract cookies for Sheets API calls. */
  async getCookies(): Promise<
    Array<{ name: string; value: string; domain: string }>
  > {
    if (!this._context) return [];
    return this._context.cookies();
  }
}
