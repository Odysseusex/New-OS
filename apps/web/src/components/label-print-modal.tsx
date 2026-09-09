"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
import type { ProductDto, RecipeDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { Modal } from "@/components/modal";

// Physical label stock, in millimetres. A thermal label printer is a normal
// Windows printer, so printing is the browser's ordinary print — but the page
// has to be told the exact size of the sticker or the printer either crops it
// or feeds a blank one. Hence @page size below, per chosen stock.
//
// Type sizes and the barcode's height are per stock rather than one set of
// numbers scaled down.
//
// The two dates are stacked on every size, not laid side by side on the wider
// ones: «Изгот.: 08.09.2026» and «Годен до: 11.09.2026» together overrun even
// 58 mm, and the sticker clips rather than wraps — so the best-before date,
// the whole reason the label exists, was losing its last characters.
//
// 30 × 20 mm is deliberately absent. A name, two dates and a scannable Code
// 128 of an SKU do not fit on it — the barcode comes out under the width a
// scanner can read, so offering it would only print stickers that fail at the
// till.
const LABEL_SIZES = [
  { id: "58x40", label: "58 × 40 мм", widthMm: 58, heightMm: 40, nameMm: 3, textMm: 2.6, barcodeMm: 14 },
  { id: "58x30", label: "58 × 30 мм", widthMm: 58, heightMm: 30, nameMm: 2.8, textMm: 2.4, barcodeMm: 10 },
  { id: "40x30", label: "40 × 30 мм", widthMm: 40, heightMm: 30, nameMm: 2.6, textMm: 2.2, barcodeMm: 10 },
] as const;

type LabelSize = (typeof LABEL_SIZES)[number];

// Where the last shelf life printed for a product is remembered, per browser.
// Not a product field: a shelf life that belongs to the product belongs on its
// technical card, where production and the labels both read it. This is only
// so the same number is not retyped at every print run on this machine.
const SHELF_LIFE_KEY = "aramir.labelShelfLife.";

function todayIso(): string {
  const now = new Date();
  const offsetMinutes = now.getTimezoneOffset();
  return new Date(now.getTime() - offsetMinutes * 60000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string | null {
  const parsed = Date.parse(`${iso}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed + days * 86400000).toISOString().slice(0, 10);
}

function formatRu(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Code 128 — what every cheap thermal printer and USB scanner handles, and
// unlike EAN-13 it takes letters, so a generated SKU like PRD-000123 goes on
// the label as-is instead of needing a made-up numeric code.
function Barcode({ value, heightMm }: { value: string; heightMm: number }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width: 1.6,
        height: 40,
        displayValue: true,
        fontSize: 12,
        margin: 0,
        // Black on white regardless of theme: the scanner reads contrast, not
        // brand colours, and the label is printed on white stock anyway.
        lineColor: "#000000",
        background: "#ffffff",
      });
      // JsBarcode sizes the SVG in pixels, which has nothing to do with a
      // sticker measured in millimetres — left alone it overflows a narrow
      // label and gets cropped, which is what an unscannable barcode looks
      // like. It does emit a viewBox, so clearing the pixel width/height and
      // letting CSS set the box makes it fill the label exactly.
      // preserveAspectRatio="none" is safe here: every bar is stretched by the
      // same factor, and a scanner reads the ratios between bars, not their
      // absolute width.
      ref.current.removeAttribute("width");
      ref.current.removeAttribute("height");
      ref.current.setAttribute("preserveAspectRatio", "none");
    } catch {
      // A value Code 128 cannot encode leaves the barcode blank rather than
      // taking the whole dialog down; the text on the label still prints.
    }
  }, [value]);

  return <svg ref={ref} style={{ display: "block", width: "100%", height: `${heightMm}mm` }} />;
}

// One sticker's contents. Shared between the on-screen preview and the sheet
// that actually prints, so what the person sees before pressing print is the
// same markup that reaches the printer rather than an approximation of it.
function LabelBody({
  name,
  madeOn,
  bestBefore,
  barcodeValue,
  size,
}: {
  name: string;
  madeOn: string;
  bestBefore: string | null;
  barcodeValue: string;
  size: LabelSize;
}) {
  return (
    <>
      {/* Two lines at most: a long name pushing the dates and the barcode off
          a small sticker would silently lose the two things the label exists
          for. */}
      <div
        style={{
          fontSize: `${size.nameMm}mm`,
          fontWeight: 700,
          lineHeight: 1.15,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5mm",
          fontSize: `${size.textMm}mm`,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        <span>Изгот.: {formatRu(madeOn)}</span>
        {bestBefore && <span style={{ fontWeight: 700 }}>Годен до: {formatRu(bestBefore)}</span>}
      </div>
      <Barcode value={barcodeValue} heightMm={size.barcodeMm} />
    </>
  );
}

// Labels for own production — the case this exists for is a cake that has to
// carry a date and a code the till can scan back.
//
// The barcode is the product's own barcode when it has one (bought-in goods
// do), and its SKU otherwise, which is what own production always has. The
// till resolves a scan against both, so a label printed here rings the
// product up without anything else being set first.
export function LabelPrintModal({
  product,
  onClose,
}: {
  product: ProductDto;
  onClose: () => void;
}) {
  const [madeOn, setMadeOn] = useState(todayIso());
  // Seeded from what was last printed for this product, so a shelf life typed
  // by hand is typed once rather than at every print run. Read lazily inside
  // useState rather than in an effect: an effect would briefly render an empty
  // field, and the person would start typing into a box about to be
  // overwritten. localStorage throws in some privacy modes, hence the guard.
  const [shelfLifeDays, setShelfLifeDays] = useState(() => {
    try {
      return localStorage.getItem(`${SHELF_LIFE_KEY}${product.id}`) ?? "";
    } catch {
      return "";
    }
  });
  const [copies, setCopies] = useState("1");
  const [sizeId, setSizeId] = useState<LabelSize["id"]>("58x40");
  const [recipeChecked, setRecipeChecked] = useState(false);
  // The label sheet is portalled onto <body> so that printing can hide every
  // other top-level element and leave only the stickers. Rendered in place it
  // sat deep inside the page, with the whole app — sidebar, table, this very
  // dialog — as its ancestors, and no amount of hiding siblings could stop
  // those from reaching the printer. Portals need the DOM, so it waits for
  // the client rather than rendering during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The shelf life may also live on the product's technical card. It only
  // fills an empty field: what was typed here last is more specific than the
  // card, and arrives first, so the card must not overwrite it — nor anything
  // the person has already started typing while this request was in flight.
  useEffect(() => {
    let cancelled = false;
    api.recipes
      .list()
      .then((recipes: RecipeDto[]) => {
        if (cancelled) return;
        const own = recipes.find((r) => r.productId === product.id);
        if (own?.shelfLifeDays != null) {
          setShelfLifeDays((current) => (current.trim() ? current : String(own.shelfLifeDays)));
        }
        setRecipeChecked(true);
      })
      .catch(() => {
        if (!cancelled) setRecipeChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0];
  const days = Number(shelfLifeDays);
  const bestBefore = shelfLifeDays.trim() && Number.isFinite(days) ? addDays(madeOn, days) : null;
  const barcodeValue = (product.barcode ?? "").trim() || product.sku;
  const count = Math.max(1, Math.min(200, Number(copies) || 1));

  const labels = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);

  return (
    <>
      <Modal title="Печать этикеток" onClose={onClose} width="max-w-md">
        {/* The sticker at its real size, so a roll is not spent finding out
            that the name was cut off or the dates were wrong. */}
        <div className="mb-4 flex justify-center rounded-xl bg-surface-muted px-4 py-4">
          <div
            style={{
              width: `${size.widthMm}mm`,
              height: `${size.heightMm}mm`,
              boxSizing: "border-box",
              padding: "1.5mm 2mm",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              color: "#000",
              background: "#fff",
              overflow: "hidden",
            }}
            className="rounded-md shadow-sm ring-1 ring-border"
          >
            <LabelBody
              name={product.name}
              madeOn={madeOn}
              bestBefore={bestBefore}
              barcodeValue={barcodeValue}
              size={size}
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Дата изготовления</label>
            <input
              type="date"
              value={madeOn}
              onChange={(e) => setMadeOn(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Срок годности, дней</label>
            <input
              type="number"
              min={0}
              value={shelfLifeDays}
              onChange={(e) => setShelfLifeDays(e.target.value)}
              placeholder={recipeChecked ? "Не задан" : "…"}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div className="mb-4 flex items-baseline justify-between rounded-xl border border-border px-4 py-3">
          <span className="text-sm text-muted">Годен до</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{formatRu(bestBefore)}</span>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Сколько этикеток</label>
            <input
              type="number"
              min={1}
              max={200}
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Размер этикетки</label>
            <select
              value={sizeId}
              onChange={(e) => setSizeId(e.target.value as LabelSize["id"])}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!bestBefore && (
          <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Срок годности не задан — на этикетке не будет строки «Годен до».
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            // Remembered on print, not on every keystroke: what was actually
            // printed is the number worth offering again next time.
            try {
              const key = `${SHELF_LIFE_KEY}${product.id}`;
              if (shelfLifeDays.trim()) localStorage.setItem(key, shelfLifeDays.trim());
              else localStorage.removeItem(key);
            } catch {
              // Storage blocked — the label still prints, it just will not be
              // prefilled next time.
            }
            window.print();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-90"
        >
          <Printer className="h-4 w-4" strokeWidth={1.75} />
          Напечатать {count} шт
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-muted"
        >
          Закрыть
        </button>
      </Modal>

      {/* Print-only, and portalled onto <body> on purpose: everything else at
          the top level is hidden when printing, so this sheet is all that
          reaches the printer. One label per page, because a label printer
          feeds one sticker at a time. */}
      {mounted &&
        createPortal(
          <div className="aramir-label-sheet hidden print:block">
            <style>{`
          @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }
          @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
            body > *:not(.aramir-label-sheet) { display: none !important; }
            .aramir-label {
              width: ${size.widthMm}mm;
              height: ${size.heightMm}mm;
              box-sizing: border-box;
              padding: 1.5mm 2mm;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              color: #000;
              background: #fff;
              overflow: hidden;
              break-after: page;
              page-break-after: always;
            }
            .aramir-label:last-child { break-after: auto; page-break-after: auto; }
          }
        `}</style>
            {labels.map((i) => (
              <div key={i} className="aramir-label">
                <LabelBody
                  name={product.name}
                  madeOn={madeOn}
                  bestBefore={bestBefore}
                  barcodeValue={barcodeValue}
                  size={size}
                />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Pick a product, then print its labels. This exists for the till: the label
// printer is plugged into the monoblock, and the monoblock is the till, so
// whoever prints a sticker is standing at the till screen — not in Склад on
// another machine. Printing changes nothing (no money, no stock, no request
// that writes), so it needs no role of its own.
//
// A tap list rather than the dropdown ProductSelect offers, because this one
// is used with a finger on a touch screen.
export function LabelPrintPicker({
  products,
  onClose,
}: {
  products: ProductDto[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProductDto | null>(null);

  // Same in-memory substring match as every other search in the app: the
  // catalogue is already loaded, so there is no request and no debounce.
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedQuery) ||
          p.sku.toLowerCase().includes(normalizedQuery),
      )
    : products;

  if (picked) return <LabelPrintModal product={picked} onClose={onClose} />;

  return (
    <Modal title="Печать этикеток" onClose={onClose} width="max-w-lg">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по названию или артикулу…"
        className="mb-3 w-full rounded-xl border border-border bg-surface px-4 py-3 text-base text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

      <div className="max-h-[26rem] space-y-1.5 overflow-y-auto">
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPicked(p)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left transition hover:border-accent hover:bg-surface-muted"
          >
            <span className="text-base font-medium text-foreground">{p.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted">
              {(p.barcode ?? "").trim() || p.sku}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted">Ничего не найдено</p>
        )}
      </div>
    </Modal>
  );
}
