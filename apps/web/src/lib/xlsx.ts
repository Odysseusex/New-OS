// A real Excel workbook (.xlsx), written by hand: an .xlsx is a zip of a few XML
// files, so no spreadsheet library is needed — and none of their weight in the
// bundle, or their old security advisories. Loaded only when somebody presses
// «Excel» (the button calls `downloadTable`, which imports this lazily).
//
// What it gives the finance people: numbers that are numbers (they sum, sort and
// chart), a bold header that stays in view, sensible column widths, and a
// title above the table when the report has one.

import { strToU8, zipSync } from "fflate";

export type XlsxFormat = "text" | "money" | "int" | "percent";

export interface XlsxCellObject {
  v: string | number | null;
  fmt?: XlsxFormat;
  bold?: boolean;
}
export type XlsxCell = string | number | null | undefined | XlsxCellObject;

export interface XlsxSheet {
  name: string;
  // Lines above the table (the report's name, its period), one per row.
  titleLines?: string[];
  headers: string[];
  rows: XlsxCell[][];
  // Per column; a column of plain numbers defaults to «int» or «money» by what it holds.
  columnFormats?: XlsxFormat[];
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Characters XML 1.0 cannot carry (a stray control character from pasted text
// would make Excel refuse the whole file).
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const escapeXml = (text: string) =>
  text.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// A sheet name: 31 characters at most, none of  [ ] : * ? / \ , and unique in the book.
export function safeSheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Лист").slice(0, 31);
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// Cell styles (the index in <cellXfs>): number format × bold, then the table
// header and the title.
const FORMAT_ORDER: XlsxFormat[] = ["text", "money", "int", "percent"];
const styleOf = (fmt: XlsxFormat, bold: boolean): number => FORMAT_ORDER.indexOf(fmt) + (bold ? FORMAT_ORDER.length : 0);
const HEADER_STYLE = FORMAT_ORDER.length * 2;
const TITLE_STYLE = HEADER_STYLE + 1;

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${TITLE_STYLE + 1}">
${[0, 1]
  .flatMap((bold) =>
    [0, 164, 3, 165].map(
      (numFmtId) =>
        `<xf numFmtId="${numFmtId}" fontId="${bold}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`,
    ),
  )
  .join("\n")}
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// «1234.50» (what toFixed gives) and «12» become numbers; «007», a БИН (12
// digits), a phone, «—» and «нет данных» stay text, as does anything formatted
// with a currency sign.
export function coerceNumber(value: string): number | null {
  const text = value.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const digits = text.replace(/^-/, "").split(".")[0];
  if (digits.length > 1 && digits.startsWith("0")) return null;
  if (!text.includes(".") && digits.length >= 9) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

interface Resolved {
  v: string | number | null;
  fmt?: XlsxFormat;
  bold: boolean;
}

function resolve(cell: XlsxCell): Resolved {
  if (cell === null || cell === undefined) return { v: null, bold: false };
  if (typeof cell === "object") {
    const inner = typeof cell.v === "string" ? (coerceNumber(cell.v) ?? cell.v) : cell.v;
    return { v: inner, fmt: cell.fmt, bold: Boolean(cell.bold) };
  }
  if (typeof cell === "string") return { v: coerceNumber(cell) ?? cell, bold: false };
  return { v: Number.isFinite(cell) ? cell : null, bold: false };
}

// The format of a column of plain numbers: money when any value has kopecks,
// whole numbers otherwise, so a column reads evenly.
function inferColumnFormats(rows: Resolved[][], width: number, declared: XlsxFormat[] | undefined): XlsxFormat[] {
  return Array.from({ length: width }, (_, c) => {
    const given = declared?.[c];
    if (given) return given;
    const numbers = rows.map((r) => r[c]?.v).filter((v): v is number => typeof v === "number");
    if (numbers.length === 0) return "text";
    return numbers.some((n) => !Number.isInteger(n)) ? "money" : "int";
  });
}

function sheetXml(sheet: XlsxSheet): string {
  const titles = sheet.titleLines ?? [];
  const resolvedRows = sheet.rows.map((r) => r.map(resolve));
  const width = Math.max(sheet.headers.length, ...resolvedRows.map((r) => r.length), 1);
  const formats = inferColumnFormats(resolvedRows, width, sheet.columnFormats);
  const widths = Array.from({ length: width }, (_, c) => {
    const texts = [sheet.headers[c] ?? "", ...resolvedRows.map((r) => (r[c]?.v === null || r[c]?.v === undefined ? "" : String(r[c].v)))];
    const longest = Math.max(...texts.map((t) => t.length), 6);
    return Math.min(60, Math.max(10, Math.ceil(longest * 1.15) + 2));
  });

  const rowsXml: string[] = [];
  let rowNo = 1;
  for (const line of titles) {
    rowsXml.push(`<row r="${rowNo}"><c r="A${rowNo}" s="${TITLE_STYLE}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(line)}</t></is></c></row>`);
    rowNo += 1;
  }
  if (titles.length > 0) rowNo += 1; // a blank line between the title and the table
  const headerRow = rowNo;
  rowsXml.push(
    `<row r="${rowNo}" ht="30" customHeight="1">${Array.from({ length: width }, (_, c) => {
      const text = sheet.headers[c] ?? "";
      return `<c r="${columnLetter(c)}${rowNo}" s="${HEADER_STYLE}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("")}</row>`,
  );
  rowNo += 1;
  for (const row of resolvedRows) {
    const cells: string[] = [];
    row.forEach((cell, c) => {
      if (cell.v === null) return;
      const ref = `${columnLetter(c)}${rowNo}`;
      if (typeof cell.v === "number") {
        const fmt = cell.fmt ?? (formats[c] === "text" ? "money" : formats[c]);
        const shown = fmt === "percent" ? cell.v / 100 : cell.v;
        cells.push(`<c r="${ref}" s="${styleOf(fmt, cell.bold)}"><v>${shown}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" s="${styleOf("text", cell.bold)}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`);
      }
    });
    rowsXml.push(`<row r="${rowNo}">${cells.join("")}</row>`);
    rowNo += 1;
  }
  const lastRow = Math.max(rowNo - 1, headerRow);
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${columnLetter(width - 1)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

// The whole workbook as bytes.
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const list = sheets.length > 0 ? sheets : [{ name: "Лист", headers: [], rows: [] }];
  const taken = new Set<string>();
  const names = list.map((s) => safeSheetName(s.name, taken));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${list
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  list.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadXlsx(filename: string, sheets: XlsxSheet[]): void {
  const bytes = buildXlsx(sheets);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename.replace(/\.csv$/i, "")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
