"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { LocationDto, LocationPriceRowDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";

// Prices charged at ONE point of sale, next to the organization's default.
//
// The business sells wholesale at Product.price and runs one retail point
// inside a customer's supermarket that charges its own prices, so the screen
// is built for filling in a handful of exceptions against a full catalogue —
// not for retyping every price. A blank field means "charge the default", and
// clearing a field is how a point goes back to it.
//
// Saving is per row, on blur or Enter: the alternative (one big Save) risks
// losing a shift's worth of typing to a stray navigation, and there is no
// meaningful "cancel all" for a price list.
export function LocationPricesTab({
  locations,
  canManage,
}: {
  locations: LocationDto[];
  canManage: boolean;
}) {
  const [locationId, setLocationId] = useState("");
  const [rows, setRows] = useState<LocationPriceRowDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const load = useCallback(() => {
    if (!locationId) return;
    setState("loading");
    api.products
      .locationPrices(locationId)
      .then((data) => {
        setRows(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [locationId]);

  useEffect(load, [load]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      query
        ? rows.filter(
            (r) => r.productName.toLowerCase().includes(query) || r.sku.toLowerCase().includes(query),
          )
        : rows,
    [rows, query],
  );

  const ownPriceCount = rows.filter((r) => r.locationPrice !== null).length;

  async function save(productId: string, raw: string) {
    const trimmed = raw.trim();
    const row = rows.find((r) => r.productId === productId);
    if (!row) return;

    // Empty means "no own price here" — the point falls back to the default.
    const next = trimmed === "" ? null : Number(trimmed.replace(/\s/g, "").replace(",", "."));
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError(`Неверная цена для «${row.productName}»`);
      return;
    }
    if (next === row.locationPrice) return;

    setSavingId(productId);
    setError(null);
    try {
      if (next === null) {
        await api.products.clearLocationPrice(locationId, productId);
      } else {
        await api.products.setLocationPrice(locationId, productId, next);
      }
      setRows((current) =>
        current.map((r) => (r.productId === productId ? { ...r, locationPrice: next } : r)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить цену");
      // The field keeps whatever was typed; reloading puts the stored value
      // back so the screen never shows an unsaved price as if it were saved.
      load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск товара…"
          className="min-w-[200px] flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <span className="text-sm text-muted">Своя цена: {ownPriceCount} из {rows.length}</span>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="text-sm text-red-700">Не удалось загрузить цены</p>}

      {state === "ready" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Товар</th>
                <th className="px-4 py-3 font-medium">Категория</th>
                <th className="px-4 py-3 text-right font-medium">Базовая цена</th>
                <th className="px-4 py-3 text-right font-medium">Цена на точке</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <PriceRow
                  key={row.productId}
                  row={row}
                  canManage={canManage}
                  saving={savingId === row.productId}
                  onSave={(raw) => save(row.productId, raw)}
                />
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted">
                    {query ? "Ничего не найдено" : "Нет товаров для продажи"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        Пустое поле — на точке действует базовая цена. Изменение цены не затрагивает уже проведённые
        продажи.
      </p>
    </div>
  );
}

function PriceRow({
  row,
  canManage,
  saving,
  onSave,
}: {
  row: LocationPriceRowDto;
  canManage: boolean;
  saving: boolean;
  onSave: (raw: string) => void;
}) {
  const [value, setValue] = useState(row.locationPrice === null ? "" : String(row.locationPrice));

  // The row is the source of truth once a save lands (or a reload undoes one),
  // but typing must not be clobbered mid-edit — hence keying off the stored
  // value rather than syncing on every render.
  useEffect(() => {
    setValue(row.locationPrice === null ? "" : String(row.locationPrice));
  }, [row.locationPrice]);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5">
        <span className="font-medium text-foreground">{row.productName}</span>
        <span className="ml-2 text-xs text-muted">{row.sku}</span>
      </td>
      <td className="px-4 py-2.5 text-muted">{row.categoryName ?? "—"}</td>
      <td className="px-4 py-2.5 text-right text-muted">{formatMoney(row.basePrice)}</td>
      <td className="px-4 py-2.5 text-right">
        {canManage ? (
          <input
            type="text"
            inputMode="numeric"
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onSave(value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder={String(row.basePrice)}
            className={clsx(
              "w-32 rounded-lg border px-2 py-1.5 text-right text-sm outline-none transition",
              "border-border bg-surface text-foreground focus:border-accent focus:ring-2 focus:ring-accent/20",
              saving && "opacity-50",
            )}
          />
        ) : row.locationPrice === null ? (
          <span className="text-muted">{formatMoney(row.basePrice)}</span>
        ) : (
          <span className="font-medium text-foreground">{formatMoney(row.locationPrice)}</span>
        )}
      </td>
    </tr>
  );
}
