"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocationDto, ProductDto } from "@bakery-os/shared";
import { LocationType, PRODUCT_MANAGE_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { formatMoney } from "@/lib/format";

// Every consignment product with its supplier and point of sale, and one button to tie them all to one point.
export function ConsignmentProductsCard() {
  const { user } = useAuth();
  const canManage = user ? PRODUCT_MANAGE_ROLES.includes(user.role) : false;

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [stores, setStores] = useState<LocationDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    Promise.all([api.products.list(), api.locations.list()])
      .then(([list, locations]) => {
        setProducts(list.filter((p) => p.consignmentSupplierId));
        setStores(locations.filter((l) => l.type === LocationType.STORE));
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  const rows = useMemo(
    () =>
      [...products].sort(
        (a, b) => (a.consignmentSupplierName ?? "").localeCompare(b.consignmentSupplierName ?? "", "ru") || a.name.localeCompare(b.name, "ru"),
      ),
    [products],
  );

  const apply = async () => {
    const name = target ? stores.find((s) => s.id === target)?.name : "все точки";
    if (!window.confirm(`Поставить точку продажи «${name}» всем товарам под реализацию (${rows.length})?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const { updated } = await api.products.setConsignmentLocationForAll(target || null);
      setMessage({ ok: true, text: updated === 0 ? "Уже стоит у всех" : `Готово: изменено товаров — ${updated}` });
      load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Не удалось сохранить" });
    } finally {
      setBusy(false);
    }
  };

  const exportRows = (kind: "xlsx" | "pdf") => {
    const run = () =>
      downloadTable(
        "товары-под-реализацию",
        ["Товар", "Артикул", "Поставщик", "Точка продажи", "Цена"],
        rows.map((p) => [p.name, p.sku ?? "", p.consignmentSupplierName ?? "", p.consignmentLocationName ?? "Все точки", p.price]),
        { sheetName: "Под реализацию" },
      );
    withExportTarget(kind, run);
  };

  if (state === "loading") return null;
  if (state === "error") return <p className="mb-4 text-sm text-red-700">Не удалось загрузить товары под реализацию</p>;
  if (rows.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <p className="text-sm font-semibold text-foreground">Товары под реализацию · {rows.length}</p>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <option value="">Все точки</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={apply}
                disabled={busy}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {busy ? "Сохранение…" : "Поставить всем"}
              </button>
            </>
          )}
          <button type="button" onClick={() => exportRows("xlsx")} className="rounded-lg border border-border px-3 py-2 text-sm">
            Excel
          </button>
          <button type="button" onClick={() => exportRows("pdf")} className="rounded-lg border border-border px-3 py-2 text-sm">
            PDF
          </button>
        </div>
      </div>
      {message && <p className={`px-4 py-3 text-sm ${message.ok ? "text-green-700" : "text-red-700"}`}>{message.text}</p>}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-surface-muted text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Товар</th>
              <th className="px-4 py-2 font-medium">Поставщик</th>
              <th className="px-4 py-2 font-medium">Точка продажи</th>
              <th className="px-4 py-2 text-right font-medium">Цена</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-foreground">
                  {p.name}
                  {p.sku && <span className="ml-2 text-xs text-muted">{p.sku}</span>}
                </td>
                <td className="px-4 py-2 text-muted">{p.consignmentSupplierName ?? "—"}</td>
                <td className="px-4 py-2">{p.consignmentLocationName ?? <span className="text-muted">Все точки</span>}</td>
                <td className="px-4 py-2 text-right">{formatMoney(p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
