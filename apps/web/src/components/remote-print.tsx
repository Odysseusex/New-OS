"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Laptop, Printer } from "lucide-react";
import type { BakerNoteDto, PrintJobStatusDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { bakerNoteWaybill, printWaybillsInFrame } from "@/lib/waybill";

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
// The laptop asks every few seconds; quieter than this means its screen is closed or the laptop is off.
const LAPTOP_ONLINE_MS = 30_000;
const POLL_MS = 4_000;
// Fired when notes were printed, so an open list refreshes its «Напечатана» marks.
export const NOTES_PRINTED_EVENT = "baker-notes-printed";

// The door laptop («Выдача накладных»): takes print requests sent from a phone or a computer and prints them.
export function RemotePrintAgent() {
  const [last, setLast] = useState<{ at: string; by: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const jobs = await api.baker.pendingPrintJobs();
        setError(null);
        for (const job of jobs) {
          if (stopped) break;
          const { claimed } = await api.baker.claimPrintJob(job.id);
          if (!claimed || job.notes.length === 0) continue;
          await printWaybillsInFrame(
            job.notes.map((n) => bakerNoteWaybill(n)),
            job.pack,
          );
          setLast({ at: new Date().toISOString(), by: job.createdByName, count: job.notes.length });
          // The list below shows the new «Напечатана» marks at once.
          window.dispatchEvent(new Event(NOTES_PRINTED_EVENT));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Нет связи с сервером — повторим через несколько секунд");
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className={clsx("mb-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm", error ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800")}>
      <Printer className="h-4 w-4" strokeWidth={1.75} />
      <span className="font-medium">Печать с телефона включена</span>
      <span>
        {last ? `· последнее: ${timeLabel(last.at)} — ${last.by}, накладных ${last.count}` : "· заданий пока не было"}
      </span>
      {error && <span className="w-full text-xs">{error}</span>}
    </div>
  );
}

type Sent = { job: PrintJobStatusDto; count: number; until: number };

// «На ноутбук выдачи»: sends the chosen notes to the door laptop and follows the request until it is printed.
export function useSendToLaptop() {
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sent || sent.job.claimedAt || Date.now() > sent.until) return;
    const timer = window.setTimeout(() => {
      api.baker
        .printJob(sent.job.id)
        .then((job) => setSent((cur) => (cur && cur.job.id === job.id ? { ...cur, job } : cur)))
        .catch(() => setSent((cur) => (cur ? { ...cur } : cur)));
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [sent]);

  async function send(notes: BakerNoteDto[], pack: boolean) {
    if (notes.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.baker.sendToLaptop({ noteIds: notes.map((n) => n.id), pack });
      setSent({ job, count: notes.length, until: Date.now() + 3 * 60_000 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить на ноутбук выдачи");
    } finally {
      setBusy(false);
    }
  }

  return { send, sent, error, busy, clear: () => (setSent(null), setError(null)) };
}

export function SendToLaptopStatus({ sent, error, onClose }: { sent: Sent | null; error: string | null; onClose: () => void }) {
  if (error) return <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!sent) return null;
  const { job, count } = sent;
  const online = job.laptopSeenAt !== null && Date.now() - new Date(job.laptopSeenAt).getTime() < LAPTOP_ONLINE_MS;
  const printed = job.claimedAt !== null;
  return (
    <div className={clsx("mb-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm", printed ? "bg-green-50 text-green-800" : online ? "bg-surface-muted text-foreground" : "bg-amber-50 text-amber-800")}>
      <Laptop className="h-4 w-4" strokeWidth={1.75} />
      <span>
        {printed
          ? `Ноутбук выдачи напечатал накладных: ${count} (${timeLabel(job.claimedAt!)})`
          : online
            ? `Отправлено на ноутбук выдачи: ${count} — печатается…`
            : `Отправлено: ${count}. Ноутбук выдачи сейчас не на связи — напечатает, как только на нём откроют экран выдачи (в течение 2 часов).`}
      </span>
      <button type="button" onClick={onClose} className="ml-auto text-xs underline">
        Скрыть
      </button>
    </div>
  );
}
