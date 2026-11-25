import type { Waybill } from "@/lib/waybill";
import { WAYBILL_DISPLAY_FACES, WAYBILL_DISPLAY_FAMILY, waybillMoney, waybillQty, waybillRecipientLabel, waybillSummary } from "@/lib/waybill";

// The накладная as a picture for a messenger: drawn straight on a canvas (no library, no outside
// service — a page turned into a picture through SVG does not survive Safari on an iPad), 1080 points
// wide at double sharpness, white, with nothing of the screen on it. The same look as the printed page.

const W = 1080;
const PAD = 72;
const FONT = `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INK = "#1c1917";
const MUTED = "#78716c";
const LINE = "#d6d0c8";
// A phone's browser refuses a canvas much larger than this many pixels.
const MAX_PIXELS = 16_000_000;

const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;
const display = (px: number) => `400 ${px}px "${WAYBILL_DISPLAY_FAMILY}", Georgia, serif`;
const SOFT = "#f6f1ea";

// The recipient's face, loaded once into the page before the first picture is drawn.
let faces: Promise<void> | null = null;
function loadDisplayFace(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return Promise.resolve();
  faces ??= Promise.all(
    WAYBILL_DISPLAY_FACES.map((f) => {
      const face = new FontFace(WAYBILL_DISPLAY_FAMILY, `url(${f.file}) format("woff2")`, { weight: "400", unicodeRange: f.range });
      document.fonts.add(face);
      return face.load();
    }),
  )
    .then(() => undefined)
    // Without the file the name is drawn in the fallback serif: still readable, never a failed picture.
    .catch(() => undefined);
  return faces;
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

// Columns: № | Товар | Кол-во | Ед. | Цена | Сумма (right edges for the numbers).
const COL = { qty: 150, unit: 84, price: 150, sum: 190 };
const INNER = W - PAD * 2;
const NAME_W = INNER - COL.qty - COL.unit - COL.price - COL.sum - 16;
const X = {
  name: PAD,
  qty: PAD + 16 + NAME_W + COL.qty - 12,
  unit: PAD + 16 + NAME_W + COL.qty + COL.unit / 2,
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
  ctx.font = font(26, 500);
  const fromLines = wrap(ctx, w.from, 400);
  text(w.brand, PAD, y + 36, font(34, 600));
  text(`Накладная № ${w.number}`, PAD, y + 80, font(26, 400));
  text(w.dateTime, PAD, y + 114, font(22), MUTED);
  text("Отгружено с", W - PAD, y + 28, font(20), MUTED, "right");
  fromLines.forEach((l, i) => text(l, W - PAD, y + 64 + i * 34, font(26, 500), INK, "right"));
  y += Math.max(126, 40 + fromLines.length * 34) + 34;

  // Recipient: the line the box is sorted by — Forum on a soft warm ground.
  ctx.font = display(54);
  const toLines = wrap(ctx, w.recipient, INNER - 72);
  const toHeight = 64 + toLines.length * 62 + 26;
  if (!dry) {
    ctx.fillStyle = SOFT;
    roundRect(ctx, PAD, y, INNER, toHeight, 20);
    ctx.fill();
  }
  text(waybillRecipientLabel(w), PAD + 36, y + 46, font(20), MUTED);
  toLines.forEach((l, i) => text(l, PAD + 36, y + 106 + i * 62, display(54), INK));
  y += toHeight + 34;

  // Table.
  const head = font(18, 500);
  text("ТОВАР", X.name, y + 34, head, MUTED);
  text("КОЛ-ВО", X.qty, y + 34, head, MUTED, "right");
  text("ЕД.", X.unit, y + 34, head, MUTED, "center");
  text("ЦЕНА", X.price, y + 34, head, MUTED, "right");
  text("СУММА", X.sum, y + 34, head, MUTED, "right");
  y += 52;
  const rule = (yy: number, color: string, width: number) => {
    if (dry) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(PAD + INNER, yy);
    ctx.stroke();
  };
  rule(y, "#a8a29e", 1);
  w.lines.forEach((l) => {
    ctx.font = font(27);
    const name = wrap(ctx, l.name, NAME_W);
    const h = Math.max(60, 24 + name.length * 35);
    const base = y + (h - name.length * 35) / 2 + 26;
    name.forEach((line, k) => text(line, X.name, base + k * 35, font(27)));
    text(waybillQty(l.quantity), X.qty, base, font(27), INK, "right");
    text(l.unit, X.unit, base, font(22), MUTED, "center");
    text(waybillMoney(l.price), X.price, base, font(27), "#57534e", "right");
    text(waybillMoney(l.sum), X.sum, base, font(27, 500), INK, "right");
    y += h;
    rule(y, LINE, 1);
  });

  // Totals.
  y += 18;
  ctx.font = font(24);
  const summary = wrap(ctx, waybillSummary(w), INNER - 360);
  summary.forEach((l, i) => text(l, PAD, y + 50 + i * 34, font(24), "#57534e"));
  text(`${waybillMoney(w.total)} ₸`, W - PAD, y + 56, font(40, 600), INK, "right");
  y += Math.max(80, 30 + summary.length * 34);
  if (w.paid !== null && w.debt !== null) {
    for (const [label, value] of [
      ["Оплачено", w.paid],
      ["Остаток долга", w.debt],
    ] as const) {
      text(label, PAD, y + 30, font(24), MUTED);
      text(`${waybillMoney(value)} ₸`, W - PAD, y + 30, font(26, 500), INK, "right");
      y += 42;
    }
  }

  // Signatures.
  y += 60;
  const half = (INNER - 60) / 2;
  const sign = (x: number, caption: string) => {
    ctx.font = font(23);
    text(wrap(ctx, caption, half)[0], x, y + 26, font(23), "#57534e");
    if (!dry) {
      ctx.strokeStyle = "#a8a29e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 100);
      ctx.lineTo(x + half, y + 100);
      ctx.stroke();
    }
    text("Подпись", x, y + 128, font(19), MUTED);
  };
  // Only the receiver signs (owner, 25.11.2026): no «Сдал», no baker's or cashier's name on the накладная.
  sign(PAD + half + 60, "Принял:");
  y += 138;

  return y + PAD;
}

export async function renderWaybillPng(w: Waybill): Promise<Blob> {
  await loadDisplayFace();
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
