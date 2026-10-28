import { UNIT_LABELS_RU, Unit } from "@bakery-os/shared";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface CountSheetLine {
  name: string;
  unit: Unit;
  // The heading the line is printed under; consecutive lines with the same one form a group.
  group: string;
}

// The paper people walk the shelf or the store with: every product in the
// screen's own order, a blank to write the count in — and NOT what the system
// expects, so the count is blind. Two columns: names are short, so one column
// left half of every page empty. A group's heading travels with its first
// product, never alone at a column's foot.
export function printCountSheet(title: string, lines: CountSheetLine[]) {
  const row = (line: CountSheetLine) =>
    `<div class="r"><span class="n">${escapeHtml(line.name)}</span><span class="b">${escapeHtml(UNIT_LABELS_RU[line.unit])}</span></div>`;
  const groups: { name: string; lines: CountSheetLine[] }[] = [];
  for (const line of lines) {
    if (groups.length === 0 || groups[groups.length - 1].name !== line.group) groups.push({ name: line.group, lines: [] });
    groups[groups.length - 1].lines.push(line);
  }
  const body = groups
    .map((g) => `<div class="k"><div class="g">${escapeHtml(g.name)}</div>${row(g.lines[0])}</div>${g.lines.slice(1).map(row).join("")}`)
    .join("");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пересчёт</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;margin:14px;color:#000}h1{font-size:17px;margin:0 0 4px}p{margin:4px 0 10px}
.cols{column-count:2;column-gap:18px}.k,.r{break-inside:avoid}
.g{background:#eee;font-weight:bold;padding:5px 6px;border:1px solid #999;margin-top:6px}.k:first-child .g{margin-top:0}
.r{display:flex;align-items:stretch;border:1px solid #999;margin-top:-1px}
.n{flex:1;padding:6px;line-height:1.25}.b{width:70px;border-left:1px solid #999;text-align:right;color:#666;font-size:11px;padding:2px 4px;display:flex;align-items:flex-end;justify-content:flex-end}</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>Считал(а): ______________________ &nbsp;&nbsp; Время: ________</p>
<div class="cols">${body}</div>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// Enter in a count field goes to the next one, top to bottom — the paper's order.
export function focusNextCount(current: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-count-input]"));
  const next = all[all.indexOf(current) + 1];
  if (next) {
    next.focus();
    next.select();
  } else {
    current.blur();
  }
}
