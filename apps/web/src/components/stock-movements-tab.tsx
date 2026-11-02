"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import type { LocationDto, ProductDto, StockMovementDto } from "@bakery-os/shared";
import { STOCK_MOVEMENT_TYPE_LABELS_RU, STOCK_MOVEMENTS_MAX, StockMovementType, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney, formatMoneyPrecise, formatQuantity } from "@/lib/format";
import { addDaysKey, firstOfMonthKey, startOfZonedDay, zonedDateKey } from "@/lib/reporting-period";

type Period = "today" | "7d" | "30d" | "month" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
  all: "Всё время",
};

function periodFrom(period: Period): string | undefined {
  const today = zonedDateKey();
  if (period === "all") return undefined;
  const key = period === "today" ? today : period === "7d" ? addDaysKey(today, -6) : period === "30d" ? addDaysKey(today, -29) : firstOfMonthKey(today);
  return startOfZonedDay(key).toISOString();
}

// Movements that put stock on the shelf; the rest take it off (an adjustment
// carries its own sign).
const INBOUND = new Set<StockMovementType>([
  StockMovementType.RECEIPT,
  StockMovementType.SALE_RETURN,
  StockMovementType.PRODUCTION_OUTPUT,
  StockMovementType.TRANSFER_IN,
]);

function signedQuantity(m: StockMovementDto): number {
  if (m.type === StockMovementType.ADJUSTMENT) return m.quantity;
  return INBOUND.has(m.type) ? m.quantity : -m.quantity;
}

export type MovementProductFilter = { id: string; name: string };

export function StockMovementsTab({
  locations,
  isOrgWide,
  products,
  initialLocationId,
  product,
  onProductChange,
}: {
  locations: LocationDto[];
  isOrgWide: boolean;
  products: ProductDto[];
  initialLocationId: string;
  product: MovementProductFilter | null;
  onProductChange: (product: MovementProductFilter | null) => void;
}) {
  const [period, setPeriod] = useState<Period>("7d");
  const [locationId, setLocationId] = useState(initialLocationId);
  const [type, setType] = useState<StockMovementType | "">("");
  const [search, setSearch] = useState("");
  const [movements, setMovements] = useState<StockMovementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocationId(initialLocationId), [initialLocationId]);

  useEffect(() => {
    let cancelled = false;
    setMovements(null);
    setError(null);
    api.inventory
      .movements({
        locationId: locationId || undefined,
        productId: product?.id,
        type: type || undefined,
        from: periodFrom(period),
        // «Всё время» without a product still needs a bound to get more than the
        // latest 50: from the very beginning.
        ...(period === "all" && !product ? { from: new Date(0).toISOString() } : {}),
      })
      .then((rows) => !cancelled && setMovements(rows))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить историю движений"));
    return () => {
      cancelled = true;
    };
  }, [locationId, product, type, period]);

  const skuByProductId = useMemo(() => new Map(products.map((p) => [p.id, (p.sku ?? "").toLowerCase()])), [products]);
  const query = search.trim().toLowerCase();
  const visible = (movements ?? []).filter(
    (m) => !query || m.productName.toLowerCase().includes(query) || (skuByProductId.get(m.productId) ?? "").includes(query),
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                period === p ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as StockMovementType | "")}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Все типы</option>
          {Object.values(StockMovementType).map((t) => (
            <option key={t} value={t}>
              {STOCK_MOVEMENT_TYPE_LABELS_RU[t]}
            </option>
          ))}
        </select>
        {isOrgWide && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Все точки</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}
        {product ? (
          <span className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 py-1.5 pl-3 pr-1.5 text-sm font-medium text-foreground">
            {product.name}
            <button
              onClick={() => onProductChange(null)}
              aria-label="Все товары"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </span>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или артикулу…"
              className="w-64 rounded-xl border border-border bg-surface py-2 pl-9 pr-9 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {movements && movements.length >= STOCK_MOVEMENTS_MAX && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Показаны последние {STOCK_MOVEMENTS_MAX} движений — выберите период короче или товар
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Товар</th>
              {isOrgWide && <th className="px-4 py-3 font-medium">Точка</th>}
              <th className="px-4 py-3 font-medium">Тип</th>
              <th className="px-4 py-3 text-right font-medium">Кол-во</th>
              <th className="px-4 py-3 text-right font-medium">Себестоимость ед.</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
              <th className="px-4 py-3 text-right font-medium">Цена продажи</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((m) => {
              const signed = signedQuantity(m);
              return (
                <tr key={m.id} className={m.voided ? "opacity-60" : undefined}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-3">
                    {product ? (
                      <span className="font-medium text-foreground">{m.productName}</span>
                    ) : (
                      <button
                        onClick={() => onProductChange({ id: m.productId, name: m.productName })}
                        className="text-left font-medium text-foreground hover:text-accent hover:underline"
                      >
                        {m.productName}
                      </button>
                    )}
                  </td>
                  {isOrgWide && <td className="px-4 py-3 text-muted">{m.locationName}</td>}
                  <td className="px-4 py-3 text-muted">
                    <div>
                      {STOCK_MOVEMENT_TYPE_LABELS_RU[m.type]}
                      {m.voided && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">аннулировано</span>}
                    </div>
                    {m.reason && m.reason !== STOCK_MOVEMENT_TYPE_LABELS_RU[m.type] && <div className="text-xs">{m.reason}</div>}
                  </td>
                  <td
                    className={clsx(
                      "whitespace-nowrap px-4 py-3 text-right font-medium",
                      signed > 0 ? "text-green-600" : signed < 0 ? "text-red-600" : "text-foreground",
                    )}
                  >
                    {signed > 0 ? "+" : signed < 0 ? "−" : ""}
                    {formatQuantity(Math.abs(signed))} {UNIT_LABELS_RU[m.unit]}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {m.unitCost == null ? "—" : formatMoneyPrecise(m.unitCost)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-foreground">
                    {m.costAmount == null ? "—" : formatMoney(m.costAmount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-foreground">
                    {m.salePrice == null ? "—" : formatMoneyPrecise(m.salePrice)}
                  </td>
                </tr>
              );
            })}
            {movements === null && !error && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
                  Загрузка…
                </td>
              </tr>
            )}
            {movements !== null && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
                  {query ? `Ничего не найдено по запросу «${search.trim()}»` : "Движений за этот период нет"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
