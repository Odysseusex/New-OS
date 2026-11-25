import type { Waybill } from "@/lib/waybill";
import { waybillMoney, waybillQty, waybillRecipientLabel, waybillSummary } from "@/lib/waybill";

// The накладная as a picture for a messenger: drawn straight on a canvas (no library, no outside
// service — a page turned into a picture through SVG does not survive Safari on an iPad), 1080 points
// wide at double sharpness, white, with nothing of the screen on it. The same look as the printed page.

const W = 1080;
const PAD = 56;
const FONT = `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INK = "#1c1917";
const MUTED = "#78716c";
const SOFT = "#f3efe9";
const LINE = "#d6d0c8";
// A phone's browser refuses a canvas much larger than this many pixels.
const MAX_PIXELS = 16_000_000;

const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;

// Words wrapped to a width; a single word wider than the line is cut by letters.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (ctx.measureText(line).width > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Columns: № | Товар | Кол-во | Ед. | Цена | Сумма (right edges for the numbers).
const COL = { num: 64, qty: 150, unit: 84, price: 150, sum: 190 };
const INNER = W - PAD * 2;
const NAME_W = INNER - COL.num - COL.qty - COL.unit - COL.price - COL.sum - 16;
const X = {
  num: PAD + COL.num / 2,
  name: PAD + COL.num + 8,
  qty: PAD + COL.num + 16 + NAME_W + COL.qty - 12,
  unit: PAD + COL.num + 16 + NAME_W + COL.qty + COL.unit / 2,
  price: PAD + INNER - COL.sum - 12,
  sum: PAD + INNER - 12,
};

// Draws the накладная; with `ctx` only measuring (dry) it returns the height it needs.
function draw(ctx: CanvasRenderingContext2D, w: Waybill, dry: boolean): number {
  const text = (s: string, x: number, y: number, f: string, color = INK, align: CanvasTextAlign = "left") => {
    if (dry) return;
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  let y = PAD;

  // Header: who we are and the document on the left, where it left from on the right.
  ctx.font = font(30, 700);
  const fromLines = wrap(ctx, w.from, 400);
  text(w.brand, PAD, y + 44, font(46, 700));
  text(`Накладная № ${w.number}`, PAD, y + 96, font(34, 600));
  text(w.dateTime, PAD, y + 136, font(26), MUTED);
  text("Отгружено с", W - PAD, y + 30, font(24), MUTED, "right");
  fromLines.forEach((l, i) => text(l, W - PAD, y + 70 + i * 38, font(30, 700), INK, "right"));
  y += Math.max(150, 46 + fromLines.length * 38) + 30;

  // Recipient, large: the box is sorted by this line.
  ctx.font = font(54, 700);
  const toLines = wrap(ctx, w.recipient, INNER - 64);
  const toHeight = 62 + toLines.length * 64 + 18;
  if (!dry) {
    ctx.fillStyle = SOFT;
    roundRect(ctx, PAD, y, INNER, toHeight, 22);
    ctx.fill();
  }
  text(waybillRecipientLabel(w), PAD + 32, y + 44, font(24), MUTED);
  toLines.forEach((l, i) => text(l, PAD + 32, y + 108 + i * 64, font(54, 700)));
  y += toHeight + 34;

  // Table.
  if (!dry) {
    ctx.fillStyle = SOFT;
    ctx.fillRect(PAD, y, INNER, 58);
  }
  const head = font(21, 600);
  text("№", X.num, y + 37, head, "#57534e", "center");
  text("ТОВАР", X.name, y + 37, head, "#57534e");
  text("КОЛ-ВО", X.qty, y + 37, head, "#57534e", "right");
  text("ЕД.", X.unit, y + 37, head, "#57534e", "center");
  text("ЦЕНА", X.price, y + 37, head, "#57534e", "right");
  text("СУММА", X.sum, y + 37, head, "#57534e", "right");
  y += 58;
  const rule = (yy: number, color: string, width: number) => {
    if (dry) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(PAD + INNER, yy);
    ctx.stroke();
  };
  rule(y, "#a8a29e", 2);
  w.lines.forEach((l, i) => {
    ctx.font = font(30);
    const name = wrap(ctx, l.name, NAME_W);
    const h = Math.max(66, 26 + name.length * 38);
    const base = y + (h - name.length * 38) / 2 + 29;
    text(String(i + 1), X.num, base, font(26), MUTED, "center");
    name.forEach((line, k) => text(line, X.name, base + k * 38, font(30)));
    text(waybillQty(l.quantity), X.qty, base, font(30), INK, "right");
    text(l.unit, X.unit, base, font(26), MUTED, "center");
    text(waybillMoney(l.price), X.price, base, font(30), INK, "right");
    text(waybillMoney(l.sum), X.sum, base, font(30, 600), INK, "right");
    y += h;
    rule(y, LINE, 1.5);
  });

  // Totals.
  y += 26;
  rule(y, INK, 3);
  ctx.font = font(30, 600);
  const summary = wrap(ctx, waybillSummary(w), INNER - 380);
  summary.forEach((l, i) => text(l, PAD, y + 56 + i * 40, font(30, 600)));
  text(`${waybillMoney(w.total)} ₸`, W - PAD, y + 66, font(52, 700), INK, "right");
  y += Math.max(92, 30 + summary.length * 40);
  if (w.paid !== null && w.debt !== null) {
    for (const [label, value] of [
      ["Оплачено", w.paid],
      ["Остаток долга", w.debt],
    ] as const) {
      text(label, PAD, y + 34, font(30), "#57534e");
      text(`${waybillMoney(value)} ₸`, W - PAD, y + 34, font(32, 600), INK, "right");
      y += 50;
    }
  }

  // Signatures.
  y += 60;
  const half = (INNER - 60) / 2;
  const sign = (x: number, caption: string) => {
    ctx.font = font(28);
    text(wrap(ctx, caption, half)[0], x, y + 28, font(28));
    if (!dry) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 108);
      ctx.lineTo(x + half, y + 108);
      ctx.stroke();
    }
    text("Подпись", x, y + 138, font(22), MUTED);
  };
  sign(PAD, `Сдал: ${w.issuedBy}`);
  sign(PAD + half + 60, "Принял:");
  y += 150;

  return y + PAD;
}

export async function renderWaybillPng(w: Waybill): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не умеет рисовать картинку");
  const height = Math.ceil(draw(ctx, w, true));
  // Double sharpness, less only for a накладная so long that the browser would refuse the canvas.
  const scale = Math.min(2, Math.sqrt(MAX_PIXELS / (W * height)));
  canvas.width = Math.floor(W * scale);
  canvas.height = Math.floor(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);
  draw(ctx, w, false);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Не удалось сделать картинку"))), "image/png"));
}

// «Накладная 12 Мерей.png» — a name the person finds among their files.
export const waybillFileName = (w: Waybill) =>
  `Накладная ${w.number} ${w.recipient}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) + ".png";
