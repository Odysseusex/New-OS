"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import type { PromotionCouponDto, PromotionDto } from "@bakery-os/shared";
import { PROMOTION_COUPON_STATUS_LABELS_RU, PromotionCouponStatus } from "@bakery-os/shared";
import { Modal } from "./modal";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";

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

export function PromotionCouponsModal({ promotion, onClose }: { promotion: PromotionDto; onClose: () => void }) {
  const [coupons, setCoupons] = useState<PromotionCouponDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState("20");
  const [generating, setGenerating] = useState(false);
  // Just-generated codes, shown separately from the full list below so a
  // cashier printing the sheet does not have to pick them out of every
  // coupon the campaign has ever had.
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const load = useCallback(() => {
    api.promotions
      .coupons(promotion.id)
      .then(setCoupons)
      .catch(() => setError("Не удалось загрузить купоны"));
  }, [promotion.id]);

  useEffect(load, [load]);

  async function handleGenerate() {
    const n = Number(count);
    if (!n || n < 1 || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const { codes } = await api.promotions.generateCoupons(promotion.id, n);
      setFreshCodes(codes);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сгенерировать купоны");
    } finally {
      setGenerating(false);
    }
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
    if (!freshCodes) return;
    navigator.clipboard.writeText(freshCodes.join("\n")).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 2000);
    });
  }

  function downloadFreshCodes() {
    if (!freshCodes) return;
    download(`coupons-${promotion.name.replace(/\s+/g, "-")}.txt`, freshCodes.join("\n"), "text/plain");
  }

  return (
    <Modal title={`Купоны · ${promotion.name}`} onClose={onClose} width="max-w-2xl">
      <div className="mb-5 flex items-end gap-2 rounded-xl border border-border bg-surface-muted p-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted">Сколько купонов напечатать</label>
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {generating ? "…" : "Сгенерировать"}
        </button>
      </div>

      {freshCodes && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Новых кодов: {freshCodes.length}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={copyFreshCodes}
                className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                {copyFlash ? "Скопировано" : "Скопировать"}
              </button>
              <button
                onClick={downloadFreshCodes}
                className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Скачать .txt
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 font-mono text-sm text-foreground">
            {freshCodes.map((code) => (
              <span key={code} className="rounded-lg bg-surface px-2 py-1 text-center">
                {code}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Каждый код — один бумажный купон. Распечатайте или перепишите их и передайте на кассу Мерей.
          </p>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-border">
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
