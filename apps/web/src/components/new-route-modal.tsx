"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { DriverDto, LocationDto, ProductDto, VehicleDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

interface ItemRow {
  productId: string;
  quantity: string;
}

interface StopRow {
  destinationLocationId: string;
  items: ItemRow[];
}

export function NewRouteModal({
  originLocations,
  destinationLocations,
  vehicles,
  drivers,
  products,
  fixedOriginLocationId,
  onClose,
  onCreated,
}: {
  originLocations: LocationDto[];
  destinationLocations: LocationDto[];
  vehicles: VehicleDto[];
  drivers: DriverDto[];
  products: ProductDto[];
  fixedOriginLocationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [originLocationId, setOriginLocationId] = useState(
    fixedOriginLocationId ?? originLocations[0]?.id ?? "",
  );
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [stops, setStops] = useState<StopRow[]>([
    { destinationLocationId: destinationLocations[0]?.id ?? "", items: [{ productId: products[0]?.id ?? "", quantity: "1" }] },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateStop(index: number, patch: Partial<StopRow>) {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStop() {
    setStops((prev) => [
      ...prev,
      { destinationLocationId: destinationLocations[0]?.id ?? "", items: [{ productId: products[0]?.id ?? "", quantity: "1" }] },
    ]);
  }

  function removeStop(index: number) {
    setStops((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function updateItem(stopIndex: number, itemIndex: number, patch: Partial<ItemRow>) {
    setStops((prev) =>
      prev.map((s, i) =>
        i === stopIndex
          ? { ...s, items: s.items.map((it, j) => (j === itemIndex ? { ...it, ...patch } : it)) }
          : s,
      ),
    );
  }

  function addItem(stopIndex: number) {
    setStops((prev) =>
      prev.map((s, i) =>
        i === stopIndex ? { ...s, items: [...s.items, { productId: products[0]?.id ?? "", quantity: "1" }] } : s,
      ),
    );
  }

  function removeItem(stopIndex: number, itemIndex: number) {
    setStops((prev) =>
      prev.map((s, i) =>
        i === stopIndex && s.items.length > 1 ? { ...s, items: s.items.filter((_, j) => j !== itemIndex) } : s,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.logistics.createRoute({
        originLocationId: fixedOriginLocationId ?? originLocationId,
        vehicleId: vehicleId || undefined,
        driverId: driverId || undefined,
        stops: stops.map((s) => ({
          destinationLocationId: s.destinationLocationId,
          items: s.items.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать маршрут");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новый маршрут доставки" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 grid grid-cols-3 gap-3">
          {!fixedOriginLocationId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Откуда</label>
              <select
                value={originLocationId}
                onChange={(e) => setOriginLocationId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {originLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Транспорт</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Не выбран</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.plateNumber})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Водитель</label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Не выбран</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 space-y-3">
          {stops.map((stop, stopIndex) => (
            <div key={stopIndex} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Остановка {stopIndex + 1}
                </span>
                <select
                  value={stop.destinationLocationId}
                  onChange={(e) => updateStop(stopIndex, { destinationLocationId: e.target.value })}
                  className="flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {destinationLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeStop(stopIndex)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              <div className="space-y-1.5">
                {stop.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-center gap-2">
                    <select
                      value={item.productId}
                      onChange={(e) => updateItem(stopIndex, itemIndex, { productId: e.target.value })}
                      className="flex-1 rounded-xl border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
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
                      value={item.quantity}
                      onChange={(e) => updateItem(stopIndex, itemIndex, { quantity: e.target.value })}
                      className="w-20 rounded-xl border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(stopIndex, itemIndex)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addItem(stopIndex)}
                className="mt-1.5 flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Товар
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStop}
          className="mb-5 flex items-center gap-1.5 text-sm font-medium text-accent hover:opacity-80"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Добавить остановку
        </button>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Создание…" : "Создать маршрут"}
        </button>
      </form>
    </Modal>
  );
}
