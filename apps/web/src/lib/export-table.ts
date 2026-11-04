import { downloadCsv } from "@/lib/csv";
// Small and loaded with the page: the print window has to open inside the click.
import { printSheets } from "@/lib/print-table";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx";

// Where the next table goes: the «PDF» button runs the same export function as
// «Excel» inside `withExportTarget("pdf", …)`, so every report prints exactly
// the table it would save. Read synchronously at the start of each call.
let target: "xlsx" | "pdf" = "xlsx";

export function withExportTarget(next: "xlsx" | "pdf", run: () => unknown): void {
  target = next;
  try {
    void run();
  } finally {
    target = "xlsx";
  }
}


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
  if (target === "pdf") {
    const base = filename.replace(/\.(csv|xlsx)$/i, "");
    printSheets([{ name: options.sheetName ?? base, titleLines: options.titleLines, headers, rows }]);
    return;
  }
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
  if (target === "pdf") {
    printSheets(sheets);
    return;
  }
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
