"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProductDto, SaleDetailDto, SaleReturnDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, PaymentMethod, ProductType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { formatMoney } from "@/lib/format";

interface Row {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, productId: "", quantity: "", unitPrice: "" });
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
const inputClass =
  "rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// «Исправить чек»: a wrong check is never edited — the whole of what is left
// of it comes back as a return (money and goods, history kept), and the check
// as it should have been is rung as a new sale. One window, two documents:
// the return first, then the new check. If the new check fails, the return
// stands and the window offers to ring it again.
export function SaleCorrectionModal({
  sale,
  previousReturns,
  onClose,
  onDone,
}: {
  sale: SaleDetailDto;
  previousReturns: SaleReturnDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  // What is still on the check after earlier returns, per product.
  const remaining = useMemo(() => {
    const left = new Map<string, number>();
    for (const item of sale.items) left.set(item.productId, (left.get(item.productId) ?? 0) + item.quantity);
    for (const r of previousReturns) for (const item of r.items) left.set(item.productId, (left.get(item.productId) ?? 0) - item.quantity);
    return Array.from(left.entries()).filter(([, q]) => q > 0.0005).map(([productId, quantity]) => ({ productId, quantity: Math.round(quantity * 1000) / 1000 }));
  }, [sale.items, previousReturns]);

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [rows, setRows] = useState<Row[]>(() =>
    withTrailingRow(
      remaining.map((r) => ({
        key: nextKey++,
        productId: r.productId,
        quantity: String(r.quantity),
        unitPrice: String(sale.items.find((i) => i.productId === r.productId)?.unitPrice ?? ""),
      })),
      (r) => !r.productId,
      emptyRow,
    ),
  );
  const [method, setMethod] = useState<PaymentMethod>(sale.paymentMethod === PaymentMethod.MIXED ? PaymentMethod.CASH : sale.paymentMethod);
  const [amountPaid, setAmountPaid] = useState(sale.customerId ? String(sale.amountPaid) : "");
  const [reason, setReason] = useState("");
  const [returned, setReturned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onCheck = new Set(sale.items.map((i) => i.productId));
    api.products
      .list()
      .then((all) => setProducts(all.filter((p) => p.type === ProductType.FINISHED_GOOD || onCheck.has(p.id))))
      .catch(() => {});
  }, [sale.items]);

  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, emptyRow);
  const update = (key: number, patch: Partial<Row>) => setRows((prev) => trailing(prev.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  const lines = rows.filter((r) => r.productId);
  const invalid = lines.some((r) => !(num(r.quantity) > 0) || !Number.isFinite(num(r.unitPrice)) || num(r.unitPrice) < 0);
  const newTotal = lines.reduce((s, r) => s + (num(r.quantity) || 0) * (num(r.unitPrice) || 0), 0);
  const oldTotal = remaining.reduce((s, r) => s + r.quantity * (sale.items.find((i) => i.productId === r.productId)?.unitPrice ?? 0), 0);

  async function submit() {
    if (reason.trim().length < 3) {
      setError("Укажите причину исправления");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!returned) {
        await api.sales.returns.create(sale.id, {
          items: remaining.map((r) => ({ productId: r.productId, quantity: r.quantity })),
          reason: `Исправление чека: ${reason.trim()}`,
          restocked: true,
        });
        setReturned(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось оформить возврат по чеку");
      setSaving(false);
      return;
    }
    try {
      if (lines.length > 0) {
        await api.sales.create({
          locationId: sale.locationId,
          customerId: sale.customerId ?? undefined,
          amountPaid: sale.customerId ? Math.min(num(amountPaid) || 0, newTotal) : undefined,
          paymentMethod: method,
          loyaltyMemberId: sale.loyalty?.memberId,
          items: lines.map((r) => ({ productId: r.productId, quantity: num(r.quantity), unitPrice: num(r.unitPrice) })),
        });
      }
      onDone();
      onClose();
    } catch (err) {
      setError(`Возврат по старому чеку оформлен, а новый чек не пробит: ${err instanceof ApiError ? err.message : "ошибка"}`);
    } finally {
      setSaving(false);
    }
  }

  if (remaining.length === 0) {
    return (
      <Modal title="Исправить чек" onClose={onClose}>
        <p className="py-8 text-center text-sm text-muted">По этому чеку всё уже возвращено.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Исправить чек" onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Старый чек на {formatMoney(oldTotal)} будет возвращён целиком, вместо него пробьётся новый.
        </p>

        <div className="space-y-2">
          <div className="flex gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            <span className="flex-1">Товар</span>
            <span className="w-24">Кол-во</span>
            <span className="w-28">Цена</span>
            <span className="w-9" />
          </div>
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <ProductSelect
                products={products}
                value={row.productId}
                onChange={(productId) => {
                  const p = products.find((x) => x.id === productId);
                  update(row.key, { productId, unitPrice: row.unitPrice || String(p?.price ?? ""), quantity: row.quantity || "1" });
                }}
                className="min-w-0 flex-1"
                enterFlow
              />
              <input {...enterNext} inputMode="decimal" value={row.quantity} onChange={(e) => update(row.key, { quantity: e.target.value })} className={`w-24 ${inputClass}`} />
              <input {...enterNext} inputMode="decimal" value={row.unitPrice} onChange={(e) => update(row.key, { unitPrice: e.target.value })} className={`w-28 ${inputClass}`} />
              <button
                type="button"
                onClick={() => setRows((prev) => trailing(prev.filter((r) => r.key !== row.key)))}
                title="Убрать строку"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Оплата нового чека</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={`${inputClass} px-3`}>
              {Object.values(PaymentMethod)
                .filter((m) => m !== PaymentMethod.MIXED)
                .map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS_RU[m]}
                  </option>
                ))}
            </select>
          </div>
          {sale.customerId && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Оплачено сейчас</label>
              <input inputMode="decimal" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className={`w-32 ${inputClass}`} />
            </div>
          )}
          <div className="ml-auto text-right text-sm">
            <div className="text-muted">Новый чек</div>
            <div className="text-base font-semibold text-foreground">{formatMoney(Number.isFinite(newTotal) ? newTotal : 0)}</div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Причина исправления</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: пробили 2 круассана вместо 1"
            className={`w-full ${inputClass} px-3`}
          />
        </div>

        {lines.length === 0 && <p className="text-sm text-amber-700">Новый чек пустой — старый будет только возвращён.</p>}
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
            {returned ? "Закрыть" : "Отмена"}
          </button>
          <button
            data-submit=""
            onClick={submit}
            disabled={saving || invalid}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : returned ? "Пробить новый чек" : "Исправить чек"}
            {!saving && <SubmitShortcutHint />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
