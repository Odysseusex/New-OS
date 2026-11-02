"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import type { CustomerDto, LocationDto, ProductDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, PaymentMethod } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";
import { addDaysKey, zonedDateKey } from "@/lib/reporting-period";
import { formatMoney } from "@/lib/format";

interface Row {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, productId: "", quantity: "", unitPrice: "" });

export function NewSaleModal({
  locations,
  products,
  customers,
  fixedLocationId,
  onClose,
  onCreated,
}: {
  locations: LocationDto[];
  products: ProductDto[];
  customers: CustomerDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [customerId, setCustomerId] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // locations/products can still be loading when this modal is opened (e.g. a
  // quick click right after the page mounts), so the very first render may
  // have nothing to default to. Backfill once the lists actually arrive,
  // without touching a row the user has already interacted with.
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
  const unpaid = customerId ? total - Math.min(Number(amountPaid) || 0, total) : 0;
  const today = zonedDateKey();

  // A customer's deferral fills in the due date; it can still be changed.
  function pickCustomer(id: string) {
    setCustomerId(id);
    if (!id) setAmountPaid("");
    const term = customers.find((c) => c.id === id)?.paymentTermDays;
    setDueDate(id && term !== null && term !== undefined ? addDaysKey(zonedDateKey(), term) : "");
  }

  // There is always one empty line at the end: picking a product in it adds the next.
  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, emptyRow);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => trailing(prev.map((r, i) => (i === index ? { ...r, ...patch } : r))));
  }

  function removeRow(index: number) {
    setRows((prev) => trailing(prev.filter((_, i) => i !== index)));
  }

  function onProductChange(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateRow(index, { productId, unitPrice: String(product?.price ?? ""), quantity: rows[index]?.quantity || "1" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = rows.filter((r) => r.productId);
    if (lines.length === 0) {
      setError("Добавьте хотя бы один товар");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.sales.create({
        locationId: fixedLocationId ?? locationId,
        customerId: customerId || undefined,
        amountPaid: customerId ? Number(amountPaid) || 0 : undefined,
        paymentDueDate: customerId && unpaid > 0.004 && dueDate ? dueDate : undefined,
        paymentMethod,
        items: lines.map((r) => ({
          productId: r.productId,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести продажу");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новая продажа" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        {!fixedLocationId && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Источник <span className="text-muted">(откуда уходит товар)</span>
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-5 space-y-2">
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <ProductSelect
                products={products}
                value={row.productId}
                onChange={(productId) => onProductChange(index, productId)}
                className="min-w-0 flex-1"
                enterFlow
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                className="w-20 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Кол-во"
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.unitPrice}
                onChange={(e) => updateRow(index, { unitPrice: e.target.value })}
                className="w-28 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Цена"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Оплата</label>
          <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
            {/* MIXED is not a method anyone picks here: it describes a sale
                split across two tenders, which only the till can build (and
                which needs the split itself, not just the label). Offering it
                would produce a sale marked mixed with no breakdown behind
                it. */}
            {(Object.values(PaymentMethod) as PaymentMethod[])
              .filter((m) => m !== PaymentMethod.MIXED)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={clsx(
                    "flex-1 rounded-lg py-1.5 text-sm font-medium transition",
                    paymentMethod === m
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {PAYMENT_METHOD_LABELS_RU[m]}
                </button>
              ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Получатель <span className="text-muted">(необязательно — клиент для оптовой продажи в долг)</span>
          </label>
          <select
            value={customerId}
            onChange={(e) => pickCustomer(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Розничная продажа (без клиента)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {customerId && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Оплачено сейчас <span className="text-muted">(остальное — в долг)</span>
            </label>
            <input
              type="number"
              min="0"
              max={total}
              step="any"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        {customerId && unpaid > 0.004 && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Срок оплаты <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="date"
              min={today}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <div className="mb-5 flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
          <span className="text-sm text-muted">Итого</span>
          <span className="text-base font-semibold text-foreground">{formatMoney(total)}</span>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Проведение…" : "Провести продажу"}
          {!isSubmitting && <SubmitShortcutHint />}
        </button>
      </form>
    </Modal>
  );
}
