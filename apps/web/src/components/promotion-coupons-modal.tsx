"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileText } from "lucide-react";
import type { PromotionCouponDto, PromotionDto } from "@bakery-os/shared";
import { PROMOTION_COUPON_STATUS_LABELS_RU, PromotionCouponStatus } from "@bakery-os/shared";
import { Modal } from "./modal";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CouponDensity } from "@/lib/pdf/coupons-pdf";

// Above this, a mistaken second click on "Сгенерировать" mints a lot of
// dead code — this is the line where the modal stops trusting the count
// input alone and asks for an explicit "yes, really".
const CONFIRM_THRESHOLD = 50;

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const STATUS_BADGE: Record<PromotionCouponStatus, string> = {
  [PromotionCouponStatus.ISSUED]: "bg-surface-muted text-muted",
  [PromotionCouponStatus.REDEEMED]: "bg-emerald-50 text-emerald-700",
  [PromotionCouponStatus.VOID]: "bg-red-50 text-red-700",
};

interface Batch {
  label: string | null;
  createdAt: string;
  codes: PromotionCouponDto[];
  issued: number;
  redeemed: number;
  void: number;
}

// Groups the flat coupon list by the generation call that minted each
// code (batchLabel). Coupons from before this field existed carry no
// label — grouped together under "Ранние купоны" rather than dropped.
function groupIntoBatches(coupons: PromotionCouponDto[]): Batch[] {
  const map = new Map<string, PromotionCouponDto[]>();
  for (const c of coupons) {
    const key = c.batchLabel ?? "__legacy__";
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .map(([label, codes]) => ({
      label: label === "__legacy__" ? null : label,
      createdAt: codes[0].createdAt,
      codes,
      issued: codes.filter((c) => c.status === PromotionCouponStatus.ISSUED).length,
      redeemed: codes.filter((c) => c.status === PromotionCouponStatus.REDEEMED).length,
      void: codes.filter((c) => c.status === PromotionCouponStatus.VOID).length,
    }))
    // Newest batch first — the one most likely to still need printing.
    .sort((a, b) => (a.label && b.label ? b.label.localeCompare(a.label) : 0));
}

export function PromotionCouponsModal({ promotion, onClose }: { promotion: PromotionDto; onClose: () => void }) {
  const [coupons, setCoupons] = useState<PromotionCouponDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState("20");
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Belt-and-suspenders against a double click racing ahead of React's own
  // re-render: `generating` alone is a state update, not synchronous, so
  // two clicks in the same tick could both read it as still false.
  const generatingRef = useRef(false);
  // Just-generated codes, shown separately from the batch list below so a
  // cashier printing the sheet does not have to pick them out of every
  // coupon the campaign has ever had.
  const [freshBatch, setFreshBatch] = useState<{ codes: string[]; batchLabel: string } | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  // Applies to whichever "Скачать PDF" button is pressed, batch list or
  // just-generated alike — one place to set it rather than a picker
  // repeated on every row.
  const [density, setDensity] = useState<CouponDensity>(8);
  const [includeBarcode, setIncludeBarcode] = useState(true);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.promotions
      .coupons(promotion.id)
      .then(setCoupons)
      .catch(() => setError("Не удалось загрузить купоны"));
  }, [promotion.id]);

  useEffect(load, [load]);

  const batches = useMemo(() => groupIntoBatches(coupons ?? []), [coupons]);
  const totalIssuedEver = coupons?.length ?? 0;

  async function doGenerate(n: number) {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setConfirming(false);
    setError(null);
    try {
      const { codes, batchLabel } = await api.promotions.generateCoupons(promotion.id, n);
      setFreshBatch({ codes, batchLabel });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сгенерировать купоны");
    } finally {
      setGenerating(false);
      generatingRef.current = false;
    }
  }

  function handleGenerateClick() {
    const n = Number(count);
    if (!n || n < 1 || generating) return;
    if (n >= CONFIRM_THRESHOLD && !confirming) {
      setConfirming(true);
      return;
    }
    doGenerate(n);
  }

  async function handleVoid(coupon: PromotionCouponDto) {
    if (!window.confirm(`Аннулировать купон «${coupon.code}»?`)) return;
    try {
      await api.promotions.voidCoupon(promotion.id, coupon.id);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось аннулировать купон");
    }
  }

  function copyFreshCodes() {
    if (!freshBatch) return;
    navigator.clipboard.writeText(freshBatch.codes.join("\n")).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 2000);
    });
  }

  function downloadTxt(codes: string[], label: string) {
    download(`Купоны — ${promotion.name} — ${label}.txt`, codes.join("\n"), "text/plain");
  }

  // Only ISSUED codes ever reach the PDF — a redeemed or voided code has no
  // business being printed again, whichever batch it came from. Re-checked
  // fresh against the server rather than trusting the list already on
  // screen: the modal can sit open for a while, and a code from an earlier
  // batch may have been redeemed at the till in the meantime — printing
  // has to see the truth as of right now, not as of the last load().
  async function downloadBatchPdf(batch: Batch, labelForFile: string) {
    setPdfBusy(labelForFile);
    setError(null);
    try {
      const currentlyIssued = await api.promotions.coupons(promotion.id, PromotionCouponStatus.ISSUED);
      const issued = currentlyIssued.filter((c) => c.batchLabel === batch.label);
      if (issued.length === 0) {
        setError("В этой партии нет купонов, которые ещё можно напечатать — все уже использованы или аннулированы");
        return;
      }
      const { downloadCouponsPdf } = await import("@/lib/pdf/coupons-pdf");
      await downloadCouponsPdf({
        promotion,
        codes: issued.map((c) => c.code),
        density,
        includeBarcode,
        batchSuffix: labelForFile,
      });
    } catch {
      setError("Не удалось собрать PDF");
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <Modal title={`Купоны · ${promotion.name}`} onClose={onClose} width="max-w-3xl">
      <div className="mb-4 rounded-xl border border-border bg-surface-muted p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted">Сколько купонов напечатать</label>
            <input
              type="number"
              min={1}
              max={5000}
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                setConfirming(false);
              }}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <button
            onClick={handleGenerateClick}
            disabled={generating}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {generating ? "…" : "Сгенерировать"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">Уже выдано за всё время: {totalIssuedEver}</p>

        {confirming && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="text-sm text-amber-900">
              Будет создано новых: <strong>{Number(count)}</strong>. Сейчас выдано: {totalIssuedEver}. Станет:{" "}
              {totalIssuedEver + Number(count)}.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => doGenerate(Number(count))}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:opacity-90"
              >
                Подтвердить
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-border px-3 py-2.5">
        <span className="text-xs font-medium text-muted">Настройки PDF:</span>
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          Купонов на лист
          <select
            value={density}
            onChange={(e) => setDensity(Number(e.target.value) as CouponDensity)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value={8}>8 (крупнее)</option>
            <option value={10}>10 (компактнее)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" checked={includeBarcode} onChange={(e) => setIncludeBarcode(e.target.checked)} />
          Штрихкод (для сканера на кассе)
        </label>
      </div>

      {freshBatch && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Новых кодов: {freshBatch.codes.length}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={copyFreshCodes}
                className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                {copyFlash ? "Скопировано" : "Скопировать"}
              </button>
              <button
                onClick={() => downloadTxt(freshBatch.codes, "новая партия")}
                className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                .txt
              </button>
            </div>
          </div>
          <div className="grid max-h-32 grid-cols-4 gap-1.5 overflow-y-auto font-mono text-sm text-foreground">
            {freshBatch.codes.slice(0, 40).map((code) => (
              <span key={code} className="rounded-lg bg-surface px-2 py-1 text-center">
                {code}
              </span>
            ))}
            {freshBatch.codes.length > 40 && (
              <span className="col-span-4 py-1 text-center text-xs text-muted">
                и ещё {freshBatch.codes.length - 40}…
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            Эта партия появится в списке ниже — оттуда можно скачать готовый PDF для печати.
          </p>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {batches.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Партии</h3>
          <div className="space-y-2">
            {batches.map((batch) => {
              const key = batch.label ?? "legacy";
              const displayLabel = batch.label ? `Партия от ${formatDateTime(batch.label)}` : "Ранние купоны";
              const fileSuffix = batch.label ? formatDateTime(batch.label).replace(/[.,:]/g, "-") : "ранние";
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {displayLabel} · {batch.codes.length} шт
                    </p>
                    <p className="text-xs text-muted">
                      активных: {batch.issued} · использовано: {batch.redeemed} · аннулировано: {batch.void}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => downloadTxt(batch.codes.map((c) => c.code), displayLabel)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
                    >
                      <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                      .txt
                    </button>
                    <button
                      onClick={() => downloadBatchPdf(batch, fileSuffix)}
                      disabled={pdfBusy === fileSuffix || batch.issued === 0}
                      title={batch.issued === 0 ? "В этой партии не осталось непогашенных купонов" : undefined}
                      className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {pdfBusy === fileSuffix ? "Готовим…" : `PDF (${batch.issued})`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="max-h-[35vh] overflow-y-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Код</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Погашение</th>
              <th className="px-3 py-2 font-medium">Скидка</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(coupons ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-foreground">{c.code}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>
                    {PROMOTION_COUPON_STATUS_LABELS_RU[c.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">
                  {c.status === PromotionCouponStatus.REDEEMED
                    ? `${formatDateTime(c.redeemedAt!)} · ${c.redeemedByName ?? ""} · ${c.redeemedLocationName ?? ""}`
                    : c.voidReason ?? "—"}
                </td>
                <td className="px-3 py-2 text-foreground">
                  {c.discountTotal != null ? formatMoney(c.discountTotal) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.status === PromotionCouponStatus.ISSUED && (
                    <button
                      onClick={() => handleVoid(c)}
                      className="text-xs font-medium text-muted transition hover:text-red-600"
                    >
                      Аннулировать
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {coupons && coupons.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  Купонов ещё нет — сгенерируйте первую пачку выше
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
