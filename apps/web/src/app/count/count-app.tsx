"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, CheckCircle2, LogOut, Plus, RefreshCw, Search, Send, WifiOff, X } from "lucide-react";
import type { AddShelfCountEntryRequestDto, ShelfCountDto, ShelfCountProductDto } from "@bakery-os/shared";
import { ShelfCountStatus, UNIT_LABELS_RU, bakerSearchMatches, parseCountInput } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatQuantity } from "@/lib/format";

// «Пересчёт»: the cashiers count the shelf on their phones instead of a printed sheet. One login per
// point, any number of phones at once: every typed amount ADDS to the product's total (the shop floor on
// one phone, the back room on another). Nothing here shows what the books hold. What is typed is kept
// on the phone until the server has it, so a lost signal loses nothing.

type Pending = AddShelfCountEntryRequestDto & { date: string };
type Row = { total: number; parts: { quantity: number; deviceId: string; at: string }[] };

const DEVICE_KEY = "count_device_id";
const PENDING_KEY = "count_pending";
const POLL_MS = 6000;
const UNCOUNTED = "__uncounted";
const NO_CATEGORY = "Без категории";

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
const dayLabel = (key: string) => key.split("-").reverse().join(".");
const groupOf = (p: ShelfCountProductDto) => p.categoryName?.split(" › ")[0] ?? NO_CATEGORY;

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = newId()));
    return id;
  } catch {
    return "no-storage";
  }
}

function readPending(): Pending[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function CountApp({ onLogout }: { onLogout: () => void }) {
  const [sheet, setSheet] = useState<ShelfCountDto | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<ShelfCountProductDto | null>(null);
  const [sending, setSending] = useState(false);
  const me = useMemo(deviceId, []);
  const pendingRef = useRef<Pending[]>([]);
  const flushing = useRef(false);

  const storePending = useCallback((list: Pending[]) => {
    pendingRef.current = list;
    setPending(list);
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch {
      /* kept in memory only */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api.count.get();
      setSheet(s);
      setOffline(false);
      setError(null);
      return s;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else if (err instanceof ApiError) setError(err.message);
      else setOffline(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  // What is still on the phone goes to the server, one by one, in the order it was typed.
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const first = pendingRef.current[0];
        const entry = { clientId: first.clientId, deviceId: first.deviceId, productId: first.productId, kind: first.kind, quantity: first.quantity };
        try {
          await api.count.addEntry(entry);
        } catch (err) {
          if (!(err instanceof ApiError)) {
            setOffline(true);
            return;
          }
          // Refused for good (the sheet was sent meanwhile): say so and drop it.
          setError(err.message);
        }
        storePending(pendingRef.current.slice(1));
      }
      setOffline(false);
    } finally {
      flushing.current = false;
    }
  }, [storePending]);

  useEffect(() => {
    pendingRef.current = readPending();
    setPending(pendingRef.current);
    const tick = async () => {
      const s = await load();
      // Yesterday's unsent entries are not today's count.
      if (s && pendingRef.current.some((p) => p.date !== s.date)) storePending(pendingRef.current.filter((p) => p.date === s.date));
      await flush();
    };
    void tick();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void tick(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, flush, storePending]);

  // Totals per product: what the server has, plus what this phone has typed and not delivered yet.
  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    const add = (productId: string, quantity: number, device: string, at: string) => {
      const row = map.get(productId) ?? { total: 0, parts: [] };
      row.total = round3(row.total + quantity);
      row.parts.push({ quantity, deviceId: device, at });
      map.set(productId, row);
    };
    const known = new Set<string>();
    for (const e of sheet?.entries ?? []) {
      known.add(e.clientId);
      add(e.productId, e.quantity, e.deviceId, e.at);
    }
    for (const p of pending) {
      if (known.has(p.clientId) || (sheet && p.date !== sheet.date)) continue;
      const delta = p.kind === "SET" ? round3(p.quantity - (map.get(p.productId)?.total ?? 0)) : p.quantity;
      add(p.productId, delta, p.deviceId, new Date().toISOString());
    }
    return map;
  }, [sheet, pending]);

  const devices = useMemo(() => {
    const order: string[] = [];
    for (const e of sheet?.entries ?? []) if (!order.includes(e.deviceId)) order.push(e.deviceId);
    return order;
  }, [sheet]);
  const deviceName = (id: string) => (id === me ? "этот телефон" : `телефон ${devices.indexOf(id) + 1 || devices.length + 1}`);

  if (!sheet) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className={clsx("text-base", error || offline ? "text-red-700" : "text-muted")}>
          {error ?? (offline ? "Нет связи с программой. Проверьте интернет." : "Загрузка…")}
        </p>
        {(error || offline) && (
          <button type="button" onClick={() => void load()} className="h-14 rounded-2xl bg-accent px-8 text-lg font-semibold text-accent-foreground">
            Обновить
          </button>
        )}
        <button type="button" onClick={onLogout} className="text-base text-muted underline">
          Выйти
        </button>
      </main>
    );
  }

  const closed = sheet.status === ShelfCountStatus.SENT || sheet.applied;
  const counted = sheet.products.filter((p) => rows.has(p.productId)).length;
  const groups = Array.from(new Set(sheet.products.map(groupOf)));
  const shown = sheet.products.filter(
    (p) =>
      bakerSearchMatches(query, p.name, p.sku) &&
      (filter === null || (filter === UNCOUNTED ? !rows.has(p.productId) : groupOf(p) === filter)),
  );

  const record = (product: ShelfCountProductDto, kind: "ADD" | "SET", quantity: number) => {
    storePending([...pendingRef.current, { clientId: newId(), deviceId: me, productId: product.productId, kind, quantity, date: sheet.date }]);
    setOpen(null);
    void flush().then(load);
  };

  const send = async () => {
    const left = sheet.products.length - counted;
    if (pendingRef.current.length > 0) {
      setError("Сначала дождитесь связи: часть цифр ещё не дошла до программы.");
      return;
    }
    if (left > 0) {
      // Nothing may stay uncounted: show what is left instead of sending.
      setQuery("");
      setFilter(UNCOUNTED);
      setError(`Не посчитано товаров: ${left}. Посчитайте каждый или нажмите у него «Нет на полке».`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!window.confirm("Отправить пересчёт? После этого изменить его сможет только управляющий.")) return;
    setSending(true);
    setError(null);
    try {
      setSheet(await api.count.send());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setSending(false);
    }
  };

  const chip = (key: string | null, label: string) => (
    <button
      key={key ?? "all"}
      type="button"
      onClick={() => setFilter(key)}
      className={clsx(
        "h-11 shrink-0 rounded-full border px-4 text-base",
        filter === key ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-xl flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-4 pb-3 pt-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">Пересчёт</h1>
            <p className="truncate text-base text-muted">
              {sheet.locationName} · {dayLabel(sheet.date)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => void load()} aria-label="Обновить" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
              <RefreshCw className={clsx("h-5 w-5", loading && "animate-spin")} strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onLogout} aria-label="Выйти" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
              <LogOut className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-base">
            <span className="font-medium text-foreground">
              Посчитано {counted} из {sheet.products.length}
            </span>
            {devices.length > 1 && <span className="text-muted">телефонов: {devices.length}</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-accent" style={{ width: `${sheet.products.length ? (counted / sheet.products.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти товар"
            enterKeyHint="search"
            autoComplete="off"
            className="h-14 w-full rounded-2xl border border-border bg-surface pl-12 pr-12 text-lg text-foreground outline-none focus:border-accent"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Очистить" className="absolute right-1 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-muted">
              <X className="h-6 w-6" strokeWidth={1.75} />
            </button>
          )}
        </div>
        {/* One swiped line: with twenty categories a wrapped row would fill the screen. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ flexWrap: "nowrap" }}>
          {chip(null, "Все")}
          {chip(UNCOUNTED, `Не посчитано: ${sheet.products.length - counted}`)}
          {groups.map((g) => chip(g, g))}
        </div>
      </header>

      <div className="flex-1 px-4 pb-36 pt-3">
        {closed && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-green-50 px-4 py-4 text-base font-medium text-green-800">
            <CheckCircle2 className="h-6 w-6 shrink-0" strokeWidth={1.75} />
            {sheet.applied ? "Остатки за этот день уже проведены — пересчёт закрыт." : `Пересчёт отправлен${sheet.sentAt ? ` в ${timeLabel(sheet.sentAt)}` : ""}. Изменить его может управляющий.`}
          </div>
        )}
        {offline && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900">
            <WifiOff className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            Нет связи. Считайте дальше — цифры сохранены в телефоне{pending.length > 0 ? ` (не отправлено: ${pending.length})` : ""} и уйдут сами.
          </div>
        )}
        {error && <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>}

        {shown.length === 0 ? (
          <p className="py-10 text-center text-base text-muted">{filter === UNCOUNTED && !query ? "Всё посчитано" : "Такого товара в списке нет"}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((p) => {
              const row = rows.get(p.productId);
              return (
                <li key={p.productId}>
                  <button
                    type="button"
                    disabled={closed}
                    onClick={() => setOpen(p)}
                    className={clsx(
                      "flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left active:bg-surface-muted",
                      row ? "border-green-200 bg-green-50" : "border-border bg-surface",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-medium leading-snug text-foreground">{p.name}</span>
                      {row && row.parts.length > 1 && (
                        <span className="block text-sm text-muted">{row.parts.map((x) => formatQuantity(x.quantity)).join(" + ").replace(/\+ -/g, "− ")}</span>
                      )}
                    </span>
                    {row ? (
                      <span className="flex shrink-0 items-center gap-2 text-right">
                        <span className="text-xl font-semibold text-foreground">
                          {formatQuantity(row.total)} <span className="text-base font-normal text-muted">{UNIT_LABELS_RU[p.unit]}</span>
                        </span>
                        <Check className="h-6 w-6 text-green-600" strokeWidth={2} />
                      </span>
                    ) : (
                      <Plus className="h-6 w-6 shrink-0 text-muted" strokeWidth={1.75} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!closed && (
        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto w-full max-w-xl">
            <button
              type="button"
              onClick={send}
              disabled={sending || counted === 0}
              className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-xl font-semibold text-accent-foreground disabled:opacity-40"
            >
              <Send className="h-6 w-6" strokeWidth={2} />
              {sending ? "Отправляем…" : counted < sheet.products.length ? `Осталось посчитать: ${sheet.products.length - counted}` : "Отправить пересчёт"}
            </button>
          </div>
        </footer>
      )}

      {open && !closed && <EntrySheet product={open} row={rows.get(open.productId) ?? null} deviceName={deviceName} onClose={() => setOpen(null)} onRecord={record} />}
    </main>
  );
}

function EntrySheet({
  product,
  row,
  deviceName,
  onClose,
  onRecord,
}: {
  product: ShelfCountProductDto;
  row: Row | null;
  deviceName: (id: string) => string;
  onClose: () => void;
  onRecord: (product: ShelfCountProductDto, kind: "ADD" | "SET", quantity: number) => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);
  const unit = UNIT_LABELS_RU[product.unit];
  const value = text.trim() === "" ? null : parseCountInput(text, product.unit);
  const bad = text.trim() !== "" && (value === null || value < 0);
  const ok = value !== null && value >= 0;
  const isSum = /[+*×xх]/i.test(text);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onClose}>
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-3 flex items-start gap-3">
            <h2 className="flex-1 text-xl font-semibold leading-snug text-foreground">{product.name}</h2>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted">
              <X className="h-6 w-6" strokeWidth={1.75} />
            </button>
          </div>

          {row && (
            <div className="mb-3 rounded-2xl bg-green-50 px-4 py-3">
              <p className="text-base font-medium text-green-800">
                Уже посчитано: {formatQuantity(row.total)} {unit}
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-green-800">
                {row.parts.map((x, i) => (
                  <li key={i}>
                    {x.quantity >= 0 ? "+" : "−"} {formatQuantity(Math.abs(x.quantity))} · {deviceName(x.deviceId)} · {timeLabel(x.at)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-1 flex items-center gap-2">
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value.replace(/[^\d.,+*×xх ]/gi, ""))}
              onKeyDown={(e) => e.key === "Enter" && ok && onRecord(product, "ADD", value)}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="0"
              aria-label="Количество"
              className="h-16 min-w-0 flex-1 rounded-2xl border border-border bg-surface text-center text-3xl font-semibold text-foreground outline-none focus:border-accent"
            />
            <span className="w-8 text-base text-muted">{unit}</span>
            <button
              type="button"
              onClick={() => {
                setText((t) => (t.trim() === "" || /[+*]\s*$/.test(t) ? t : `${t}+`));
                input.current?.focus();
              }}
              aria-label="Прибавить ещё"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface text-foreground"
            >
              <Plus className="h-7 w-7" strokeWidth={2} />
            </button>
          </div>
          <p className={clsx("mb-3 h-6 text-center text-base", bad ? "text-red-700" : "text-muted")}>
            {bad ? "Не понял число" : isSum && ok ? `= ${formatQuantity(value)} ${unit}` : ""}
          </p>

          <button
            type="button"
            disabled={!ok}
            onClick={() => ok && onRecord(product, "ADD", value)}
            className="mb-2 h-16 w-full rounded-2xl bg-accent text-xl font-semibold text-accent-foreground disabled:opacity-40"
          >
            {row ? (ok ? `Добавить: станет ${formatQuantity(round3(row.total + value))}` : "Добавить") : "Записать"}
          </button>
          {row ? (
            <button
              type="button"
              disabled={!ok}
              onClick={() => ok && onRecord(product, "SET", value)}
              className="h-14 w-full rounded-2xl border border-border bg-surface text-lg font-medium text-foreground disabled:opacity-40"
            >
              {ok ? `Исправить: всего ${formatQuantity(value)}` : "Исправить (введите правильное число)"}
            </button>
          ) : (
            <button type="button" onClick={() => onRecord(product, "SET", 0)} className="h-14 w-full rounded-2xl border border-border bg-surface text-lg font-medium text-foreground">
              Нет на полке (0)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
