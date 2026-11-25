"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Camera, Images, X } from "lucide-react";
import type { BakerCatalogDto, SupplierIntakeDto } from "@bakery-os/shared";
import {
  SUPPLIER_INTAKE_MAX_PHOTOS,
  SUPPLIER_INTAKE_PAYMENT_LABELS_RU,
  SUPPLIER_INTAKE_STATUS_LABELS_RU,
  SupplierIntakePayment,
  SupplierIntakeStatus,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { shrinkIntakePhoto } from "@/lib/intake-photo";

const PAYMENTS = [SupplierIntakePayment.CASH, SupplierIntakePayment.KASPI, SupplierIntakePayment.BCC, SupplierIntakePayment.CREDIT];
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type Shot = { key: string; dataUrl: string };

// «Приход от поставщика»: photograph the supplier's накладная, say where it was brought and how it was
// paid, send. It is a draft for whoever enters the goods — nothing moves here.
export function IntakeForm({
  catalog,
  onBack,
  onDone,
  onExpired,
}: {
  catalog: BakerCatalogDto;
  onBack: () => void;
  onDone: (text: string) => void;
  onExpired: () => void;
}) {
  const places = [
    { id: catalog.sourceLocationId, name: catalog.sourceLocationName },
    ...catalog.recipients.filter((r) => r.kind === "location").map((r) => ({ id: r.id, name: r.name })),
  ];
  const [shots, setShots] = useState<Shot[]>([]);
  const [locationId, setLocationId] = useState(places[0].id);
  const [payment, setPayment] = useState<SupplierIntakePayment | null>(null);
  const [supplier, setSupplier] = useState("");
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An intake already created by a failed attempt, and how many of its photos reached the server:
  // «Отправить» again continues it instead of making a second one.
  const started = useRef<{ id: string; uploaded: number } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy("Готовим фото…");
    try {
      const room = SUPPLIER_INTAKE_MAX_PHOTOS - shots.length;
      const picked = Array.from(files).slice(0, Math.max(room, 0));
      if (picked.length < files.length) setError(`Не больше ${SUPPLIER_INTAKE_MAX_PHOTOS} фото в одном приходе`);
      const next: Shot[] = [];
      for (const file of picked) next.push({ key: `${Date.now()}-${Math.random()}`, dataUrl: await shrinkIntakePhoto(file) });
      setShots((cur) => [...cur, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить фото");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy) return;
    if (shots.length === 0) return setError("Сфотографируйте накладную");
    if (!payment) return setError("Выберите, как оплатили");
    const sum = total.trim() ? Number(total.trim().replace(/\s/g, "").replace(",", ".")) : undefined;
    if (sum !== undefined && !(Number.isFinite(sum) && sum >= 0)) return setError("Проверьте итог с накладной");
    setError(null);
    try {
      if (!started.current) {
        setBusy("Отправляем…");
        const created = await api.baker.createIntake({
          locationId,
          payment,
          supplierName: supplier.trim() || undefined,
          total: sum === undefined ? undefined : Math.round(sum * 100) / 100,
        });
        started.current = { id: created.id, uploaded: 0 };
      }
      const job = started.current;
      for (let i = job.uploaded; i < shots.length; i += 1) {
        setBusy(`Фото ${i + 1} из ${shots.length}…`);
        await api.baker.addIntakePhoto(job.id, shots[i].dataUrl);
        job.uploaded = i + 1;
      }
      setBusy("Отправляем…");
      const sent = await api.baker.sendIntake(job.id);
      onDone(`Приход № ${sent.number} отправлен: ${sent.photos.length} фото, ${sent.locationName}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onExpired();
      setError(err instanceof ApiError ? err.message : "Не удалось отправить. Проверьте интернет и нажмите «Отправить» ещё раз — фото сохранены.");
    } finally {
      setBusy(null);
    }
  }

  const locked = started.current !== null;
  const choice = (active: boolean) =>
    clsx("min-h-[3.5rem] rounded-2xl border px-3 py-2 text-lg font-medium", active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground");
  const field = "h-14 w-full rounded-2xl border border-border bg-surface px-4 text-lg text-foreground outline-none focus:border-accent";

  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-xl flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background px-3 py-3">
        <button type="button" onClick={onBack} aria-label="Назад" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
          <ArrowLeft className="h-6 w-6" strokeWidth={1.75} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-foreground">Приход от поставщика</h1>
          <p className="truncate text-base text-muted">Фото накладной</p>
        </div>
      </header>

      <div className="flex-1 px-4 pb-32 pt-4">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />

        {shots.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {shots.map((s, i) => (
              <div key={s.key} className="relative overflow-hidden rounded-2xl border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.dataUrl} alt={`Фото ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => setShots((cur) => cur.filter((x) => x.key !== s.key))}
                    aria-label={`Убрать фото ${i + 1}`}
                    className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground shadow-card"
                  >
                    <X className="h-5 w-5" strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!locked && shots.length < SUPPLIER_INTAKE_MAX_PHOTOS && (
          <div className="mb-6 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={!!busy} className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-accent text-lg font-semibold text-accent-foreground disabled:opacity-50">
              <Camera className="h-7 w-7" strokeWidth={1.75} />
              {shots.length === 0 ? "Сфотографировать" : "Ещё страница"}
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={!!busy} className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-surface text-lg font-medium text-foreground disabled:opacity-50">
              <Images className="h-7 w-7" strokeWidth={1.75} />
              Из галереи
            </button>
          </div>
        )}

        <h2 className="mb-2 text-base font-semibold text-muted">Куда привезли</h2>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {places.map((p) => (
            <button key={p.id} type="button" disabled={locked} onClick={() => setLocationId(p.id)} className={choice(locationId === p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        <h2 className="mb-2 text-base font-semibold text-muted">Как оплатили</h2>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {PAYMENTS.map((p) => (
            <button key={p} type="button" disabled={locked} onClick={() => { setPayment(p); setError(null); }} className={choice(payment === p)}>
              {SUPPLIER_INTAKE_PAYMENT_LABELS_RU[p]}
            </button>
          ))}
        </div>

        <h2 className="mb-2 text-base font-semibold text-muted">Если знаете</h2>
        <div className="space-y-2">
          <input value={supplier} disabled={locked} onChange={(e) => setSupplier(e.target.value)} placeholder="Поставщик" maxLength={120} className={field} />
          <input
            value={total}
            disabled={locked}
            onChange={(e) => setTotal(e.target.value.replace(/[^\d.,\s]/g, ""))}
            inputMode="decimal"
            placeholder="Итог с накладной, ₸"
            className={field}
          />
        </div>
        {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <p className="min-w-0 flex-1 text-base text-muted">Фото: {shots.length}</p>
          <button type="button" onClick={send} disabled={!!busy} className="h-16 shrink-0 rounded-2xl bg-accent px-8 text-xl font-semibold text-accent-foreground disabled:opacity-40">
            {busy ?? "Отправить"}
          </button>
        </div>
      </footer>
    </main>
  );
}

// The baker's own intakes of the last days with what became of each.
export function MyIntakes({ intakes }: { intakes: SupplierIntakeDto[] }) {
  if (intakes.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-semibold text-foreground">Мои приходы</h2>
      <ul className="space-y-2">
        {intakes.map((i) => (
          <li key={i.id} className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-lg font-semibold leading-snug text-foreground">
              № {i.number} · {i.locationName}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted">
              <span>
                {timeLabel(i.createdAt)} · фото {i.photos.length} · {SUPPLIER_INTAKE_PAYMENT_LABELS_RU[i.payment]}
                {i.total !== null ? ` · ${formatMoney(i.total)}` : ""}
              </span>
              <span
                className={clsx(
                  "rounded-full px-3 py-1 text-sm font-medium",
                  i.status === SupplierIntakeStatus.POSTED ? "bg-green-50 text-green-700" : i.status === SupplierIntakeStatus.REJECTED ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
                )}
              >
                {SUPPLIER_INTAKE_STATUS_LABELS_RU[i.status]}
              </span>
            </p>
            {i.status === SupplierIntakeStatus.REJECTED && i.rejectReason && <p className="mt-2 text-base text-red-700">Причина: {i.rejectReason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
