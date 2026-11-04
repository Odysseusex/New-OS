"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { LocationDto, ProductDto, StockLevelDto } from "@bakery-os/shared";
import { STOCK_BATCH_MAX_LINES, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";
import { formatQuantity } from "@/lib/format";
import { enterNext, withTrailingRow } from "@/lib/keyboard";
import { SubmitShortcutHint } from "@/components/submit-shortcut-hint";

interface Row {
  key: number;
  productId: string;
  quantity: string;
}

let nextKey = 1;
const newRow = (): Row => ({ key: nextKey++, productId: "", quantity: "" });
const field =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// Склад → «Перемещение»: goods from one own point to another in one document,
// at their cost (a move changes no value). Written at once, all lines or none.
export function StockTransferModal({
  locations,
  products,
  stockLevels,
  fixedLocationId,
  onClose,
  onCreated,
}: {
  locations: LocationDto[];
  products: ProductDto[];
  stockLevels: StockLevelDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: (number: number) => void;
}) {
  const active = locations.filter((l) => l.isActive !== false);
  const [fromId, setFromId] = useState(fixedLocationId ?? "");
  const [toId, setToId] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The list of points may still be loading when this opens.
  useEffect(() => {
    if (active.length === 0) return;
    if (!fromId) setFromId(active[0].id);
    if (!toId) setToId((active.find((l) => l.id !== (fromId || active[0].id)) ?? active[0]).id);
  }, [active, fromId, toId]);

  const levelAt = (locationId: string, productId: string) =>
    stockLevels.find((s) => s.locationId === locationId && s.productId === productId)?.quantity ?? 0;
  const trailing = (list: Row[]) => withTrailingRow(list, (r) => !r.productId, () => newRow(), STOCK_BATCH_MAX_LINES);
  const update = (key: number, patch: Partial<Row>) => setRows((prev) => trailing(prev.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  const available = products.filter((p) => levelAt(fromId, p.id) > 0);
  const filled = rows.filter((r) => r.productId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fromId === toId) return setError("Откуда и куда — разные точки");
    if (filled.length === 0) return setError("Добавьте хотя бы один товар");
    const ids = filled.map((r) => r.productId);
    if (new Set(ids).size !== ids.length) return setError("Один и тот же товар указан дважды — объедините строки");
    const lines = filled.map((r) => ({ productId: r.productId, quantity: Number(r.quantity.replace(",", ".")) }));
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) return setError("Количество должно быть больше нуля в каждой строке");
    setBusy(true);
    try {
      const t = await api.inventory.transfer({ fromLocationId: fromId, toLocationId: toId, note: note.trim() || undefined, lines });
      onCreated(t.number);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести перемещение");
      setBusy(false);
    }
  }

  return (
    <Modal title="Перемещение между точками" onClose={onClose} width="max-w-2xl">
      <form onSubmit={submit}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Откуда</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={`${field} w-full`}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Куда</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={`${field} w-full`}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-2 flex items-end gap-2 text-sm font-medium text-foreground">
          <span className="flex-1">Товар</span>
          <span className="w-32">Количество</span>
          <span className="w-8" />
        </div>
        <div className="mb-5 space-y-2">
          {rows.map((row) => {
            const product = products.find((p) => p.id === row.productId);
            const q = Number(row.quantity.replace(",", "."));
            const have = row.productId ? levelAt(fromId, row.productId) : 0;
            return (
              <div key={row.key}>
                <div className="flex items-center gap-2">
                  <ProductSelect products={available} value={row.productId} onChange={(productId) => update(row.key, { productId })} className="min-w-0 flex-1" enterFlow />
                  <input
                    {...enterNext}
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => update(row.key, { quantity: e.target.value })}
                    placeholder={product ? UNIT_LABELS_RU[product.unit] : ""}
                    className={`${field} w-32`}
                  />
                  <button
                    type="button"
                    onClick={() => setRows((prev) => trailing(prev.filter((r) => r.key !== row.key)))}
                    title="Убрать строку"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
                {product && (
                  <p className={`mt-1 text-xs ${Number.isFinite(q) && q > have ? "text-red-600" : "text-muted"}`}>
                    Есть в точке «откуда»: {formatQuantity(have)} {UNIT_LABELS_RU[product.unit]}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <label className="mb-5 block text-sm">
          <span className="mb-1.5 block font-medium text-foreground">
            Комментарий <span className="text-muted">(необязательно)</span>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={`${field} w-full`} />
        </label>

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Проводим…" : filled.length > 1 ? `Переместить (${filled.length})` : "Переместить"}
          {!busy && <SubmitShortcutHint />}
        </button>
      </form>
    </Modal>
  );
}
