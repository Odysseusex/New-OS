"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Laptop, Pencil, Printer, RefreshCw, Search, Send, Truck, X } from "lucide-react";
import type { BakerDayDto, BakerDayPostResultDto, BakerDayPreviewDto, BakerNoteDto, BakerTripStateDto } from "@bakery-os/shared";
import { BAKER_AUTO_POST_MAX_DELAY, BAKER_AUTO_POST_ROLES, BAKER_DAY_ROLES, BAKER_NOTE_STATUS_LABELS_RU, BakerNoteStatus, Role, UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney, formatQuantity } from "@/lib/format";
import { bakerNoteWaybill, printWaybills } from "@/lib/waybill";
import { WaybillShareModal } from "@/components/waybill-share-modal";
import { zonedDateKey } from "@/lib/reporting-period";
import { Modal } from "@/components/modal";
import { NOTES_PRINTED_EVENT, SendToLaptopStatus, useSendToLaptop } from "@/components/remote-print";

const PACK_KEY = "baker_print_pack";
// Search over a day's notes: every typed word must occur in the recipient's name or the number (ё = е). Not products —
// a product named «Керемет» pulled every note carrying it into a search for the client «Керемет» (owner, 26.11.2026).
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const matchesNote = (n: BakerNoteDto, query: string) => {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = norm([n.recipient?.name ?? "", String(n.number)].join(" "));
  return words.every((w) => text.includes(w));
};
const dayLabel = (key: string) => key.split("-").reverse().join(".");
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });

// Производство → «Накладные пекарей»: what the bakers sent from their phones today. A note is a draft
// until «Провести день» turns the day into «Выпуск за день», transfers to own points and sales on account.
// `printOnly`: the door laptop («Выдача накладных») — read and print, nothing that changes a note.
export function BakerDayTab({ printOnly = false }: { printOnly?: boolean } = {}) {
  const { user } = useAuth();
  const canPost = !printOnly && (user ? BAKER_DAY_ROLES.includes(user.role) : false);
  const [dayKey, setDayKey] = useState(() => zonedDateKey());
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  const [day, setDay] = useState<BakerDayDto | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<BakerNoteDto | null>(null);
  const [preview, setPreview] = useState<BakerDayPreviewDto | null>(null);
  const [result, setResult] = useState<BakerDayPostResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  // «Несколько на листе»: short notes share a sheet (cut apart with scissors); remembered on this computer.
  const [pack, setPack] = useState(true);
  // Notes ticked for printing; none ticked = print them all.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState<BakerNoteDto[] | null>(null);
  // Search (owner / admin, 26.11.2026): find a client's notes to send them to WhatsApp.
  const canSearch = !printOnly && !!user && (user.role === Role.OWNER || user.role === Role.ADMIN);
  const [query, setQuery] = useState("");
  // «На ноутбук выдачи»: print on the door laptop's printer from here (a phone, an iPad, the office).
  const laptop = useSendToLaptop();
  // Another day or workshop starts with nothing ticked.
  useEffect(() => setPicked(new Set()), [dayKey, sourceId]);
  useEffect(() => {
    try {
      // On unless switched off on this computer (owner, 25.11.2026: one note per sheet wastes paper).
      setPack(localStorage.getItem(PACK_KEY) !== "0");
    } catch {
      /* no storage: one note per sheet */
    }
  }, []);
  const setPackSaved = (value: boolean) => {
    setPack(value);
    try {
      localStorage.setItem(PACK_KEY, value ? "1" : "0");
    } catch {
      /* not remembered, still applied */
    }
  };

  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setState("loading");
      return api.baker
        .day(dayKey, sourceId)
        .then((d) => {
          setDay(d);
          setError(null);
          setState("ready");
        })
        .catch((err) => {
          if (quiet) return;
          setError(err instanceof ApiError ? err.message : "Не удалось загрузить накладные");
          setState("error");
        });
    },
    [dayKey, sourceId],
  );
  useEffect(() => {
    load();
    // New notes arrive while the screen is open.
    const timer = window.setInterval(() => load(true), 60_000);
    const onPrinted = () => void load(true);
    window.addEventListener(NOTES_PRINTED_EVENT, onPrinted);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(NOTES_PRINTED_EVENT, onPrinted);
    };
  }, [load]);

  async function openPreview() {
    if (!day) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api.baker.preview(day.day, day.sourceLocationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось посчитать день");
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.baker.post({ day: preview.day, sourceLocationId: preview.sourceLocationId, signature: preview.signature });
      setResult(res);
      setDay(res.day);
      setPreview(null);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "Не удалось провести день");
      load(true);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(note: BakerNoteDto) {
    if (!window.confirm(`Отменить накладную № ${note.number} → ${note.recipient?.name}?`)) return;
    try {
      await api.baker.cancel(note.id);
      setOpened(null);
      load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить");
    }
  }

  if (state === "loading" && !day) return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error" && !day) return <p className="text-sm text-red-700">{error}</p>;
  if (!day) return null;

  const shown = canSearch && query.trim() ? day.notes.filter((n) => matchesNote(n, query)) : day.notes;
  const chosen = shown.filter((n) => picked.has(n.id));
  const allPicked = shown.length > 0 && chosen.length === shown.length;
  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const waiting = day.notes.filter((n) => n.status === BakerNoteStatus.SENT);
  // Not printed yet, or changed by the baker after it was printed.
  const fresh = shown.filter((n) => n.printCount === 0 || n.changedSincePrint);
  // The print window must open inside the click; the «Напечатана» mark is recorded right after.
  const printNow = (notes: BakerNoteDto[], packed = pack) => {
    if (notes.length === 0) return;
    printWaybills(
      notes.map((n) => bakerNoteWaybill(n)),
      packed,
    );
    api.baker
      .markPrinted(notes.map((n) => n.id))
      .then(() => load(true))
      .catch(() => undefined);
  };
  const total = day.notes.reduce((s, n) => s + n.total, 0);
  const button = "flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={dayKey}
          max={zonedDateKey()}
          onChange={(e) => e.target.value && setDayKey(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        />
        {day.sources.length > 1 && (
          <select value={day.sourceLocationId} onChange={(e) => setSourceId(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent">
            {day.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => load()} className={button}>
          <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          Обновить
        </button>
        {canSearch && (
          <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: клиент, точка, №"
              className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-8 text-sm text-foreground outline-none focus:border-accent"
            />
            {query && (
              <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!printOnly && (
            <a href="/baker" className={button}>
              Новая накладная
            </a>
          )}
          <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground">
            <input type="checkbox" checked={pack} onChange={(e) => setPackSaved(e.target.checked)} />
            Несколько на листе
          </label>
          <button
            type="button"
            onClick={() => printNow(chosen.length > 0 ? chosen : shown)}
            disabled={shown.length === 0}
            className={button}
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            {chosen.length > 0 ? `Печать выбранных (${chosen.length})` : shown.length < day.notes.length ? `Печать найденных (${shown.length})` : "Печать всех накладных"}
          </button>
          {chosen.length === 0 && fresh.length > 0 && fresh.length < shown.length && (
            <button type="button" onClick={() => printNow(fresh)} className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Печать новых ({fresh.length})
            </button>
          )}
          {!printOnly && (
            <button
              type="button"
              onClick={() => laptop.send(chosen.length > 0 ? chosen : shown, pack)}
              disabled={shown.length === 0 || laptop.busy}
              className={button}
            >
              <Laptop className="h-4 w-4" strokeWidth={1.75} />
              {chosen.length > 0 ? `На ноутбук выдачи (${chosen.length})` : shown.length < day.notes.length ? `Найденные на ноутбук (${shown.length})` : "Все на ноутбук выдачи"}
            </button>
          )}
          {!printOnly && chosen.length === 0 && fresh.length > 0 && fresh.length < shown.length && (
            <button type="button" onClick={() => laptop.send(fresh, pack)} disabled={laptop.busy} className={button}>
              <Laptop className="h-4 w-4" strokeWidth={1.75} />
              Новые на ноутбук ({fresh.length})
            </button>
          )}
          {chosen.length === 0 && shown.length > 0 && shown.length < day.notes.length && (
            <button type="button" onClick={() => setSharing(shown)} className={button}>
              <Send className="h-4 w-4" strokeWidth={1.75} />
              Найденные в WhatsApp ({shown.length})
            </button>
          )}
          {chosen.length > 0 && (
            <button type="button" onClick={() => setSharing(chosen)} className={button}>
              <Send className="h-4 w-4" strokeWidth={1.75} />
              Отправить в WhatsApp ({chosen.length})
            </button>
          )}
          {chosen.length > 0 && (
            <button type="button" onClick={() => setPicked(new Set())} className={button}>
              Снять выбор
            </button>
          )}
          {canPost && (
            <button type="button" onClick={openPreview} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
              {busy && !preview ? "Считаем…" : "Провести день"}
            </button>
          )}
        </div>
      </div>

      {day.pendingDays.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Не проведены накладные за другие дни:
          {day.pendingDays.map((p) => (
            <button key={p.day} type="button" onClick={() => setDayKey(p.day)} className="rounded-lg border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100">
              {dayLabel(p.day)} — {p.count}
            </button>
          ))}
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!printOnly && <SendToLaptopStatus sent={laptop.sent} error={laptop.error} onClose={laptop.clear} />}
      {!printOnly && dayKey === zonedDateKey() && <TripPanel onLaunched={() => void load(true)} />}
      {!printOnly && user && BAKER_AUTO_POST_ROLES.includes(user.role) && <AutoPostSettings day={day} onSaved={() => void load(true)} />}
      {result && (
        <div className={clsx("mb-4 rounded-xl px-4 py-3 text-sm", result.notes.some((n) => !n.ok) ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800")}>
          <p className="font-medium">
            День проведён.{" "}
            {result.released ? `Выпуск: партий ${result.released.batches}, себестоимость ${formatMoney(result.released.totalCost)}.` : "Выпуск не понадобился."} Документов:{" "}
            {result.notes.filter((n) => n.ok).length} из {result.notes.length}.
          </p>
          {result.notes
            .filter((n) => !n.ok)
            .map((n) => (
              <p key={n.noteId} className="mt-1 text-red-700">
                Накладная № {n.number} → {n.recipientName} не проведена: {n.message}
              </p>
            ))}
          {result.notes.some((n) => !n.ok) && <p className="mt-1">Исправьте и нажмите «Провести день» ещё раз — проведённые накладные не повторятся.</p>}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Накладных" value={String(day.notes.length)} />
        <Stat label="Ждут проведения" value={String(waiting.length)} />
        <Stat label="Сумма" value={formatMoney(total)} />
        <Stat label="Холодильник на завтра" value={day.fridge ? `позиций ${day.fridge.lines.length}` : "не заполнен"} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label="Выбрать все накладные"
                    checked={allPicked}
                    disabled={shown.length === 0}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((n) => n.id)) : new Set())}
                  />
                  №
                </label>
              </th>
              <th className="px-3 py-2 font-medium">Время</th>
              <th className="px-3 py-2 font-medium">Получатель</th>
              <th className="px-3 py-2 font-medium">Пекарь</th>
              <th className="px-3 py-2 text-right font-medium">Позиций</th>
              <th className="px-3 py-2 text-right font-medium">Сумма</th>
              <th className="px-3 py-2 font-medium">Печать</th>
              <th className="px-3 py-2 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {day.notes.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  По «{query.trim()}» ничего не найдено
                </td>
              </tr>
            )}
            {day.notes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  За {dayLabel(day.day)} накладных нет
                </td>
              </tr>
            )}
            {shown.map((n) => (
              <tr key={n.id} onClick={() => setOpened(n)} className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-muted">
                <td
                  className={clsx("border-l-4 px-3 py-2 font-medium text-foreground", n.printCount === 0 ? "border-l-rose-400" : n.changedSincePrint ? "border-l-amber-400" : "border-l-sky-400")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className="h-4 w-4" aria-label={`Выбрать накладную № ${n.number}`} checked={picked.has(n.id)} onChange={() => togglePick(n.id)} />
                    {n.number}
                  </label>
                </td>
                <td className="px-3 py-2 text-muted">{timeLabel(n.createdAt)}</td>
                <td className="px-3 py-2 text-foreground">
                  {n.recipient?.name}
                  <span className="ml-2 text-xs text-muted">{n.recipient?.kind === "customer" ? "оптовик" : "точка"}</span>
                </td>
                <td className="px-3 py-2 text-muted">{n.createdByName}</td>
                <td className="px-3 py-2 text-right text-foreground">{n.lines.length}</td>
                <td className="px-3 py-2 text-right text-foreground">{formatMoney(n.total)}</td>
                <td className="px-3 py-2">
                  <PrintMark note={n} />
                  {n.tripNumber !== null && <span className="mt-0.5 block text-xs text-muted">Рейс {n.tripNumber}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", n.status === BakerNoteStatus.POSTED ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>
                    {BAKER_NOTE_STATUS_LABELS_RU[n.status]}
                  </span>
                  {n.autoPostFailed && <span className="mt-0.5 block text-xs font-medium text-red-700">Не провелась</span>}
                  {n.revisions.length > 0 && <span className="mt-0.5 block text-xs text-muted">Исправлена</span>}
                  {n.document && <span className="ml-2 text-xs text-muted">{n.document}</span>}
                  {n.postError && <span className="mt-1 block text-xs text-red-700">{n.postError}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {day.fridge && day.fridge.lines.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            Холодильник на завтра <span className="font-normal text-muted">· {day.fridge.createdByName}</span>
          </p>
          <p className="text-sm text-muted">{day.fridge.lines.map((l) => `${l.productName} — ${formatQuantity(l.quantity)} ${UNIT_LABELS_RU[l.unit]}`).join("; ")}</p>
        </div>
      )}

      {opened && (
        <Modal title={`Накладная № ${opened.number} → ${opened.recipient?.name ?? ""}`} onClose={() => setOpened(null)} width="max-w-2xl">
          <p className="mb-3 text-sm text-muted">
            {dayLabel(opened.day)}, {timeLabel(opened.createdAt)} · {opened.createdByName} · {BAKER_NOTE_STATUS_LABELS_RU[opened.status]}
            {opened.document ? ` · ${opened.document}` : ""}
          </p>
          <div className="mb-3">
            <PrintMark note={opened} long />
          </div>
          {opened.autoPostFailed && (
            <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Не провелась автоматически: {opened.postError ?? "причина не записана"}</div>
          )}
          {day.autoPostSince && opened.createdAt >= day.autoPostSince && opened.status === BakerNoteStatus.SENT && !opened.autoPostFailed && (
            <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Проведётся автоматически около {timeLabel(new Date(new Date(opened.contentChangedAt).getTime() + day.autoPostDelayMinutes * 60_000).toISOString())}
            </div>
          )}
          <table className="w-full text-sm" data-wide="">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">Товар</th>
                <th className="py-2 text-right font-medium">Количество</th>
                <th className="py-2 text-right font-medium">Цена</th>
                <th className="py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {opened.lines.map((l) => (
                <tr key={l.productId} className="border-b border-border">
                  <td className="py-2 text-foreground">{l.productName}</td>
                  <td className="py-2 text-right text-foreground">
                    {formatQuantity(l.quantity)} {UNIT_LABELS_RU[l.unit]}
                  </td>
                  <td className="py-2 text-right text-muted">{formatMoney(l.unitPrice)}</td>
                  <td className="py-2 text-right text-foreground">{formatMoney(l.subtotal)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="py-2 font-medium text-foreground">
                  Итого
                </td>
                <td className="py-2 text-right font-semibold text-foreground">{formatMoney(opened.total)}</td>
              </tr>
            </tbody>
          </table>
          {!printOnly && opened.documents.length > 1 && (
            <div className="mt-4 text-sm">
              <p className="mb-1 font-medium text-foreground">Документы</p>
              <ul className="space-y-0.5 text-muted">
                {opened.documents.map((d, i) => (
                  <li key={i}>
                    {timeLabel(d.at)} · {d.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!printOnly && opened.revisions.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="mb-1 font-medium text-foreground">История изменений</p>
              <ul className="space-y-1 text-muted">
                {opened.revisions.map((r, i) => (
                  <li key={i}>
                    {timeLabel(r.at)} · {r.byName}: {r.changes.map((c) => `${c.productName} ${formatQuantity(c.before)} → ${formatQuantity(c.after)}`).join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {opened.editable && !printOnly && (
              <button type="button" onClick={() => cancel(opened)} className="rounded-xl border border-red-300 px-3.5 py-2 text-sm text-red-700 hover:bg-red-50">
                Отменить накладную
              </button>
            )}
            {(opened.editable || (day.autoPost && opened.correctable)) && !printOnly && (
              <a href={`/baker?note=${opened.id}`} className={button}>
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
                {opened.editable ? "Изменить" : "Исправить проведённую"}
              </a>
            )}
            <button type="button" onClick={() => printNow([opened], false)} className={button}>
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Печать
            </button>
            {!printOnly && (
              <button
                type="button"
                onClick={() => {
                  void laptop.send([opened], pack);
                  setOpened(null);
                }}
                className={button}
              >
                <Laptop className="h-4 w-4" strokeWidth={1.75} />
                На ноутбук выдачи
              </button>
            )}
            <button type="button" onClick={() => setSharing([opened])} className={button}>
              <Send className="h-4 w-4" strokeWidth={1.75} />
              Отправить в WhatsApp
            </button>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal title={`Провести день ${dayLabel(preview.day)} — ${preview.sourceLocationName}`} onClose={() => !busy && setPreview(null)} width="max-w-3xl">
          {preview.blockers.map((b) => (
            <div key={b} className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {b}
            </div>
          ))}
          {preview.warnings.map((w) => (
            <div key={w} className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {w}
            </div>
          ))}

          {preview.output.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Выпуск</h3>
              <table className="mb-5 w-full text-sm" data-wide="">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 font-medium">Товар</th>
                    <th className="py-2 text-right font-medium">Отгружено</th>
                    <th className="py-2 text-right font-medium">Холодильник</th>
                    <th className="py-2 text-right font-medium">Было</th>
                    <th className="py-2 text-right font-medium">Выпуск</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.output.map((l) => (
                    <tr key={l.productId} className="border-b border-border">
                      <td className="py-1.5 text-foreground">
                        {l.productName}
                        {l.output > 0 && !l.hasRecipe && <span className="ml-2 text-xs text-red-700">нет техкарты</span>}
                      </td>
                      <td className="py-1.5 text-right text-foreground">{formatQuantity(l.shipped)}</td>
                      <td className="py-1.5 text-right text-foreground">{formatQuantity(l.fridge)}</td>
                      <td className="py-1.5 text-right text-muted">{formatQuantity(l.onHand)}</td>
                      <td className="py-1.5 text-right font-semibold text-foreground">
                        {formatQuantity(l.output)} {UNIT_LABELS_RU[l.unit]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {preview.release && preview.release.materials.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Сырьё <span className="font-normal text-muted">· себестоимость выпуска {formatMoney(preview.release.totalCost)}</span>
              </h3>
              <table className="mb-5 w-full text-sm" data-wide="">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 font-medium">Сырьё</th>
                    <th className="py-2 text-right font-medium">По норме</th>
                    <th className="py-2 text-right font-medium">На производстве</th>
                    <th className="py-2 text-right font-medium">Не хватает</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.release.materials.map((m) => (
                    <tr key={m.productId} className={clsx("border-b border-border", m.shortage > 0 && "bg-red-50")}>
                      <td className="py-1.5 text-foreground">{m.name}</td>
                      <td className="py-1.5 text-right text-foreground">
                        {formatQuantity(m.quantity)} {UNIT_LABELS_RU[m.unit]}
                      </td>
                      <td className="py-1.5 text-right text-muted">{formatQuantity(m.onHand)}</td>
                      <td className={clsx("py-1.5 text-right", m.shortage > 0 ? "font-semibold text-red-700" : "text-muted")}>{m.shortage > 0 ? formatQuantity(m.shortage) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {preview.documents.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Документы</h3>
              <ul className="mb-5 space-y-1 text-sm">
                {preview.documents.map((d) => (
                  <li key={d.noteId} className="flex justify-between gap-3 border-b border-border py-1.5">
                    <span className="text-foreground">
                      № {d.number} → {d.recipient.name}
                      <span className="ml-2 text-xs text-muted">{d.recipient.kind === "customer" ? "продажа оптовику в долг" : "перемещение на точку"}</span>
                    </span>
                    <span className="shrink-0 text-foreground">{formatMoney(d.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className={button}>
              Закрыть
            </button>
            <button
              type="button"
              data-submit=""
              onClick={post}
              disabled={busy || preview.blockers.length > 0}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Проводим…" : "Провести"}
            </button>
          </div>
        </Modal>
      )}
      {sharing && <WaybillShareModal load={async () => sharing.map((n) => bakerNoteWaybill(n))} onClose={() => setSharing(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

// «Напечатана 10:42» / «Изменена после печати» / «Не печаталась» — what is already on paper and what is new.
// «Рейс»: the bakers press «Рейс готов» on their phones; when all have, the new notes print on the door
// laptop. Here: who is still awaited, and «Запустить рейс сейчас» when one of them is not working today.
function TripPanel({ onLaunched }: { onLaunched: () => void }) {
  const [trip, setTrip] = useState<BakerTripStateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api.baker.trip().then(setTrip).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  if (!trip || (!trip.waiting && !trip.last)) return null;
  const at = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
  const launch = async () => {
    if (!window.confirm("Запустить рейс, не дожидаясь остальных пекарей? Новые накладные уйдут на печать на ноутбуке выдачи.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.baker.tripLaunch();
      setTrip(res.state);
      onLaunched();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось запустить рейс");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={clsx("mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 text-sm", trip.waiting ? "bg-amber-50 text-amber-900" : "bg-surface-muted text-foreground")}>
      <Truck className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      {trip.waiting ? (
        <span className="min-w-0 flex-1">
          <b>Рейс {trip.waiting.number} ждёт:</b> {trip.waiting.missing.map((m) => m.userName).join(", ") || "—"}
          <span className="text-amber-800"> · нажали: {trip.waiting.confirmed.map((c) => `${c.userName} (${at(c.at)})`).join(", ")}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <b>Рейс {trip.last!.number}</b> запущен в {at(trip.last!.launchedAt!)} · накладных {trip.last!.noteCount}
          {trip.last!.forcedByName && <span className="text-muted"> · без ожидания: {trip.last!.forcedByName}</span>}
        </span>
      )}
      {trip.waiting && trip.canForce && (
        <button type="button" disabled={busy} onClick={launch} className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
          Запустить рейс сейчас
        </button>
      )}
      {error && <span className="w-full text-red-700">{error}</span>}
    </div>
  );
}

// «Проводить накладные сразу» (owner / admin): a sent note posts itself after the delay, so the books
// keep up with the shelf during the day; «Провести день» is then left with the fridge.
function AutoPostSettings({ day, onSaved }: { day: BakerDayDto; onSaved: () => void }) {
  const [delay, setDelay] = useState(String(day.autoPostDelayMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDelay(String(day.autoPostDelayMinutes)), [day.autoPostDelayMinutes]);
  const save = async (autoPost: boolean, minutes: number) => {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > BAKER_AUTO_POST_MAX_DELAY) {
      setError(`Задержка — от 0 до ${BAKER_AUTO_POST_MAX_DELAY} минут`);
      return;
    }
    if (autoPost && !day.autoPost && !window.confirm("Включить? Каждая новая накладная пекаря будет проводиться сама: выпуск, перемещение на точку или продажа клиенту в долг — через указанное число минут после отправки.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.baker.saveSettings({ autoPost, delayMinutes: minutes });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={day.autoPost} disabled={busy} onChange={(e) => void save(e.target.checked, Number(delay))} className="h-4 w-4 accent-[var(--accent)]" />
        Проводить накладные пекарей сразу
      </label>
      <label className="flex items-center gap-2 text-muted">
        Задержка, мин
        <input
          value={delay}
          onChange={(e) => setDelay(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-center text-foreground outline-none focus:border-accent"
        />
      </label>
      {Number(delay) !== day.autoPostDelayMinutes && delay !== "" && (
        <button type="button" disabled={busy} onClick={() => void save(day.autoPost, Number(delay))} className="rounded-lg border border-border px-3 py-1 hover:bg-surface-muted disabled:opacity-50">
          Сохранить
        </button>
      )}
      {error && <span className="w-full text-red-700">{error}</span>}
    </div>
  );
}

function PrintMark({ note, long = false }: { note: BakerNoteDto; long?: boolean }) {
  const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
  if (note.printCount === 0 || !note.printedAt) return <span className={clsx(pill, "bg-rose-50 text-rose-700")}>Не печаталась</span>;
  const at = new Date(note.printedAt);
  const sameDay = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" }) === note.day;
  // A note printed on another day than its own shows that day too.
  const when = at.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit", ...(sameDay ? {} : { day: "2-digit", month: "2-digit" }) });
  const times = note.printCount % 10 >= 2 && note.printCount % 10 <= 4 && (note.printCount % 100 < 12 || note.printCount % 100 > 14) ? "раза" : "раз";
  if (note.changedSincePrint) {
    return <span className={clsx(pill, "bg-amber-50 text-amber-800")}>Изменена после печати{long ? ` (печать в ${when})` : ""}</span>;
  }
  return (
    <span className={clsx(pill, "bg-sky-50 text-sky-700")}>
      <Printer className="h-3 w-3" strokeWidth={2} />
      Напечатана {when}
      {note.printCount > 1 ? ` · ${note.printCount} ${times}` : ""}
      {long && note.printedByName ? ` · ${note.printedByName}` : ""}
    </span>
  );
}
