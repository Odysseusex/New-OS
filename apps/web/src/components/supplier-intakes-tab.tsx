"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import type { SupplierIntakeDto } from "@bakery-os/shared";
import { SUPPLIER_INTAKE_STATUS_LABELS_RU, SupplierIntakeStatus } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { zonedDateKey } from "@/lib/reporting-period";
import { AuthedImage } from "@/components/authed-image";
import { Modal } from "@/components/modal";

const dayLabel = (key: string) => key.split("-").reverse().join(".");
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });

// Производство → «Приходы»: the suppliers' накладные the bakers photographed. A photo is a draft — the
// goods are entered with the ordinary приёмка / заказ поставщику, then the intake is marked here.
export function SupplierIntakesTab() {
  const [dayKey, setDayKey] = useState(() => zonedDateKey());
  const [pendingOnly, setPendingOnly] = useState(false);
  const [intakes, setIntakes] = useState<SupplierIntakeDto[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ intake: SupplierIntakeDto; index: number } | null>(null);
  const [marking, setMarking] = useState<{ intake: SupplierIntakeDto; as: "POSTED" | "REJECTED" } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setIntakes(null);
      return Promise.all([api.baker.intakes(pendingOnly ? { pending: "true" } : { day: dayKey }), api.baker.intakes({ pending: "true" })])
        .then(([rows, pending]) => {
          setIntakes(rows);
          setWaiting(pending.length);
          setError(null);
        })
        .catch((err) => {
          if (quiet) return;
          setIntakes([]);
          setError(err instanceof ApiError ? err.message : "Не удалось загрузить приходы");
        });
    },
    [dayKey, pendingOnly],
  );
  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // The enlarged photo: Escape closes, arrows turn the pages.
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      if (e.key === "ArrowRight") setViewer((v) => (v ? { ...v, index: Math.min(v.index + 1, v.intake.photos.length - 1) } : v));
      if (e.key === "ArrowLeft") setViewer((v) => (v ? { ...v, index: Math.max(v.index - 1, 0) } : v));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer]);

  async function mark() {
    if (!marking || busy) return;
    setBusy(true);
    try {
      await api.baker.resolveIntake(
        marking.intake.id,
        marking.as === "POSTED" ? { status: SupplierIntakeStatus.POSTED, document: text.trim() } : { status: SupplierIntakeStatus.REJECTED, reason: text.trim() },
      );
      setMarking(null);
      setText("");
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отметить приход");
      setMarking(null);
    } finally {
      setBusy(false);
    }
  }

  const button = "flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={dayKey}
          max={zonedDateKey()}
          disabled={pendingOnly}
          onChange={(e) => e.target.value && setDayKey(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
        />
        <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          Все непроведённые{waiting > 0 ? ` (${waiting})` : ""}
        </label>
        <button type="button" onClick={() => load()} className={button}>
          <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          Обновить
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {intakes === null && <p className="text-sm text-muted">Загрузка…</p>}
      {intakes !== null && intakes.length === 0 && !error && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          {pendingOnly ? "Непроведённых приходов нет" : `За ${dayLabel(dayKey)} приходов нет`}
        </p>
      )}

      <div className="space-y-3">
        {(intakes ?? []).map((i) => (
          <div key={i.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground">
                  Приход № {i.number} · {i.locationName} · {i.paymentLabel}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {dayLabel(i.day)}, {timeLabel(i.createdAt)} · {i.createdByName}
                  {i.supplierName ? ` · поставщик: ${i.supplierName}` : ""}
                  {i.total !== null ? ` · итог ${formatMoney(i.total)}` : ""}
                </p>
              </div>
              <span
                className={clsx(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  i.status === SupplierIntakeStatus.POSTED ? "bg-green-50 text-green-700" : i.status === SupplierIntakeStatus.REJECTED ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
                )}
              >
                {SUPPLIER_INTAKE_STATUS_LABELS_RU[i.status]}
              </span>
            </div>
            {i.status === SupplierIntakeStatus.POSTED && (
              <p className="mt-1 text-sm text-muted">
                {i.document} · {i.resolvedByName}
              </p>
            )}
            {i.status === SupplierIntakeStatus.REJECTED && (
              <p className="mt-1 text-sm text-red-700">
                Причина: {i.rejectReason} · {i.resolvedByName}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {i.photos.map((p, index) => (
                <AuthedImage
                  key={p.id}
                  path={p.path}
                  alt={`Приход № ${i.number}, фото ${index + 1}`}
                  onClick={() => setViewer({ intake: i, index })}
                  className="h-32 w-24 cursor-zoom-in rounded-xl border border-border bg-surface-muted object-cover text-muted"
                />
              ))}
            </div>
            {i.status === SupplierIntakeStatus.SENT && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setText(`Приёмка ${dayLabel(zonedDateKey())}`);
                    setMarking({ intake: i, as: "POSTED" });
                  }}
                  className="rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
                >
                  Отметить «Проведён»
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setText("");
                    setMarking({ intake: i, as: "REJECTED" });
                  }}
                  className="rounded-xl border border-red-300 px-3.5 py-2 text-sm text-red-700 hover:bg-red-50"
                >
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {marking && (
        <Modal title={`${marking.as === "POSTED" ? "Проведён" : "Отклонить"}: приход № ${marking.intake.number}`} onClose={() => !busy && setMarking(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mark();
            }}
          >
            <label className="mb-1.5 block text-sm font-medium text-foreground">{marking.as === "POSTED" ? "Документ" : "Причина"}</label>
            <input
              autoFocus
              required
              minLength={3}
              maxLength={200}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={marking.as === "POSTED" ? "Приёмка, заказ поставщику № …" : "Фото не читается, нет второй страницы…"}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
            <p className="mt-2 text-sm text-muted">
              {marking.as === "POSTED" ? "Отметка склад не двигает: товар проводится обычной приёмкой." : "Причину увидит пекарь."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMarking(null)} disabled={busy} className={button}>
                Отмена
              </button>
              <button type="submit" disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
                {busy ? "Сохраняем…" : marking.as === "POSTED" ? "Проведён" : "Отклонить"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {viewer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90" onClick={() => setViewer(null)} role="dialog" aria-label="Фото накладной">
          <AuthedImage
            path={viewer.intake.photos[viewer.index].path}
            alt={`Приход № ${viewer.intake.number}, фото ${viewer.index + 1}`}
            onClick={() => undefined}
            className="max-h-[94dvh] max-w-[94vw] object-contain text-white"
          />
          <button type="button" onClick={() => setViewer(null)} aria-label="Закрыть" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-black">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
          <p className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-sm text-black">
            № {viewer.intake.number} · фото {viewer.index + 1} из {viewer.intake.photos.length}
          </p>
          {viewer.index > 0 && (
            <button
              type="button"
              aria-label="Предыдущее фото"
              onClick={(e) => {
                e.stopPropagation();
                setViewer({ ...viewer, index: viewer.index - 1 });
              }}
              className="absolute left-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black"
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            </button>
          )}
          {viewer.index < viewer.intake.photos.length - 1 && (
            <button
              type="button"
              aria-label="Следующее фото"
              onClick={(e) => {
                e.stopPropagation();
                setViewer({ ...viewer, index: viewer.index + 1 });
              }}
              className="absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black"
            >
              <ChevronRight className="h-6 w-6" strokeWidth={2} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
