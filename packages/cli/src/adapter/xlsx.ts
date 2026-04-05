import JSZip from "jszip";
import { THEME_XML } from "./theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DefinedName {
  name: string;
  value: string;
  comment?: string;
}

export interface SheetCell {
  row: number;
  col: number;
  value: string;
}

// ─── XlsxFile ───────────────────────────────────────────────────────────────

export class XlsxFile {
  private zip: JSZip;
  private workbookXml: string;
  private relsXml: string;
  private contentTypesXml: string;

  private constructor(
    zip: JSZip,
    workbookXml: string,
    relsXml: string,
    contentTypesXml: string,
  ) {
    this.zip = zip;
    this.workbookXml = workbookXml;
    this.relsXml = relsXml;
    this.contentTypesXml = contentTypesXml;
  }

  static async open(data: Uint8Array): Promise<XlsxFile> {
    const zip = await JSZip.loadAsync(data);
    const workbookXml = await readZipText(zip, "xl/workbook.xml");
    const relsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
    const contentTypesXml = await readZipText(zip, "[Content_Types].xml");
    return new XlsxFile(zip, workbookXml, relsXml, contentTypesXml);
  }

  static async create(): Promise<XlsxFile> {
    const zip = new JSZip();

    const contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>";

    const relsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
      "</Relationships>";

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<fileVersion appName="xl" lastEdited="4" lowestEdited="4" rupBuild="4505"/>' +
      '<workbookPr defaultThemeVersion="124226"/>' +
      "<sheets>" +
      '<sheet name="Sheet1" sheetId="1" r:id="rId1"/>' +
      "</sheets>" +
      '<calcPr calcId="124519" fullCalcOnLoad="1"/>' +
      "</workbook>";

    zip.file("[Content_Types].xml", contentTypesXml);

    zip.file(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    );

    zip.file("xl/workbook.xml", workbookXml);
    zip.file("xl/_rels/workbook.xml.rels", relsXml);

    zip.file("xl/theme/theme1.xml", THEME_XML);

    zip.file(
      "xl/styles.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        "</styleSheet>",
    );

    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        "<sheetData/>" +
        "</worksheet>",
    );

    return new XlsxFile(zip, workbookXml, relsXml, contentTypesXml);
  }

  async save(): Promise<Uint8Array> {
    this.flush();
    return this.zip.generateAsync({ type: "uint8array" });
  }

  /** Write cached XML strings back to the zip. */
  private flush(): void {
    this.zip.file("xl/workbook.xml", this.workbookXml);
    this.zip.file("xl/_rels/workbook.xml.rels", this.relsXml);
    this.zip.file("[Content_Types].xml", this.contentTypesXml);
  }

  // ─── Defined Names ──────────────────────────────────────────────────────

  readDefinedNames(): DefinedName[] {
    const names: DefinedName[] = [];

    const blockMatch = this.workbookXml.match(
      /<(?:\w+:)?definedNames>([\s\S]*?)<\/(?:\w+:)?definedNames>/,
    );
    if (!blockMatch) return names;

    const block = blockMatch[1];
    const nameRe =
      /<(?:\w+:)?definedName\s+([^>]*)>([\s\S]*?)<\/(?:\w+:)?definedName>/g;
    let m;
    while ((m = nameRe.exec(block)) !== null) {
      const attrs = m[1];
      const value = xmlUnescape(m[2]);

      const nameMatch = attrs.match(/name="([^"]*)"/);
      if (!nameMatch) continue;

      const commentMatch = attrs.match(/comment="([^"]*)"/);
      names.push({
        name: nameMatch[1],
        value,
        comment: commentMatch ? xmlUnescape(commentMatch[1]) : undefined,
      });
    }
    return names;
  }

  writeDefinedNames(names: DefinedName[]): void {
    if (names.length === 0) {
      this.workbookXml = this.workbookXml.replace(
        /<(?:\w+:)?definedNames>[\s\S]*?<\/(?:\w+:)?definedNames>/,
        "",
      );
      return;
    }

    const elements = names
      .map((n) => {
        const commentAttr = n.comment
          ? ` comment="${xmlEscape(n.comment)}"`
          : "";
        return `<definedName name="${xmlEscape(n.name)}"${commentAttr}>${xmlEscapeText(n.value)}</definedName>`;
      })
      .join("");

    const block = `<definedNames>${elements}</definedNames>`;

    const existingBlock =
      /<(?:\w+:)?definedNames>[\s\S]*?<\/(?:\w+:)?definedNames>/;
    if (existingBlock.test(this.workbookXml)) {
      this.workbookXml = this.workbookXml.replace(existingBlock, block);
    } else {
      // Insert after </sheets>
      this.workbookXml = this.workbookXml.replace(
        /(<\/(?:\w+:)?sheets>)/,
        "$1" + block,
      );
    }
  }

  // ─── Hidden Sheets ────────────────────────────────────────────────────

  async readHiddenSheet(sheetName: string): Promise<SheetCell[]> {
    const sheetPath = this.findSheetPath(sheetName);
    if (!sheetPath) return [];

    const file = this.zip.file(sheetPath);
    if (!file) return [];

    const xml = await file.async("string");
    return parseSheetData(xml);
  }

  async writeHiddenSheet(
    sheetName: string,
    cells: SheetCell[],
  ): Promise<void> {
    let sheetPath = this.findSheetPath(sheetName);
    if (!sheetPath) {
      sheetPath = this.createHiddenSheet(sheetName);
    }
    this.zip.file(sheetPath, buildSheetXml(cells));
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private findSheetPath(sheetName: string): string | null {
    const sheetRe = new RegExp(
      `<(?:\\w+:)?sheet\\s+[^>]*name="${regexEscape(sheetName)}"[^>]*/?>`,
    );
    const sheetMatch = this.workbookXml.match(sheetRe);
    if (!sheetMatch) return null;

    const ridMatch = sheetMatch[0].match(/r:id="([^"]*)"/);
    if (!ridMatch) return null;

    return this.resolveRel(ridMatch[1]);
  }

  private resolveRel(rId: string): string | null {
    const relRe = new RegExp(
      `<Relationship\\s+[^>]*Id="${regexEscape(rId)}"[^>]*/?>`,
    );
    const relMatch = this.relsXml.match(relRe);
    if (!relMatch) return null;

    const targetMatch = relMatch[0].match(/Target="([^"]*)"/);
    if (!targetMatch) return null;

    return "xl/" + targetMatch[1];
  }

  private createHiddenSheet(sheetName: string): string {
    // Next sheet ID
    const sheetIdRe = /sheetId="(\d+)"/g;
    let maxId = 0;
    let m;
    while ((m = sheetIdRe.exec(this.workbookXml)) !== null) {
      maxId = Math.max(maxId, parseInt(m[1], 10));
    }
    const newId = maxId + 1;

    // Next relationship ID
    const rIdRe = /Id="rId(\d+)"/g;
    let maxRId = 0;
    while ((m = rIdRe.exec(this.relsXml)) !== null) {
      maxRId = Math.max(maxRId, parseInt(m[1], 10));
    }
    const newRId = `rId${maxRId + 1}`;

    const sheetPath = `xl/worksheets/sheet${newId}.xml`;

    // Create empty worksheet
    this.zip.file(sheetPath, buildSheetXml([]));

    // Add to [Content_Types].xml
    this.contentTypesXml = this.contentTypesXml.replace(
      "</Types>",
      `<Override PartName="/xl/worksheets/sheet${newId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );

    // Add relationship
    this.relsXml = this.relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${newId}.xml"/></Relationships>`,
    );

    // Add <sheet> element with state="veryHidden"
    this.workbookXml = this.workbookXml.replace(
      /(<\/(?:\w+:)?sheets>)/,
      `<sheet name="${xmlEscape(sheetName)}" sheetId="${newId}" state="veryHidden" r:id="${newRId}"/>$1`,
    );

    return sheetPath;
  }
}

// ─── XML Utilities ──────────────────────────────────────────────────────────

/** Escape for XML attribute values (escapes quotes). */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape for XML element text content (no quote escaping needed). */
export function xmlEscapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function xmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Sheet XML parsing/building ─────────────────────────────────────────────

function parseSheetData(xml: string): SheetCell[] {
  const cells: SheetCell[] = [];
  const cellRe =
    /<c\s+r="([A-Z]+)(\d+)"[^>]*>(?:<v>([^<]*)<\/v>|<is><t>([^<]*)<\/t><\/is>)/g;
  let m;
  while ((m = cellRe.exec(xml)) !== null) {
    const col = colLetterToIndex(m[1]);
    const row = parseInt(m[2], 10);
    const value = xmlUnescape(m[3] ?? m[4] ?? "");
    cells.push({ row, col, value });
  }
  return cells;
}

function buildSheetXml(cells: SheetCell[]): string {
  const rows = new Map<number, SheetCell[]>();
  for (const cell of cells) {
    let row = rows.get(cell.row);
    if (!row) {
      row = [];
      rows.set(cell.row, row);
    }
    row.push(cell);
  }

  let sheetData = "";
  for (const rowNum of [...rows.keys()].sort((a, b) => a - b)) {
    const rowCells = rows.get(rowNum)!;
    let rowXml = `<row r="${rowNum}">`;
    for (const cell of rowCells.sort((a, b) => a.col - b.col)) {
      const ref = colIndexToLetter(cell.col) + cell.row;
      rowXml += `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell.value)}</t></is></c>`;
    }
    rowXml += "</row>";
    sheetData += rowXml;
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetData}</sheetData>` +
    "</worksheet>"
  );
}

function colLetterToIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col;
}

function colIndexToLetter(col: number): string {
  let letters = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    col = Math.floor((col - 1) / 26);
  }
  return letters;
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing ${path} in xlsx`);
  return file.async("string");
}
