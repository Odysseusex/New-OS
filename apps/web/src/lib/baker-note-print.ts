import type { BakerNoteDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";

// The printed накладная of a baker's note: one A4 sheet per note, read at arm's length — it goes into
// the box with the goods and the boxes are sorted by the «Кому» line. Its own page rather than the
// report table of print-table.ts (small type made for wide reports).

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nbsp = (text: string) => text.replace(/[   ]/g, " ");
// Tenge without «,00»; kopecks only when there really are some.
const money = (n: number) => nbsp(new Intl.NumberFormat("ru-RU", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
const qty = (n: number) => nbsp(new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n));
const dayLabel = (key: string) => key.split("-").reverse().join(".");

// «120 шт» — and «120 шт, 3,5 кг» when the note also carries goods sold by weight.
function totalQuantity(note: BakerNoteDto): string {
  const byUnit = new Map<string, number>();
  for (const l of note.lines) byUnit.set(l.unit, Math.round(((byUnit.get(l.unit) ?? 0) + l.quantity) * 1000) / 1000);
  return Array.from(byUnit).map(([unit, n]) => `${qty(n)} ${UNIT_LABELS_RU[unit as keyof typeof UNIT_LABELS_RU]}`).join(", ");
}

function noteHtml(note: BakerNoteDto): string {
  const rows = note.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(l.productName)}</td><td class="n">${qty(l.quantity)}</td><td class="c">${UNIT_LABELS_RU[l.unit]}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.subtotal)}</td></tr>`,
    )
    .join("");
  return `<section>
<h1>Накладная № ${note.number} от ${dayLabel(note.day)}</h1>
<div class="who">
<p><span>Откуда</span>${esc(note.sourceLocationName)}</p>
<p class="to"><span>Кому</span>${esc(note.recipient?.name ?? "")}</p>
<p><span>Пекарь</span>${esc(note.createdByName)}</p>
</div>
<table>
<colgroup><col style="width:12mm"><col><col style="width:24mm"><col style="width:14mm"><col style="width:26mm"><col style="width:36mm"></colgroup>
<thead><tr><th class="c">№</th><th>Товар</th><th class="n">Кол-во</th><th class="c">Ед.</th><th class="n">Цена</th><th class="n">Сумма</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">Итого</td><td class="n" colspan="3">${totalQuantity(note)}</td><td class="n">${money(note.total)} ₸</td></tr></tfoot>
</table>
<div class="sign"><p>Отпустил <i></i></p><p>Получил <i></i></p></div>
</section>`;
}

export function bakerNotesPrintHtml(notes: BakerNoteDto[]): string {
  const title = notes.length === 1 ? `Накладная № ${notes[0].number}` : "Накладные пекарей";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page{size:A4 portrait;margin:15mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:12.5pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
section{width:100%}
section+section{break-before:page;page-break-before:always}
h1{font-size:22pt;line-height:1.15;margin:0 0 5mm}
.who{margin:0 0 6mm}
.who p{margin:0 0 1.5mm;font-size:13pt;line-height:1.25}
.who span{display:inline-block;width:24mm;color:#444;font-size:11pt}
.who p.to{font-size:24pt;font-weight:bold;margin:2mm 0 2.5mm;line-height:1.1}
.who p.to span{font-weight:normal;vertical-align:middle}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:0.3mm solid #000;padding:1mm 2mm;height:9mm;vertical-align:middle;overflow-wrap:anywhere}
th{background:#e8e8e8;font-weight:bold;text-align:left;font-size:11.5pt}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
.n{text-align:right;white-space:nowrap}
.c{text-align:center;white-space:nowrap;padding:0 1mm}
tfoot{display:table-row-group}
tfoot td{font-weight:bold;font-size:15pt;height:11mm;border-top:0.6mm solid #000}
.sign{margin-top:14mm;font-size:13pt;white-space:nowrap;break-inside:avoid;page-break-inside:avoid}
.sign p{display:inline-block;width:48%;margin:0}
.sign p+p{margin-left:4%}
.sign i{display:inline-block;width:55mm;border-bottom:0.3mm solid #000;margin-left:3mm}
@media screen{body{padding:15mm;max-width:210mm;margin:0 auto}}
</style></head><body>
${notes.map(noteHtml).join("\n")}
</body></html>`;
}

export function printBakerNotes(notes: BakerNoteDto[]): void {
  if (notes.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Браузер заблокировал окно печати — разрешите всплывающие окна для этого сайта");
    return;
  }
  win.document.write(bakerNotesPrintHtml(notes));
  win.document.close();
  win.focus();
  win.print();
}
