"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import type { CustomerDto, LocationDto, ProductDto } from "@bakery-os/shared";
import { PAYMENT_METHOD_LABELS_RU, PaymentMethod, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney } from "@/lib/format";

interface Row {
  productId: string;
  quantity: string;
  unitPrice: string;
}

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
  const [rows, setRows] = useState<Row[]>([{ productId: "", quantity: "1", unitPrice: "" }]);
  const [customerId, setCustomerId] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
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

  useEffect(() => {
    if (products.length === 0) return;
    setRows((prev) =>
      prev.map((r) => (r.productId ? r : { ...r, productId: products[0].id, unitPrice: String(products[0].price) })),
    );
  }, [products]);

  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { productId: products[0]?.id ?? "", quantity: "1", unitPrice: String(products[0]?.price ?? "") }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function onProductChange(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateRow(index, { productId, unitPrice: String(product?.price ?? "") });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.sales.create({
        locationId: fixedLocationId ?? locationId,
        customerId: customerId || undefined,
        amountPaid: customerId ? Number(amountPaid) || 0 : undefined,
        paymentMethod,
        items: rows.map((r) => ({
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

        <div className="mb-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={row.productId}
                onChange={(e) => onProductChange(index, e.target.value)}
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({UNIT_LABELS_RU[p.unit]})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                className="w-20 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Кол-во"
              />
              <input
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

        <button
          type="button"
          onClick={addRow}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить товар
        </button>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Оплата</label>
          <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
            {(Object.values(PaymentMethod) as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={clsx(
                  "flex-1 rounded-lg py-1.5 text-sm font-medium transition",
                  paymentMethod === m ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
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
            onChange={(e) => {
              setCustomerId(e.target.value);
              if (!e.target.value) setAmountPaid("");
            }}
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
        </button>
      </form>
    </Modal>
  );
}
