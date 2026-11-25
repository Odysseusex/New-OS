"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, History, LogOut, Plus, RefreshCw, Search, Snowflake, Store, Truck, X } from "lucide-react";
import type { BakerCatalogDto, BakerDayDto, BakerNoteDto, BakerRecipientDto, CurrentUserDto, SupplierIntakeDto } from "@bakery-os/shared";
import { BAKER_NOTE_STATUS_LABELS_RU, BakerNoteKind, BakerNoteStatus, UNIT_LABELS_RU, bakerRecipientKey, bakerSearchMatches, parseBakerQuantity } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";
import { IntakeForm, IntakeView, MyIntakes } from "./intake";

type View =
  | { name: "home" }
  | { name: "intake" }
  | { name: "intakeView"; intake: SupplierIntakeDto }
  | { name: "recipient" }
  | { name: "edit"; kind: BakerNoteKind; recipient: BakerRecipientDto | null; note: BakerNoteDto | null };

const dayLabel = (key: string) => {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
};
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });

export function BakerApp({ user, onLock }: { user: CurrentUserDto; onLock: () => void }) {
  const [catalog, setCatalog] = useState<BakerCatalogDto | null>(null);
  const [day, setDay] = useState<BakerDayDto | null>(null);
  const [intakes, setIntakes] = useState<SupplierIntakeDto[]>([]);
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<View>({ name: "home" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // A session that ran out (8 hours) ends at the PIN pad, not at an error.
  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) onLock();
      else setError(err instanceof ApiError ? err.message : fallback);
    },
    [onLock],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await api.baker.catalog(sourceId);
      setCatalog(c);
      setDay(await api.baker.day(undefined, c.sourceLocationId));
      // The list of own intakes is a convenience: the screen works without it.
      api.baker.myIntakes().then(setIntakes).catch(() => undefined);
    } catch (err) {
      fail(err, "Нет связи с программой. Проверьте интернет и нажмите «Обновить».");
    } finally {
      setLoading(false);
    }
  }, [sourceId, fail]);
  useEffect(() => {
    load();
  }, [load]);

  // The operator's «Изменить» on the day screen opens a note here by its address.
  const opened = useRef(false);
  useEffect(() => {
    if (!catalog || opened.current) return;
    opened.current = true;
    const id = new URLSearchParams(window.location.search).get("note");
    if (!id) return;
    api.baker
      .note(id)
      .then((note) => setView({ name: "edit", kind: note.kind, recipient: note.recipient, note }))
      .catch((err) => fail(err, "Не удалось открыть накладную"));
  }, [catalog, fail]);

  const home = (text?: string) => {
    setView({ name: "home" });
    setNotice(text ?? null);
    load();
  };

  if (!catalog || !day) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        {error ? (
          <>
            <p className="text-base text-red-700">{error}</p>
            <button type="button" onClick={load} className="h-14 rounded-2xl bg-accent px-8 text-lg font-semibold text-accent-foreground">
              Обновить
            </button>
            <button type="button" onClick={onLock} className="text-base text-muted underline">
              Выйти
            </button>
          </>
        ) : (
          <p className="text-base text-muted">Загрузка…</p>
        )}
      </main>
    );
  }

  if (view.name === "recipient") {
    return <RecipientPicker catalog={catalog} onBack={() => setView({ name: "home" })} onPick={(recipient) => setView({ name: "edit", kind: BakerNoteKind.DELIVERY, recipient, note: null })} />;
  }
  if (view.name === "intake") {
    return <IntakeForm catalog={catalog} onBack={() => home()} onDone={home} onExpired={onLock} />;
  }
  if (view.name === "intakeView") {
    return <IntakeView intake={view.intake} onBack={() => setView({ name: "home" })} />;
  }
  if (view.name === "edit") {
    return <NoteEditor key={view.note?.id ?? `${view.kind}:${view.recipient?.id ?? ""}`} catalog={catalog} kind={view.kind} recipient={view.recipient} note={view.note} onBack={() => home()} onDone={home} onExpired={onLock} />;
  }

  const fridge = day.fridge;
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">Накладные</h1>
          <p className="truncate text-base text-muted">
            {catalog.sourceLocationName} · {dayLabel(day.day)}
          </p>
          <p className="truncate text-base text-muted">{user.fullName}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={load} aria-label="Обновить" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
            <RefreshCw className={clsx("h-5 w-5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={onLock} aria-label="Выйти" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {catalog.sources.length > 1 && (
        <select value={catalog.sourceLocationId} onChange={(e) => setSourceId(e.target.value)} className="mb-4 h-12 w-full rounded-2xl border border-border bg-surface px-4 text-base text-foreground">
          {catalog.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {notice && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-green-50 px-4 py-4 text-base font-medium text-green-800">
          <CheckCircle2 className="h-6 w-6 shrink-0" strokeWidth={1.75} />
          {notice}
        </div>
      )}
      {error && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-4 text-base text-red-700">{error}</div>}

      <button type="button" onClick={() => setView({ name: "recipient" })} className="mb-3 flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-accent text-xl font-semibold text-accent-foreground shadow-card active:opacity-90">
        <Plus className="h-7 w-7" strokeWidth={2} />
        Новая накладная
      </button>
      <button
        type="button"
        onClick={() => setView({ name: "edit", kind: BakerNoteKind.FRIDGE, recipient: null, note: fridge })}
        className="mb-3 flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left active:bg-surface-muted"
      >
        <Snowflake className="h-7 w-7 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold text-foreground">Холодильник на завтра</span>
          <span className="block text-base text-muted">
            {fridge ? `Заполнен: позиций ${fridge.lines.length}${fridge.status === BakerNoteStatus.POSTED ? " · день проведён" : ""}` : "Не заполнен"}
          </span>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-muted" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => setView({ name: "intake" })}
        className="mb-6 flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left active:bg-surface-muted"
      >
        <Camera className="h-7 w-7 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold text-foreground">Приход от поставщика</span>
          <span className="block text-base text-muted">Фото накладной</span>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-muted" strokeWidth={1.75} />
      </button>

      <h2 className="mb-2 text-lg font-semibold text-foreground">{catalog.seesAll ? "Накладные за сегодня" : "Мои накладные за сегодня"}</h2>
      {day.notes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-base text-muted">Сегодня накладных ещё нет</p>
      ) : (
        <ul className="space-y-2">
          {day.notes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setView({ name: "edit", kind: n.kind, recipient: n.recipient, note: n })}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left active:bg-surface-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-snug text-foreground">
                    № {n.number} → {n.recipient?.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted">
                    <span>
                      {timeLabel(n.createdAt)} · позиций {n.lines.length} · {formatMoney(n.total)}
                    </span>
                    <StatusChip status={n.status} />
                  </span>
                  {catalog.seesAll && <span className="block truncate text-sm text-muted">{n.createdByName}</span>}
                </span>
                <ChevronRight className="h-6 w-6 shrink-0 text-muted" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <MyIntakes intakes={intakes} onOpen={(intake) => setView({ name: "intakeView", intake })} />
    </main>
  );
}

function StatusChip({ status }: { status: BakerNoteStatus }) {
  const posted = status === BakerNoteStatus.POSTED;
  return (
    <span className={clsx("shrink-0 rounded-full px-3 py-1 text-sm font-medium", posted ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
      {BAKER_NOTE_STATUS_LABELS_RU[status]}
    </span>
  );
}

function TopBar({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background px-3 py-3">
      <button type="button" onClick={onBack} aria-label="Назад" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
        <ArrowLeft className="h-6 w-6" strokeWidth={1.75} />
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="truncate text-base text-muted">{subtitle}</p>}
      </div>
    </header>
  );
}

function RecipientPicker({ catalog, onPick, onBack }: { catalog: BakerCatalogDto; onPick: (r: BakerRecipientDto) => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const shown = catalog.recipients.filter((r) => bakerSearchMatches(query, r.name));
  const group = (kind: BakerRecipientDto["kind"], title: string, Icon: typeof Store) => {
    const rows = shown.filter((r) => r.kind === kind);
    if (rows.length === 0) return null;
    return (
      <section className="mb-5">
        <h2 className="mb-2 text-base font-semibold text-muted">{title}</h2>
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r)} className="flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left active:bg-surface-muted">
              <Icon className="h-6 w-6 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="flex-1 text-lg font-medium text-foreground">{r.name}</span>
              <ChevronRight className="h-6 w-6 shrink-0 text-muted" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </section>
    );
  };
  return (
    <main className="mx-auto w-full max-w-xl pb-10">
      <TopBar title="Кому накладная" onBack={onBack} />
      <div className="px-4 pt-4">
        {catalog.recipients.length > 8 && (
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти получателя" className="mb-4 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-lg text-foreground outline-none focus:border-accent" />
        )}
        {group("location", "Свои точки", Store)}
        {group("customer", "Оптовики", Truck)}
        {shown.length === 0 && <p className="py-8 text-center text-base text-muted">Никого не найдено</p>}
      </div>
    </main>
  );
}

type Line = { productId: string; qty: string };

function NoteEditor({
  catalog,
  kind,
  recipient,
  note,
  onBack,
  onDone,
  onExpired,
}: {
  catalog: BakerCatalogDto;
  kind: BakerNoteKind;
  recipient: BakerRecipientDto | null;
  note: BakerNoteDto | null;
  onBack: () => void;
  onDone: (text: string) => void;
  onExpired: () => void;
}) {
  const fridge = kind === BakerNoteKind.FRIDGE;
  const readOnly = !!note && !note.editable;
  const productById = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog]);
  const special = recipient ? catalog.prices[bakerRecipientKey(recipient.kind, recipient.id)] : undefined;
  const priceOf = useCallback((productId: string) => special?.[productId] ?? productById.get(productId)?.price ?? 0, [special, productById]);

  // What was typed survives a locked phone or a closed tab until the note is sent.
  const draftKey = note ? null : `baker_draft:${catalog.sourceLocationId}:${kind}:${recipient ? bakerRecipientKey(recipient.kind, recipient.id) : ""}:${catalog.day}`;
  const [lines, setLines] = useState<Line[]>(() => {
    if (note) return note.lines.filter((l) => readOnly || productById.has(l.productId)).map((l) => ({ productId: l.productId, qty: formatQuantity(l.quantity) }));
    try {
      const saved = draftKey ? (JSON.parse(localStorage.getItem(draftKey) ?? "[]") as Line[]) : [];
      return Array.isArray(saved) ? saved.filter((l) => productById.has(l.productId)) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (lines.length > 0) localStorage.setItem(draftKey, JSON.stringify(lines));
      else localStorage.removeItem(draftKey);
    } catch {
      /* a full or blocked storage only loses the draft */
    }
  }, [lines, draftKey]);

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const focusQty = (productId: string) => window.setTimeout(() => qtyRefs.current.get(productId)?.focus(), 50);

  const matches = useMemo(() => (query.trim() ? catalog.products.filter((p) => bakerSearchMatches(query, p.name, p.sku)).slice(0, 30) : []), [query, catalog]);
  const total = lines.reduce((s, l) => s + Math.round(parseBakerQuantity(l.qty) * priceOf(l.productId) * 100) / 100, 0);
  const filled = lines.filter((l) => parseBakerQuantity(l.qty) > 0);

  function add(productId: string) {
    setQuery("");
    setHint(null);
    setLines((cur) => (cur.some((l) => l.productId === productId) ? cur : [...cur, { productId, qty: "" }]));
    focusQty(productId);
  }

  const failed = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 401) onExpired();
    else setError(err instanceof ApiError ? err.message : fallback);
  };

  async function likeYesterday() {
    setBusy(true);
    setError(null);
    try {
      const { note: prev } = await api.baker.previous({
        kind,
        sourceLocationId: catalog.sourceLocationId,
        ...(recipient?.kind === "customer" ? { customerId: recipient.id } : recipient ? { locationId: recipient.id } : {}),
      });
      if (!prev || prev.lines.length === 0) {
        setHint(fridge ? "Раньше холодильник не заполняли" : "Этому получателю накладных ещё не было");
        return;
      }
      setLines(prev.lines.filter((l) => productById.has(l.productId)).map((l) => ({ productId: l.productId, qty: formatQuantity(l.quantity) })));
      setHint(`Как ${dayLabel(prev.day)} — проверьте и поправьте количество`);
    } catch (err) {
      failed(err, "Не удалось загрузить прошлую накладную");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (busy) return;
    if (!fridge && filled.length === 0) {
      setError("Укажите количество хотя бы у одного товара");
      return;
    }
    const empty = lines.filter((l) => parseBakerQuantity(l.qty) === 0);
    if (empty.length > 0 && !window.confirm(`Без количества: ${empty.map((l) => productById.get(l.productId)?.name).join(", ")}. Эти строки не попадут в накладную. Продолжить?`)) return;
    if (fridge && filled.length === 0 && !window.confirm("Холодильник пустой — на производстве ничего не осталось?")) return;
    setBusy(true);
    setError(null);
    const dto = {
      kind,
      sourceLocationId: catalog.sourceLocationId,
      ...(recipient?.kind === "customer" ? { customerId: recipient.id } : recipient ? { locationId: recipient.id } : {}),
      lines: filled.map((l) => ({ productId: l.productId, quantity: parseBakerQuantity(l.qty) })),
    };
    try {
      const saved = note ? await api.baker.update(note.id, dto) : await api.baker.create(dto);
      if (draftKey) localStorage.removeItem(draftKey);
      onDone(fridge ? "Холодильник на завтра сохранён" : `Накладная № ${saved.number} → ${saved.recipient?.name}: ${note ? "исправлена" : "отправлена"}, ${formatMoney(saved.total)}`);
    } catch (err) {
      failed(err, "Не удалось отправить. Проверьте интернет и нажмите ещё раз — набранное сохранено.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelNote() {
    if (!note || busy || !window.confirm(`Отменить накладную № ${note.number}?`)) return;
    setBusy(true);
    try {
      await api.baker.cancel(note.id);
      onDone(`Накладная № ${note.number} отменена`);
    } catch (err) {
      failed(err, "Не удалось отменить");
    } finally {
      setBusy(false);
    }
  }

  const title = fridge ? "Холодильник на завтра" : (recipient?.name ?? "Накладная");
  const subtitle = fridge ? "Что осталось на производстве" : note ? `Накладная № ${note.number}` : "Новая накладная";

  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-xl flex-col">
      <TopBar title={title} subtitle={subtitle} onBack={onBack} />
      <div className="flex-1 px-4 pb-40 pt-4">
        {readOnly && note && (
          <div className="mb-4 rounded-2xl bg-green-50 px-4 py-3 text-base text-green-800">
            {note.status === BakerNoteStatus.POSTED ? `Проведена${note.document ? ` · ${note.document}` : ""}. Исправить её уже нельзя.` : BAKER_NOTE_STATUS_LABELS_RU[note.status]}
          </div>
        )}
        {!readOnly && (
          <>
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
            {query.trim() && (
              <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface">
                {matches.length === 0 ? (
                  <p className="px-4 py-4 text-base text-muted">Такого товара нет в программе</p>
                ) : (
                  matches.map((p) => {
                    const added = lines.some((l) => l.productId === p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => add(p.id)} className="flex min-h-[3.5rem] w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0 active:bg-surface-muted">
                        <span className="flex-1 text-lg text-foreground">{p.name}</span>
                        {!fridge && <span className="shrink-0 text-base text-muted">{formatMoney(priceOf(p.id))}</span>}
                        {added && <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" strokeWidth={1.75} />}
                      </button>
                    );
                  })
                )}
              </div>
            )}
            {!note && lines.length === 0 && !query.trim() && (
              <button type="button" onClick={likeYesterday} disabled={busy} className="mb-4 flex h-16 w-full items-center justify-center gap-3 rounded-2xl border border-accent bg-surface text-lg font-semibold text-accent disabled:opacity-50">
                <History className="h-6 w-6" strokeWidth={1.75} />
                Как вчера
              </button>
            )}
          </>
        )}
        {hint && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-800">{hint}</p>}
        {error && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>}

        {lines.length === 0 && !query.trim() ? (
          <p className="py-8 text-center text-base text-muted">{readOnly ? "Пусто" : "Найдите товар по названию и укажите количество"}</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => {
              const p = productById.get(l.productId);
              const posted = note?.lines.find((x) => x.productId === l.productId);
              const name = p?.name ?? posted?.productName ?? "";
              const unit = UNIT_LABELS_RU[p?.unit ?? posted?.unit ?? "PCS"];
              const price = readOnly ? (posted?.unitPrice ?? 0) : priceOf(l.productId);
              const q = parseBakerQuantity(l.qty);
              return (
                <li key={l.productId} className="rounded-2xl border border-border bg-surface px-4 py-3">
                  <div className="mb-2 flex items-start gap-2">
                    <span className="flex-1 text-lg font-medium leading-snug text-foreground">{name}</span>
                    {!readOnly && (
                      <button type="button" onClick={() => setLines((cur) => cur.filter((x) => x.productId !== l.productId))} aria-label="Убрать" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted">
                        <X className="h-6 w-6" strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      ref={(el) => {
                        if (el) qtyRefs.current.set(l.productId, el);
                        else qtyRefs.current.delete(l.productId);
                      }}
                      value={l.qty}
                      disabled={readOnly}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.,]/g, "");
                        setLines((cur) => cur.map((x) => (x.productId === l.productId ? { ...x, qty: v } : x)));
                      }}
                      onFocus={(e) => e.target.select()}
                      inputMode="decimal"
                      enterKeyHint="done"
                      placeholder="0"
                      aria-label={`Количество: ${name}`}
                      className="h-14 w-28 rounded-xl border border-border bg-surface text-center text-2xl font-semibold text-foreground outline-none focus:border-accent disabled:bg-surface-muted"
                    />
                    <span className="text-base text-muted">{unit}</span>
                    {!fridge && (
                      <span className="ml-auto text-right">
                        <span className="block text-base text-muted">× {formatMoney(price)}</span>
                        <span className="block text-lg font-semibold text-foreground">{formatMoney(Math.round(q * price * 100) / 100)}</span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {note && note.editable && !fridge && (
          <button type="button" onClick={cancelNote} disabled={busy} className="mt-6 h-14 w-full rounded-2xl border border-red-300 text-lg font-medium text-red-700 disabled:opacity-50">
            Отменить накладную
          </button>
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base text-muted">Позиций: {filled.length}</p>
            {!fridge && <p className="truncate text-2xl font-semibold text-foreground">{formatMoney(readOnly && note ? note.total : total)}</p>}
          </div>
          {!readOnly && (
            <button type="button" onClick={send} disabled={busy} className="h-16 shrink-0 rounded-2xl bg-accent px-8 text-xl font-semibold text-accent-foreground disabled:opacity-40">
              {busy ? "Отправляем…" : fridge || note ? "Сохранить" : "Отправить"}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
