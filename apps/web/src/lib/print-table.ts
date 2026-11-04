import { coerceNumber } from "@/lib/coerce-number";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx";

// The PDF of a report: the very table «Excel» writes, laid out as a clean page
// and handed to the browser's print dialog («Сохранить как PDF»). No PDF
// library — the browser renders Cyrillic and page breaks better than any of them.

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function cellHtml(cell: XlsxCell, moneyColumn: boolean): { html: string; numeric: boolean; bold: boolean } {
  if (cell === null || cell === undefined) return { html: "", numeric: false, bold: false };
  const obj = typeof cell === "object" ? cell : { v: cell };
  const bold = typeof cell === "object" && Boolean(cell.bold);
  let v = obj.v;
  if (typeof v === "string") v = coerceNumber(v) ?? v;
  if (typeof v === "number") {
    const fmt = typeof cell === "object" ? cell.fmt : undefined;
    const text =
      fmt === "percent" ? `${percent.format(v)}%` : fmt === "money" || (fmt !== "int" && moneyColumn) ? money.format(v) : whole.format(v);
    return { html: escapeHtml(text.replace(/ /g, " ")), numeric: true, bold };
  }
  return { html: escapeHtml(v ?? ""), numeric: false, bold };
}

function sheetHtml(sheet: XlsxSheet): string {
  const width = Math.max(sheet.headers.length, ...sheet.rows.map((r) => r.length));
  // A column with kopecks anywhere is shown with two decimals throughout.
  const moneyColumn = Array.from({ length: width }, (_, c) =>
    sheet.rows.some((r) => {
      const cell = r[c];
      const v = typeof cell === "object" && cell !== null ? cell.v : cell;
      const n = typeof v === "number" ? v : typeof v === "string" ? coerceNumber(v) : null;
      return n !== null && !Number.isInteger(n);
    }),
  );
  const titles = (sheet.titleLines ?? []).map((t, i) => (i === 0 ? `<h1>${escapeHtml(t)}</h1>` : `<p>${escapeHtml(t)}</p>`)).join("");
  const head = `<tr>${Array.from({ length: width }, (_, c) => `<th>${escapeHtml(sheet.headers[c] ?? "")}</th>`).join("")}</tr>`;
  const body = sheet.rows
    .map((row) => {
      const cells = Array.from({ length: width }, (_, c) => cellHtml(row[c], moneyColumn[c]));
      const rowBold = cells.some((x) => x.bold);
      return `<tr${rowBold ? ' class="b"' : ""}>${cells.map((x) => `<td${x.numeric ? ' class="n"' : ""}>${x.html}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<section>${titles || `<h1>${escapeHtml(sheet.name)}</h1>`}<table><thead>${head}</thead><tbody>${body}</tbody></table></section>`;
}

export function printSheets(sheets: XlsxSheet[]): void {
  const wide = sheets.some((s) => s.headers.length > 6);
  const printed = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(sheets[0]?.titleLines?.[0] ?? sheets[0]?.name ?? "Отчёт")}</title>
<style>@page{size:A4 ${wide ? "landscape" : "portrait"};margin:12mm}
body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:0}
h1{font-size:15px;margin:0 0 3px}p{margin:0 0 3px;color:#333}
section{margin-bottom:16px}section+section{break-before:page}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #999;padding:3px 5px;vertical-align:top}
th{background:#eee;text-align:left;font-weight:bold}
thead{display:table-header-group}tr{break-inside:avoid}
td.n{text-align:right;white-space:nowrap}tr.b td{font-weight:bold;background:#f6f6f6}
footer{margin-top:10px;color:#666;font-size:10px}</style></head><body>
${sheets.map(sheetHtml).join("")}
<footer>ArAmir OS · распечатано ${escapeHtml(printed)}</footer>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Браузер заблокировал окно печати — разрешите всплывающие окна для этого сайта");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
