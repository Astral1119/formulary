/**
 * Direct Google Sheets API calls using an OAuth token.
 *
 * Used by `formulary new --gsheets` to create a new sheet without
 * launching Playwright. The named-function management still requires
 * Playwright (no Google API for that), but creating sheets and writing
 * cells is just REST.
 */

import { getAccessToken } from "./oauth.js";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export interface NewSheetResult {
  spreadsheetId: string;
  url: string;
  title: string;
}

/**
 * Create a new spreadsheet in the authenticated user's Drive root.
 * Returns the spreadsheet ID and URL.
 */
export async function createSheet(
  title: string,
  profileName: string = "default",
): Promise<NewSheetResult> {
  const token = await getAccessToken(profileName);

  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Sheets API failed to create sheet: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
  };

  return {
    spreadsheetId: data.spreadsheetId,
    url: data.spreadsheetUrl,
    title: data.properties.title,
  };
}
