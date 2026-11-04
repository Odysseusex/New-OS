import { downloadCsv } from "@/lib/csv";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx";

// One call for every «Excel» button: a table of headers and rows becomes a real
// .xlsx workbook (numbers stay numbers). The writer is loaded only now, so the
// reports pages do not carry it. If it cannot load (an old cached page, a
// blocked chunk), the same table is saved as CSV instead of failing silently.
export async function downloadTable(
  filename: string,
  headers: string[],
  rows: XlsxCell[][],
  options: { sheetName?: string; titleLines?: string[] } = {},
): Promise<void> {
  try {
    const { downloadXlsx } = await import("@/lib/xlsx");
    const base = filename.replace(/\.(csv|xlsx)$/i, "");
    downloadXlsx(`${base}.xlsx`, [{ name: options.sheetName ?? base.slice(0, 31), titleLines: options.titleLines, headers, rows }]);
  } catch {
    downloadCsv(
      filename.replace(/\.xlsx$/i, ".csv"),
      headers,
      rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "object" ? (c.v ?? "") : c))),
    );
  }
}

// Several tables in one workbook, a sheet each (the CSV fallback keeps the first).
export async function downloadWorkbook(filename: string, sheets: XlsxSheet[]): Promise<void> {
  try {
    const { downloadXlsx } = await import("@/lib/xlsx");
    downloadXlsx(`${filename.replace(/\.(csv|xlsx)$/i, "")}.xlsx`, sheets);
  } catch {
    const first = sheets[0];
    downloadCsv(
      `${filename.replace(/\.(csv|xlsx)$/i, "")}.csv`,
      first.headers,
      first.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "object" ? (c.v ?? "") : c))),
    );
  }
}
