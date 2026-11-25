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
  issuedBy: string;
}

export const WAYBILL_BRAND = "Ar-Amir";

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
    issuedBy: note.createdByName,
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
    issuedBy: sale.createdByName,
  };
}

// ── the printed page ──

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function waybillHtml(w: Waybill): string {
  const rows = w.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="n">${waybillQty(l.quantity)}</td><td class="c">${esc(l.unit)}</td><td class="n">${waybillMoney(l.price)}</td><td class="n b">${waybillMoney(l.sum)}</td></tr>`,
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
<colgroup><col style="width:11mm"><col><col style="width:22mm"><col style="width:13mm"><col style="width:24mm"><col style="width:30mm"></colgroup>
<thead><tr><th class="c">№</th><th>Товар</th><th class="n">Кол-во</th><th class="c">Ед.</th><th class="n">Цена</th><th class="n">Сумма</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="total"><p>${esc(waybillSummary(w))}</p><b>${waybillMoney(w.total)} ₸</b></div>
${money}
<div class="sign"><div><p>Сдал: ${esc(w.issuedBy)}</p><i>Подпись</i></div><div><p>Принял:</p><i>Подпись</i></div></div>
</section>`;
}

// Lays the накладные out on sheets before printing: measured on the screen at the printed width (the body is
// exactly 180 mm wide there), one that does not fit the rest of the sheet starts the next sheet; one taller
// than a whole sheet runs over. A cut line goes under every накладная that has another below it on the sheet.
const PACK_SCRIPT = `(function(){function place(){
var probe=document.createElement("div");probe.style.height="100mm";document.body.appendChild(probe);
var mm=probe.getBoundingClientRect().height/100;probe.remove();
var PAGE=267*mm-2,GAP=9*mm,used=0,prev=null,list=document.querySelectorAll("section");
for(var i=0;i<list.length;i++){var s=list[i];
s.className="";var h=s.getBoundingClientRect().height;
if(prev){var free=PAGE-used-GAP;
if(h<=free||(h>PAGE&&free>PAGE*0.35)){prev.className+=" cut";used+=GAP+h;}
else{s.className+=" newpage";used=h;}}else{used=h;}
while(used>PAGE)used-=PAGE;prev=s;}
if(prev)prev.className+=" last";}
place();window.addEventListener("beforeprint",place);})();`;

// `pack`: several накладные on one sheet with a cut line between them (as many as fit whole — two of the
// usual length), to save paper; otherwise one per sheet.
export function waybillsPrintHtml(list: Waybill[], pack = false): string {
  const title = list.length === 1 ? `Накладная № ${list[0].number}` : "Накладные";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
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
.to{border-top:0.2mm solid #d6d0c8;border-bottom:0.2mm solid #d6d0c8;padding:3.2mm 0 3.6mm;margin-bottom:4mm;break-inside:avoid;page-break-inside:avoid}
.to b{display:block;font-size:16pt;font-weight:600;line-height:1.2;margin-top:0.8mm}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{padding:0.8mm 2mm;height:7.6mm;vertical-align:middle;overflow-wrap:anywhere;border-bottom:0.2mm solid #d6d0c8}
th{text-align:left;font-size:7.5pt;font-weight:500;color:#78716c;text-transform:uppercase;letter-spacing:0.06em;border-bottom:0.2mm solid #a8a29e}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
.n{text-align:right;white-space:nowrap}
.c{text-align:center;white-space:nowrap;padding:0 1mm}
td.c{color:#78716c;font-size:9.5pt}
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
body.pack section{position:relative;padding-bottom:4.5mm;margin-bottom:4.5mm}
body.pack section.cut{border-bottom:0.4mm dashed #78716c}
body.pack section.cut::after{content:"✂";position:absolute;left:-1mm;bottom:-3.4mm;background:#fff;font-size:12pt;line-height:1;color:#78716c}
body.pack section.newpage{break-before:page;page-break-before:always}
body.pack section.last{padding-bottom:0;margin-bottom:0}
body.pack header{margin-bottom:3.5mm}
body.pack .to{padding:2.2mm 0 2.6mm;margin-bottom:2.5mm}
body.pack .to b{font-size:14pt}
body.pack th,body.pack td{height:6.2mm;padding:0.4mm 2mm;line-height:1.15}
body.pack .total{margin-top:2.5mm}
body.pack .total b{font-size:14pt}
body.pack .sign{margin-top:6mm}
body.pack .sign p{margin-bottom:6mm}
@media screen{body{padding:15mm;width:210mm;margin:0 auto}}
</style></head><body${pack ? ' class="pack"' : ""}>
${list.map(waybillHtml).join("\n")}
${pack ? `<script>${PACK_SCRIPT}</script>` : ""}
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
  win.focus();
  win.print();
}
