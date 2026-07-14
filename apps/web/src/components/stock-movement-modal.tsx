"use client";

import { useEffect, useState } from "react";
import type { LocationDto, ProductDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU, WRITE_OFF_REASON_LABELS_RU, WriteOffReason } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function StockMovementModal({
  mode,
  locations,
  products,
  fixedLocationId,
  onClose,
  onCreated,
}: {
  mode: "receive" | "write-off";
  locations: LocationDto[];
  products: ProductDto[];
  fixedLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [writeOffReason, setWriteOffReason] = useState<WriteOffReason>(WriteOffReason.OTHER);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isReceive = mode === "receive";

  // locations/products can still be loading when this modal opens, so the
  // first render may have nothing to default to. Backfill once they arrive.
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(fixedLocationId ?? locations[0].id);
    }
  }, [locations, locationId, fixedLocationId]);

  useEffect(() => {
    if (!productId && products.length > 0) setProductId(products[0].id);
  }, [products, productId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const dto = {
        locationId: fixedLocationId ?? locationId,
        productId,
        quantity: Number(quantity),
        reason: reason || undefined,
      };
      if (isReceive) {
        await api.inventory.receive(dto);
      } else {
        await api.inventory.writeOff({ ...dto, writeOffReason });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить операцию");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={isReceive ? "Приёмка товара" : "Списание товара"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!fixedLocationId && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
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

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Товар</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({UNIT_LABELS_RU[p.unit]})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Количество</label>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {!isReceive && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Причина списания</label>
            <select
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value as WriteOffReason)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(WriteOffReason).map((r) => (
                <option key={r} value={r}>
                  {WRITE_OFF_REASON_LABELS_RU[r]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {isReceive ? "Комментарий" : "Комментарий"} <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isReceive ? "Поступление от поставщика" : "Подробности, номер акта…"}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : isReceive ? "Оприходовать" : "Списать"}
        </button>
      </form>
    </Modal>
  );
}
