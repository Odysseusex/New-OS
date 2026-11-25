import type { BakerNoteDto, ProductDto, SaleDetailDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU, Unit } from "@bakery-os/shared";

// ONE look for every накладная — the bakers' notes and a sale to a wholesale customer — in two
// forms made from the same data: a picture to send to the customer (lib/waybill-image.ts) and an A4
// page to print (below). Nothing of the books is on it: no cost, no margin, no notes for staff.

export interface WaybillLine {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  sum: number;
}

export interface Waybill {
  // Stable key for lists and file names.
  id: string;
  brand: string;
  number: string;
  // «25.11.2026, 14:05»
  dateTime: string;
  from: string;
  recipient: string;
  // Goods going to one of our own points, not to a customer.
  transfer: boolean;
  lines: WaybillLine[];
  total: number;
  // A sale to a customer: what is paid and what is still owed for it.
  paid: number | null;
  debt: number | null;
}

export const WAYBILL_BRAND = "Ar-Amir";

// The recipient's name is set in Forum (owner's pick of eight, 25.11.2026): thin, classical, close to the poster's
// Tenor Sans — which itself has none of ӘҒҚҢӨҰҮҺ, Forum has them all. Served from our own /fonts, the same files
// Google gives, so no outside service is asked at print or picture time. One weight only (400).
export const WAYBILL_DISPLAY_FAMILY = "Waybill Display";
export const WAYBILL_DISPLAY_FACES: { file: string; range: string }[] = [
  { file: "/fonts/Forum-cyrillic-ext.woff2", range: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  { file: "/fonts/Forum-cyrillic.woff2", range: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  { file: "/fonts/Forum-latin.woff2", range: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
];
const displayFaceCss = (origin: string) =>
  WAYBILL_DISPLAY_FACES.map(
    (f) => `@font-face{font-family:"${WAYBILL_DISPLAY_FAMILY}";font-weight:400;font-style:normal;src:url(${origin}${f.file}) format("woff2");unicode-range:${f.range}}`,
  ).join("\n");

const nbsp = (text: string) => text.replace(/[   ]/g, " ");
// Tenge without «,00»; тиын only when there really are some.
export const waybillMoney = (n: number) =>
  nbsp(new Intl.NumberFormat("ru-RU", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
export const waybillQty = (n: number) => nbsp(new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n));

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// «120 шт» — and «120 шт, 3,5 кг» when the накладная also carries goods sold by weight.
export function waybillQuantityTotal(w: Waybill): string {
  const byUnit = new Map<string, number>();
  for (const l of w.lines) byUnit.set(l.unit, Math.round(((byUnit.get(l.unit) ?? 0) + l.quantity) * 1000) / 1000);
  return Array.from(byUnit)
    .map(([unit, n]) => `${waybillQty(n)} ${unit}`)
    .join(", ");
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
// «Итого: 5 позиций, 120 шт»
export const waybillSummary = (w: Waybill) =>
  `Итого: ${w.lines.length} ${plural(w.lines.length, "позиция", "позиции", "позиций")}, ${waybillQuantityTotal(w)}`;

export const waybillRecipientLabel = (w: Waybill) => (w.transfer ? "Перемещение на точку" : "Получатель");

export function bakerNoteWaybill(note: BakerNoteDto, brand = WAYBILL_BRAND): Waybill {
  return {
    id: `note-${note.id}`,
    brand,
    number: String(note.number),
    dateTime: stamp(note.createdAt),
    from: note.sourceLocationName,
    recipient: note.recipient?.name ?? "",
    transfer: note.recipient?.kind === "location",
    lines: note.lines.map((l) => ({ name: l.productName, quantity: l.quantity, unit: UNIT_LABELS_RU[l.unit], price: l.unitPrice, sum: l.subtotal })),
    total: note.total,
    paid: null,
    debt: null,
  };
}

// A sale's lines carry no unit of their own: it is the product's.
export type UnitByProduct = Map<string, Unit>;
export const unitsOf = (products: Pick<ProductDto, "id" | "unit">[]): UnitByProduct => new Map(products.map((p) => [p.id, p.unit]));

export function saleWaybill(sale: SaleDetailDto, units: UnitByProduct, brand = WAYBILL_BRAND): Waybill {
  return {
    id: `sale-${sale.id}`,
    brand,
    number: sale.number !== null ? String(sale.number) : sale.id.slice(-8).toUpperCase(),
    dateTime: stamp(sale.soldAt),
    from: sale.locationName,
    recipient: sale.customerName ?? "Розничный покупатель",
    transfer: false,
    lines: sale.items.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      unit: UNIT_LABELS_RU[units.get(i.productId) ?? Unit.PCS],
      price: i.unitPrice,
      sum: i.subtotal,
    })),
    total: sale.totalAmount,
    paid: sale.customerId ? sale.amountPaid : null,
    debt: sale.customerId ? sale.balanceDue : null,
  };
}

// ── the printed page ──

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function waybillHtml(w: Waybill): string {
  const rows = w.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}</td><td class="n">${waybillQty(l.quantity)}</td><td class="c">${esc(l.unit)}</td><td class="n">${waybillMoney(l.price)}</td><td class="n b">${waybillMoney(l.sum)}</td></tr>`,
    )
    .join("");
  const money =
    w.paid !== null && w.debt !== null
      ? `<div class="pay"><p><span>Оплачено</span>${waybillMoney(w.paid)} ₸</p><p><span>Остаток долга</span>${waybillMoney(w.debt)} ₸</p></div>`
      : "";
  return `<section>
<header>
<div><p class="brand">${esc(w.brand)}</p><p class="doc">Накладная № ${esc(w.number)}</p><p class="when">${esc(w.dateTime)}</p></div>
<div class="from"><span>Отгружено с</span><b>${esc(w.from)}</b></div>
</header>
<div class="to"><span>${waybillRecipientLabel(w)}</span><b>${esc(w.recipient)}</b></div>
<table>
<colgroup><col><col style="width:22mm"><col style="width:13mm"><col style="width:24mm"><col style="width:30mm"></colgroup>
<thead><tr><th>Товар</th><th class="n">Кол-во</th><th class="c">Ед.</th><th class="n">Цена</th><th class="n">Сумма</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="total"><p>${esc(waybillSummary(w))}</p><b>${waybillMoney(w.total)} ₸</b></div>
${money}
<div class="sign"><div><p>Сдал:</p><i>Подпись</i></div><div><p>Принял:</p><i>Подпись</i></div></div>
</section>`;
}

// `pack`: several накладные on one sheet with a cut line between them, to save paper; otherwise one per sheet.
// The browser places them itself and never breaks one across sheets (break-inside: avoid) — so the print
// dialog's own «Масштаб» works: at 70 % more of them fit on a sheet. The earlier version measured the notes on
// the screen and forced the page breaks itself, which a smaller print scale could not undo (operator,
// 25.11.2026: «только две на одну страницу, даже если уменьшить размер»).
export function waybillsPrintHtml(list: Waybill[], pack = false, origin = typeof window === "undefined" ? "" : window.location.origin): string {
  const title = list.length === 1 ? `Накладная № ${list[0].number}` : "Накладные";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
${displayFaceCss(origin)}
@page{size:A4 portrait;margin:15mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,Helvetica,sans-serif;font-size:10.5pt;color:#1c1917;-webkit-print-color-adjust:exact;print-color-adjust:exact}
p{margin:0}
section{width:100%}
section+section{break-before:page;page-break-before:always}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;margin-bottom:6mm}
.brand{font-size:14pt;font-weight:600;line-height:1.1}
.doc{font-size:11pt;margin-top:1.6mm}
.when{font-size:9pt;color:#78716c;margin-top:0.8mm}
.from{text-align:right;max-width:70mm}
.from span,.to span{display:block;font-size:8.5pt;color:#78716c}
.from b{display:block;font-size:11pt;font-weight:500;margin-top:0.8mm;line-height:1.2}
.to{background:#f6f1ea;border-radius:3mm;padding:3.4mm 5mm 3.8mm;margin-bottom:4.5mm;break-inside:avoid;page-break-inside:avoid}
.to b{display:block;font-family:"${WAYBILL_DISPLAY_FAMILY}",Georgia,serif;font-size:20pt;font-weight:400;line-height:1.15;margin-top:0.8mm;color:#1c1917}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{padding:0.8mm 2mm;height:7.6mm;vertical-align:middle;overflow-wrap:anywhere;border-bottom:0.2mm solid #d6d0c8}
th{text-align:left;font-size:7.5pt;font-weight:500;color:#78716c;text-transform:uppercase;letter-spacing:0.06em;border-bottom:0.2mm solid #a8a29e}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
.n{text-align:right;white-space:nowrap}
.c{text-align:center;white-space:nowrap;padding:0 1mm}
td.c{color:#78716c;font-size:9.5pt}
th:first-child,td:first-child{padding-left:0}
.b{font-weight:500}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:6mm;margin-top:4mm;break-inside:avoid;page-break-inside:avoid}
.total p{font-size:10pt;color:#57534e}
.total b{font-size:16pt;font-weight:600;white-space:nowrap}
.pay{margin-top:1.5mm;break-inside:avoid;page-break-inside:avoid}
.pay p{display:flex;justify-content:space-between;font-size:10pt;font-weight:500;padding:0.6mm 0}
.pay span{font-weight:400;color:#78716c}
.sign{display:flex;gap:12mm;margin-top:11mm;font-size:9.5pt;color:#57534e;break-inside:avoid;page-break-inside:avoid}
.sign div{flex:1}
.sign p{min-height:4.5mm;margin-bottom:8mm}
.sign i{display:block;border-top:0.2mm solid #a8a29e;padding-top:1mm;font-style:normal;font-size:8pt;color:#78716c}
body.pack section+section{break-before:auto;page-break-before:auto}
body.pack section{position:relative;padding-bottom:3.5mm;margin-bottom:3.5mm;border-bottom:0.4mm dashed #78716c;break-inside:avoid;page-break-inside:avoid}
body.pack section::after{content:"✂";position:absolute;left:-1mm;bottom:-3.4mm;background:#fff;font-size:12pt;line-height:1;color:#78716c}
body.pack section:last-child{padding-bottom:0;margin-bottom:0;border-bottom:0}
body.pack section:last-child::after{content:none}
body.pack header{margin-bottom:2.2mm}
body.pack .brand{font-size:12pt}
body.pack .doc{margin-top:0.6mm}
body.pack .when{margin-top:0.3mm}
body.pack .to{padding:1.6mm 4mm 2mm;margin-bottom:2mm}
body.pack .to b{font-size:16pt;margin-top:0.2mm}
body.pack th,body.pack td{height:5.8mm;padding:0.3mm 2mm;line-height:1.15}
body.pack th:first-child,body.pack td:first-child{padding-left:0}
body.pack .total{margin-top:2mm}
body.pack .total b{font-size:13pt}
body.pack .pay{margin-top:0.8mm}
body.pack .pay p{padding:0.2mm 0}
body.pack .sign{margin-top:4mm}
body.pack .sign p{margin-bottom:4.5mm}
@media screen{body{padding:15mm;width:210mm;margin:0 auto}}
</style></head><body${pack ? ' class="pack"' : ""}>
${list.map(waybillHtml).join("\n")}
</body></html>`;
}

export function printWaybills(list: Waybill[], pack = false): void {
  if (list.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Браузер заблокировал окно печати — разрешите всплывающие окна для этого сайта");
    return;
  }
  win.document.write(waybillsPrintHtml(list, pack));
  win.document.close();
  printWhenReady(win);
}

// The recipient's face is a file: printing before it arrives would print the fallback serif. Waits for it
// (at most a couple of seconds — a slow line must not hold the printer back for good).
export function printWhenReady(win: Window): void {
  const go = () => {
    win.focus();
    win.print();
  };
  const fonts = win.document.fonts;
  if (!fonts) return go();
  Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 2500))]).then(go, go);
}
