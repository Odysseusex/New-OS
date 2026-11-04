"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { LocationDto, TillShiftDetailDto, TillShiftDto } from "@bakery-os/shared";
import { ORG_WIDE_ROLES, PAYMENT_METHOD_LABELS_RU, PaymentMethod, TILL_SHIFT_HISTORY_ROLES, TILL_SHIFT_SETTINGS_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PeriodPicker } from "@/components/period-picker";
import { periodLabel, periodRange, type PeriodValue } from "@/lib/period";
import { formatDateTime, formatMoney } from "@/lib/format";
import { downloadTable, withExportTarget } from "@/lib/export-table";
import { Modal } from "@/components/modal";

// Продажи → «Смены»: every till shift with its opening, expected and counted
// cash and the difference; a row opens its Z-отчёт (an open shift: the X-отчёт).
export default function TillShiftsPage() {
  const { user } = useAuth();
  const canView = user ? TILL_SHIFT_HISTORY_ROLES.includes(user.role) : false;
  const canSwitch = user ? TILL_SHIFT_SETTINGS_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const [period, setPeriod] = useState<PeriodValue>("30d");
  const range = useMemo(() => periodRange(period), [period]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationId, setLocationId] = useState("");
  const [shifts, setShifts] = useState<TillShiftDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [required, setRequired] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<TillShiftDetailDto | null>(null);

  useEffect(() => {
    if (isOrgWide) api.locations.list().then(setLocations).catch(() => {});
  }, [isOrgWide]);

  useEffect(() => {
    if (!canView) return;
    setError(null);
    api.tillShifts
      .list(range.from.toISOString(), range.to.toISOString(), locationId || undefined)
      .then(setShifts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить смены"));
  }, [canView, range, locationId]);

  // The switch's state comes with the till's view of any point.
  useEffect(() => {
    const loc = locationId || user?.locationId || locations[0]?.id;
    if (!loc || !canView) return;
    api.tillShifts.current(loc).then((s) => setRequired(s.required)).catch(() => {});
  }, [locationId, locations, user, canView]);

  if (!canView) return <p className="text-sm text-muted">Нет доступа</p>;

  function exportShifts() {
    if (!shifts) return;
    void downloadTable(
      `smeny-${period}`,
      ["№", "Точка", "Открыта", "Кассир", "На начало", "Закрыта", "Закрыл", "Расчёт", "Посчитано", "Расхождение"],
      shifts.map((s) => [s.number, s.locationName, formatDateTime(s.openedAt), s.openedByName, s.openingCash, s.closedAt ? formatDateTime(s.closedAt) : "открыта", s.closedByName ?? "", s.expectedCash ?? "", s.countedCash ?? "", s.difference ?? ""]),
      { sheetName: "Смены", titleLines: [`Кассовые смены · ${periodLabel(period)}`] },
    );
  }

  const shortage = (shifts ?? []).reduce((s, x) => s + Math.min(x.difference ?? 0, 0), 0);
  const surplus = (shifts ?? []).reduce((s, x) => s + Math.max(x.difference ?? 0, 0), 0);

  return (
    <div>
      <Link href="/sales" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Продажи
      </Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Кассовые смены</h1>
        {canSwitch && required !== null && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={required}
              onChange={async (e) => {
                const next = e.target.checked;
                try {
                  setRequired((await api.tillShifts.setRequired(next)).required);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
                }
              }}
            />
            Продажа на кассе только в открытой смене
          </label>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        {isOrgWide && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground">
            <option value="">Вся сеть</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
        <button onClick={exportShifts} disabled={!shifts?.length} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-40">
          Excel
        </button>
        <button onClick={() => withExportTarget("pdf", exportShifts)} disabled={!shifts?.length} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-40">
          PDF
        </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {shifts && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Смен" value={String(shifts.length)} />
            <Stat label="Недостачи" value={formatMoney(shortage)} tone={shortage < 0 ? "text-red-700" : undefined} />
            <Stat label="Излишки" value={formatMoney(surplus)} tone={surplus > 0 ? "text-emerald-700" : undefined} />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">№</th>
                  <th className="px-4 py-2.5 font-medium">Точка</th>
                  <th className="px-4 py-2.5 font-medium">Открыта</th>
                  <th className="px-4 py-2.5 font-medium">Закрыта</th>
                  <th className="px-4 py-2.5 text-right font-medium">На начало</th>
                  <th className="px-4 py-2.5 text-right font-medium">Расчёт</th>
                  <th className="px-4 py-2.5 text-right font-medium">Посчитано</th>
                  <th className="px-4 py-2.5 text-right font-medium">Расхождение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shifts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted">
                      Смен за период нет
                    </td>
                  </tr>
                )}
                {shifts.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => api.tillShifts.detail(s.id).then(setDetail).catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось открыть смену"))}
                    className="cursor-pointer hover:bg-surface-muted"
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground">{s.number}</td>
                    <td className="px-4 py-2.5 text-muted">{s.locationName}</td>
                    <td className="px-4 py-2.5 text-foreground">
                      {formatDateTime(s.openedAt)}
                      <span className="ml-1.5 text-xs text-muted">{s.openedByName}</span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{s.closedAt ? formatDateTime(s.closedAt) : <span className="text-emerald-700">открыта</span>}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{formatMoney(s.openingCash)}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{s.expectedCash === null ? "—" : formatMoney(s.expectedCash)}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{s.countedCash === null ? "—" : formatMoney(s.countedCash)}</td>
                    <td className={clsx("px-4 py-2.5 text-right font-medium", (s.difference ?? 0) < 0 ? "text-red-700" : (s.difference ?? 0) > 0 ? "text-emerald-700" : "text-muted")}>
                      {s.difference === null ? "—" : formatMoney(s.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <Modal title={`${detail.closedAt ? "Z-отчёт" : "X-отчёт"} · смена №${detail.number} · ${detail.locationName}`} onClose={() => setDetail(null)} width="max-w-xl">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <Row label="Чеков" value={String(detail.report.checks)} />
              <Row label="Выручка" value={formatMoney(detail.report.revenue)} bold />
              {detail.report.tenders.map((t) => (
                <Row key={t.method} label={PAYMENT_METHOD_LABELS_RU[t.method as PaymentMethod] ?? t.method} value={`${formatMoney(t.sales)}${t.refunds ? ` (возвраты ${formatMoney(t.refunds)})` : ""}`} />
              ))}
              <Row label="Наличные на начало смены" value={formatMoney(detail.report.openingCash)} />
              {detail.report.cashMoves.map((m, i) => (
                <Row key={i} label={`${m.amount > 0 ? "Внесение" : "Выемка"} · ${m.comment ?? ""}`} value={formatMoney(m.amount)} />
              ))}
              <Row label="Должно быть в кассе" value={formatMoney(detail.report.expectedCash)} bold />
              {detail.countedCash !== null && <Row label="Посчитано" value={formatMoney(detail.countedCash)} bold />}
              {detail.difference !== null && <Row label="Расхождение" value={formatMoney(detail.difference)} bold />}
              {detail.note && <Row label="Комментарий" value={detail.note} />}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={clsx(bold && "font-semibold")}>
      <td className="py-2 text-foreground">{label}</td>
      <td className="py-2 text-right text-foreground">{value}</td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}
