"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CashAccountDto, LocationDto, ProductDto, SupplierDto } from "@bakery-os/shared";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { formatMoney } from "@/lib/format";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";

interface Row {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  // A line total typed by hand (from the supplier's invoice); the price follows from it.
  sum?: string;
}

let nextKey = 1;
// Price from a typed line total: sum ÷ quantity, to the тиын (the order stores prices to 2 decimals).
function priceFromSum(sum: string | undefined, quantity: string): Partial<Row> {
  if (sum === undefined || sum.trim() === "") return {};
  const q = Number(quantity);
  if (!(q > 0)) return {};
  return { unitCost: String(Math.round((Number(sum) / q) * 100) / 100) };
}

const emptyRow = (): Row => ({ key: nextKey++, productId: "", quantity: "", unitCost: "" });

export function NewPurchaseOrderModal({
  suppliers,
  locations,
  products,
  fixedLocationId,
  canPayNow = false,
  onClose,
  onCreated,
}: {
  // The purchasing cutover is on and this user may pay suppliers («Оплачено сразу»).
  canPayNow?: boolean;
  suppliers: SupplierDto[];
  locations: LocationDto[];
  products: ProductDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [note, setNote] = useState("");
  // «Товар привезли»: the usual case — the order is created and received in one step (the same two
  // documents as ever: an order and its receipt). «Заказать»: only the order, received later.
  const [arrived, setArrived] = useState(true);
  // An order already created by a first try whose receipt failed: a retry only receives it.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [payNow, setPayNow] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  useEffect(() => {
    if (!canPayNow) return;
    api.finance.accounts
      .list()
      .then((list) => {
        setAccounts(list);
        setAccountId((cur) => cur || (list.find((a) => a.isDefault) ?? list[0])?.id || "");
      })
      .catch(() => {});
  }, [canPayNow]);

  // suppliers/locations/products can still be loading when this modal opens,
  // so the first render may have nothing to default to. Backfill once the
  // lists arrive, without touching a row the user already edited.
  useEffect(() => {
    if (!supplierId && suppliers.length > 0) setSupplierId(suppliers[0].id);
  }, [suppliers, supplierId]);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  // A semi-finished product is never bought (the server refuses it too).
  const purchasable = products.filter((p) => p.type !== "SEMI_FINISHED");
  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0);

  // There is always one empty line at the end: picking a product in it adds the next.
  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, emptyRow);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => trailing(prev.map((r, i) => (i === index ? { ...r, ...patch } : r))));
  }

  function pickProduct(index: number, productId: string) {
    // The last purchase price on the card, to change when it costs more or less now.
    const product = products.find((p) => p.id === productId);
    updateRow(index, { productId, unitCost: product ? String(product.price) : "", sum: undefined });
  }

  function removeRow(index: number) {
    setRows((prev) => trailing(prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = rows.filter((r) => r.productId);
    if (lines.length === 0) {
      setError("Добавьте хотя бы один товар");
      return;
    }
    if (lines.some((r) => r.quantity.trim() === "" || !(Number(r.quantity) > 0))) {
      setError("Укажите количество в каждой строке");
      return;
    }
    setIsSubmitting(true);
    let created: { id: string } | null = createdId ? { id: createdId } : null;
    try {
      created ??= await api.procurement.createOrder({
        supplierId,
        locationId: fixedLocationId ?? locationId,
        supplierDocNumber: docNumber.trim() || undefined,
        note: note.trim() || undefined,
        items: lines.map((r) => ({
          productId: r.productId,
          quantity: Number(r.quantity),
          unitCost: Number(r.unitCost),
        })),
      });
      if (arrived) {
        await api.procurement.receiveOrder(created.id, {
          items: [],
          payNow: canPayNow && payNow && accountId ? { accountId } : undefined,
        });
      }
      onCreated();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : arrived ? "Не удалось оприходовать" : "Не удалось создать заказ";
      // The order exists but was not received: say so, it can be received from the list.
      setError(created ? `Заказ создан, но не оприходован: ${message}` : message);
      if (created) setCreatedId(created.id);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (suppliers.length === 0) {
    return (
      <Modal title="Новый заказ поставщику" onClose={onClose}>
        <p className="text-sm text-muted">
          Сначала добавьте поставщика на вкладке «Поставщики».
        </p>
      </Modal>
    );
  }

  return (
    <Modal title={arrived ? "Приход от поставщика" : "Новый заказ поставщику"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 flex rounded-xl bg-surface-muted p-0.5">
          {[
            { v: true, label: "Товар привезли" },
            { v: false, label: "Заказать на будущее" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setArrived(o.v)}
              className={clsx("flex-1 rounded-lg px-3 py-2 text-sm", arrived === o.v ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted")}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Поставщик</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {!fixedLocationId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Точка доставки
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
        </div>

        <div className="mb-5 space-y-2">
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <ProductSelect
                products={purchasable}
                value={row.productId}
                onChange={(productId) => pickProduct(index, productId)}
                className="min-w-0 flex-1"
                enterFlow
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value, ...priceFromSum(row.sum, e.target.value) })}
                className="w-20 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Кол-во"
              />
              <input
                {...enterNext}
                type="number"
                min="0"
                step="any"
                value={row.unitCost}
                onChange={(e) => updateRow(index, { unitCost: e.target.value, sum: undefined })}
                className="w-28 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Цена"
              />
              <input
                type="number"
                min="0"
                step="any"
                title="Сумма строки: цена посчитается сама"
                value={row.sum ?? (Number(row.quantity) > 0 && row.unitCost !== "" ? String(Math.round(Number(row.quantity) * Number(row.unitCost) * 100) / 100) : "")}
                onChange={(e) => updateRow(index, { sum: e.target.value, ...priceFromSum(e.target.value, row.quantity) })}
                className="w-28 rounded-xl border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Сумма"
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

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              № документа поставщика <span className="text-muted">(необязательно)</span>
            </span>
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              Комментарий <span className="text-muted">(необязательно)</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
        </div>

        {arrived && canPayNow && (
          <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-accent" />
              <span className="text-foreground">Оплачено сразу</span>
            </label>
            {payNow && (
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
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
          {isSubmitting ? "Сохраняем…" : arrived ? "Оприходовать" : "Создать заказ"}
          {!isSubmitting && <SubmitShortcutHint />}
        </button>
      </form>
    </Modal>
  );
}
