"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Plus, Printer, Tags, X } from "lucide-react";
import type { CustomerDto, LocationDto, ProductDto, StandingOrderLineDto } from "@bakery-os/shared";
import { INVENTORY_MANAGE_ROLES, LocationType, PaymentMethod, ProductType, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";
import { printSheets } from "@/lib/print-table";
import type { XlsxSheet } from "@/lib/xlsx";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";

type Column = { key: string; kind: "location" | "customer"; id: string; name: string };
type Result = { status: "ok" | "error"; message: string; sheet?: XlsxSheet };

const colKey = (kind: Column["kind"], id: string) => `${kind}:${id}`;
const parse = (s: string | undefined) => {
  const n = Number((s ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};

// Производство → «Распределение»: the day's output shared out from one workshop in one grid — rows are
// products, columns are points (a transfer each) and wholesale customers (a sale on account each, i.e. the
// накладная). Columns open prefilled from each one's «постоянный заказ»; «Провести» makes every document
// through the ordinary endpoints, one by one, and prints them all.
export function DistributionTab({ locations }: { locations: LocationDto[] }) {
  const { user } = useAuth();
  const canManage = user ? INVENTORY_MANAGE_ROLES.includes(user.role) : false;

  const [sourceId, setSourceId] = useState("");
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [standing, setStanding] = useState<StandingOrderLineDto[]>([]);
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map());
  const [columns, setColumns] = useState<Column[]>([]);
  const [extraRows, setExtraRows] = useState<string[]>([]);
  // colKey → productId → typed quantity
  const [cells, setCells] = useState<Record<string, Record<string, string>>>({});
  // customerId → productId → agreed price
  const [prices, setPrices] = useState<Record<string, Record<string, number>>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [pricing, setPricing] = useState<Column | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const active = locations.filter((l) => l.isActive !== false);
  const workshops = active.filter((l) => l.type === LocationType.BAKERY_PRODUCTION);
  useEffect(() => {
    if (!sourceId && (workshops[0] ?? active[0])) setSourceId((workshops[0] ?? active[0]).id);
  }, [sourceId, workshops, active]);

  useEffect(() => {
    Promise.all([api.products.list(), api.customers.list(), api.distribution.standingOrders()])
      .then(([p, c, s]) => {
        setProducts(p.filter((x) => x.isActive && x.type === ProductType.FINISHED_GOOD && x.trackInventory && !x.consignmentSupplierId));
        setCustomers(c.filter((x) => x.isActive));
        setStanding(s);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const loadStock = useCallback(() => {
    if (!sourceId) return;
    api.inventory
      .stockLevels(sourceId)
      .then((levels) => setOnHand(new Map(levels.filter((l) => l.locationId === sourceId).map((l) => [l.productId, l.quantity]))))
      .catch(() => setOnHand(new Map()));
  }, [sourceId]);
  useEffect(loadStock, [loadStock]);

  // Default columns: every shop except the source, and every customer with a standing order.
  const fillFromStanding = useCallback(() => {
    const stores = active.filter((l) => l.type === LocationType.STORE && l.id !== sourceId);
    const withOrder = new Set(standing.filter((s) => s.customerId && s.quantity > 0).map((s) => s.customerId!));
    const cols: Column[] = [
      ...stores.map((l) => ({ key: colKey("location", l.id), kind: "location" as const, id: l.id, name: l.name })),
      ...customers.filter((c) => withOrder.has(c.id)).map((c) => ({ key: colKey("customer", c.id), kind: "customer" as const, id: c.id, name: c.name })),
    ];
    const nextCells: Record<string, Record<string, string>> = {};
    const nextPrices: Record<string, Record<string, number>> = {};
    for (const s of standing) {
      const key = s.customerId ? colKey("customer", s.customerId) : colKey("location", s.locationId!);
      if (s.quantity > 0) (nextCells[key] ??= {})[s.productId] = String(s.quantity);
      if (s.customerId && s.unitPrice !== null) (nextPrices[s.customerId] ??= {})[s.productId] = s.unitPrice;
    }
    setColumns(cols);
    setCells(nextCells);
    setPrices(nextPrices);
    setResults({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing, customers, sourceId, locations]);
  // Filled when the data arrives and when the source changes — never behind the operator's back
  // (saving standing orders must not wipe what was typed or the results of a posting).
  const fillRef = useRef(fillFromStanding);
  fillRef.current = fillFromStanding;
  useEffect(() => {
    if (state === "ready" && sourceId) fillRef.current();
  }, [state, sourceId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = useMemo(() => {
    const ids = new Set<string>(extraRows);
    for (const [id, q] of Array.from(onHand)) if (q > 0 && productById.has(id)) ids.add(id);
    for (const c of columns) for (const [id, v] of Object.entries(cells[c.key] ?? {})) if (parse(v) > 0) ids.add(id);
    return Array.from(ids).filter((id) => productById.has(id)).sort((a, b) => productById.get(a)!.name.localeCompare(productById.get(b)!.name, "ru"));
  }, [onHand, columns, cells, extraRows, productById]);

  const qty = (c: Column, productId: string) => parse(cells[c.key]?.[productId]);
  const priceOf = (customerId: string, productId: string) => prices[customerId]?.[productId] ?? productById.get(productId)?.price ?? 0;
  const pending = columns.filter((c) => results[c.key]?.status !== "ok");
  const rowTotal = (productId: string) => pending.reduce((s, c) => s + qty(c, productId), 0);
  const columnLines = (c: Column) => rows.filter((id) => qty(c, id) > 0);

  const setCell = (c: Column, productId: string, value: string) =>
    setCells((cur) => ({ ...cur, [c.key]: { ...(cur[c.key] ?? {}), [productId]: value } }));

  async function saveStanding() {
    setBusy(true);
    setNotice(null);
    try {
      for (const c of columns) {
        const ids = new Set([...rows, ...(c.kind === "customer" ? Object.keys(prices[c.id] ?? {}) : [])]);
        const lines = Array.from(ids)
          .map((productId) => ({
            productId,
            quantity: qty(c, productId),
            unitPrice: c.kind === "customer" && prices[c.id]?.[productId] !== undefined ? prices[c.id][productId] : undefined,
          }))
          .filter((l) => l.quantity > 0 || l.unitPrice !== undefined);
        await api.distribution.saveStandingOrder(c.kind === "customer" ? { customerId: c.id, lines } : { locationId: c.id, lines });
      }
      setStanding(await api.distribution.standingOrders());
      setNotice({ ok: true, text: "Постоянные заказы сохранены — завтра таблица откроется с этими цифрами" });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : "Не удалось сохранить постоянные заказы" });
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    const todo = pending.filter((c) => columnLines(c).length > 0);
    if (todo.length === 0) {
      setNotice({ ok: false, text: "Нечего проводить: все количества пустые" });
      return;
    }
    const over = rows.filter((id) => rowTotal(id) > (onHand.get(id) ?? 0) + 1e-9);
    const transfers = todo.filter((c) => c.kind === "location").length;
    const sales = todo.length - transfers;
    const warning = over.length > 0 ? `\n\nРаздаётся больше, чем на складе: ${over.map((id) => productById.get(id)!.name).join(", ")}.` : "";
    if (!window.confirm(`Провести распределение?\nПеремещений: ${transfers}, накладных оптовикам: ${sales}.${warning}`)) return;
    const source = locations.find((l) => l.id === sourceId)?.name ?? "";
    const date = new Date().toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
    setBusy(true);
    setNotice(null);
    for (const c of todo) {
      const ids = columnLines(c);
      try {
        if (c.kind === "location") {
          const doc = await api.inventory.transfer({
            fromLocationId: sourceId,
            toLocationId: c.id,
            note: "Распределение выпуска",
            lines: ids.map((productId) => ({ productId, quantity: qty(c, productId) })),
          });
          setResults((r) => ({
            ...r,
            [c.key]: {
              status: "ok",
              message: `Перемещение № ${doc.number}`,
              sheet: {
                name: `Перемещение ${doc.number}`,
                titleLines: [`Перемещение № ${doc.number} от ${date}`, `${source} → ${c.name}`],
                headers: ["Товар", "Количество", "Ед."],
                rows: doc.lines.map((l) => [l.productName, l.quantity, UNIT_LABELS_RU[l.unit]]),
              },
            },
          }));
        } else {
          const sale = await api.sales.create({
            locationId: sourceId,
            customerId: c.id,
            amountPaid: 0,
            paymentMethod: PaymentMethod.CASH,
            items: ids.map((productId) => ({ productId, quantity: qty(c, productId), unitPrice: priceOf(c.id, productId) })),
          });
          setResults((r) => ({
            ...r,
            [c.key]: {
              status: "ok",
              message: `Накладная (чек № ${sale.number ?? "—"}) на ${formatMoney(sale.totalAmount)}`,
              sheet: {
                name: `Накладная ${sale.number ?? ""}`,
                titleLines: [`Накладная № ${sale.number ?? "—"} от ${date}`, `Поставщик: ${source}`, `Покупатель: ${c.name}`],
                headers: ["Товар", "Количество", "Ед.", "Цена", "Сумма"],
                rows: [
                  ...sale.items.map((i) => [i.productName, i.quantity, UNIT_LABELS_RU[productById.get(i.productId)?.unit ?? "PCS"], { v: i.unitPrice, fmt: "money" as const }, { v: i.subtotal, fmt: "money" as const }]),
                  ["Итого", "", "", "", { v: sale.totalAmount, fmt: "money" as const, bold: true }],
                ],
              },
            },
          }));
        }
      } catch (err) {
        setResults((r) => ({ ...r, [c.key]: { status: "error", message: err instanceof ApiError ? err.message : "Не удалось провести" } }));
      }
    }
    setBusy(false);
    loadStock();
  }

  const done = columns.map((c) => results[c.key]).filter((r): r is Result => r?.status === "ok" && !!r.sheet);
  const failed = columns.filter((c) => results[c.key]?.status === "error");
  const addable = [
    ...active.filter((l) => l.id !== sourceId && !columns.some((c) => c.key === colKey("location", l.id))).map((l) => ({ value: colKey("location", l.id), label: `Точка: ${l.name}` })),
    ...customers.filter((x) => !columns.some((c) => c.key === colKey("customer", x.id))).map((x) => ({ value: colKey("customer", x.id), label: `Оптовик: ${x.name}` })),
  ];

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error") return <p className="text-sm text-red-700">Не удалось загрузить данные для распределения</p>;

  const input =
    "w-20 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-muted";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">Откуда</label>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        >
          {active.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {addable.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":") as [Column["kind"], string];
              const name = kind === "location" ? locations.find((l) => l.id === id)?.name : customers.find((x) => x.id === id)?.name;
              if (name) setColumns((cur) => [...cur, { key: e.target.value, kind, id, name }]);
            }}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="">+ Добавить точку или оптовика</option>
            {addable.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={fillFromStanding}
            disabled={busy}
            className="rounded-xl border border-border px-3.5 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            Заполнить по постоянным заказам
          </button>
          {canManage && (
            <button
              type="button"
              onClick={saveStanding}
              disabled={busy || columns.length === 0}
              className="rounded-xl border border-border px-3.5 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50"
            >
              Сохранить как постоянный заказ
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={post}
              disabled={busy || !sourceId}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Проводим…" : "Провести распределение"}
            </button>
          )}
        </div>
      </div>

      {notice && <div className={clsx("mb-4 rounded-xl px-4 py-3 text-sm", notice.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>{notice.text}</div>}
      {failed.length > 0 && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          Не проведено: {failed.map((c) => `${c.name} — ${results[c.key].message}`).join("; ")}. Исправьте и нажмите «Провести» ещё раз — уже проведённые
          столбцы не повторятся.
        </div>
      )}
      {done.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
          <span>Проведено документов: {done.length}</span>
          <button
            type="button"
            onClick={() => printSheets(done.map((r) => r.sheet!))}
            className="flex items-center gap-1.5 rounded-lg border border-green-700 px-3 py-1.5 font-medium hover:bg-green-100"
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Печать всех документов
          </button>
          <button type="button" onClick={fillFromStanding} className="font-medium underline">
            Новое распределение
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs text-muted">
              <th className="sticky left-0 z-10 min-w-[180px] bg-surface-muted px-3 py-2 font-medium">Товар</th>
              <th className="px-3 py-2 text-right font-medium">На складе</th>
              {columns.map((c) => {
                const r = results[c.key];
                return (
                  <th key={c.key} className="min-w-[110px] px-2 py-2 text-right align-top font-medium">
                    <div className="flex items-start justify-end gap-1">
                      <span className={clsx("text-foreground", c.kind === "customer" && "italic")}>{c.name}</span>
                      {r?.status === "ok" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" strokeWidth={2} />
                      ) : (
                        <button type="button" title="Убрать столбец" onClick={() => setColumns((cur) => cur.filter((x) => x.key !== c.key))} className="text-muted hover:text-red-600">
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 font-normal">
                      {c.kind === "customer" ? "оптовик" : "точка"}
                      {c.kind === "customer" && r?.status !== "ok" && (
                        <button type="button" onClick={() => setPricing(c)} className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                          <Tags className="h-3 w-3" strokeWidth={2} />
                          цены
                        </button>
                      )}
                    </div>
                    {r?.status === "ok" && <div className="mt-0.5 font-normal text-green-700">{r.message}</div>}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-right font-medium">Итого</th>
              <th className="px-3 py-2 text-right font-medium">Останется</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((productId) => {
              const p = productById.get(productId)!;
              const have = onHand.get(productId) ?? 0;
              const total = rowTotal(productId);
              const left = Math.round((have - total) * 1000) / 1000;
              return (
                <tr key={productId}>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-foreground">
                    {p.name} <span className="text-xs text-muted">{UNIT_LABELS_RU[p.unit]}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">{formatQuantity(have)}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 text-right">
                      <input
                        inputMode="decimal"
                        value={cells[c.key]?.[productId] ?? ""}
                        onChange={(e) => setCell(c, productId, e.target.value)}
                        disabled={results[c.key]?.status === "ok"}
                        aria-label={`${p.name} → ${c.name}`}
                        className={input}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium text-foreground">{total > 0 ? formatQuantity(total) : "—"}</td>
                  <td className={clsx("px-3 py-1.5 text-right", left < 0 ? "font-medium text-red-700" : "text-muted")}>{formatQuantity(left)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 4} className="px-3 py-8 text-center text-sm text-muted">
                  На этой точке нет готовой продукции. Проведите «Выпуск за день» или добавьте товар ниже.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface-muted text-xs">
              <td className="sticky left-0 z-10 bg-surface-muted px-3 py-2">
                <div className="flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
                  <ProductSelect
                    products={products.filter((p) => !rows.includes(p.id))}
                    value=""
                    onChange={(id) => setExtraRows((cur) => [...cur, id])}
                    placeholder="Добавить товар"
                    className="min-w-[160px]"
                  />
                </div>
              </td>
              <td />
              {columns.map((c) => {
                const n = columnLines(c).reduce((s, id) => s + qty(c, id), 0);
                const sum = c.kind === "customer" ? columnLines(c).reduce((s, id) => s + qty(c, id) * priceOf(c.id, id), 0) : null;
                return (
                  <td key={c.key} className="px-2 py-2 text-right text-muted">
                    {n > 0 ? formatQuantity(n) : "—"}
                    {sum !== null && sum > 0 && <div className="text-foreground">{formatMoney(sum)}</div>}
                  </td>
                );
              })}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {pricing && (
        <PricesModal
          column={pricing}
          productIds={rows}
          productById={productById}
          prices={prices[pricing.id] ?? {}}
          onClose={() => setPricing(null)}
          onApply={(next) => {
            setPrices((cur) => ({ ...cur, [pricing.id]: next }));
            setPricing(null);
          }}
        />
      )}
    </div>
  );
}

// The agreed wholesale prices of one customer; empty = the product's own price. Saved with
// «Сохранить как постоянный заказ».
function PricesModal({
  column,
  productIds,
  productById,
  prices,
  onClose,
  onApply,
}: {
  column: Column;
  productIds: string[];
  productById: Map<string, ProductDto>;
  prices: Record<string, number>;
  onClose: () => void;
  onApply: (prices: Record<string, number>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(productIds.map((id) => [id, prices[id] !== undefined ? String(prices[id]) : ""])),
  );
  return (
    <Modal title={`Цены для «${column.name}»`} onClose={onClose} width="max-w-lg">
      <p className="mb-3 text-xs text-muted">Пустая цена = цена товара в номенклатуре.</p>
      <div className="mb-4 max-h-[60vh] space-y-1.5 overflow-y-auto">
        {productIds.map((id) => {
          const p = productById.get(id)!;
          return (
            <div key={id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-foreground">{p.name}</span>
              <input
                inputMode="decimal"
                value={values[id] ?? ""}
                onChange={(e) => setValues((cur) => ({ ...cur, [id]: e.target.value }))}
                placeholder={formatMoney(p.price)}
                className="w-28 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        data-submit
        onClick={() => {
          const next: Record<string, number> = {};
          for (const [id, v] of Object.entries(values)) {
            const n = Number(v.trim().replace(",", "."));
            if (v.trim() !== "" && Number.isFinite(n) && n >= 0) next[id] = Math.round(n * 100) / 100;
          }
          onApply(next);
        }}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Применить
      </button>
    </Modal>
  );
}
