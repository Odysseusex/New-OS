"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { CostCorrectionDto, Unit } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { downloadTable } from "@/lib/export-table";
import { formatDateTime, formatMoneyPrecise, formatQuantity } from "@/lib/format";

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const signed = (v: number) => (v > 0.004 ? `+${formatMoneyPrecise(v)}` : formatMoneyPrecise(v));
const unitLabel = (u: string) => UNIT_LABELS_RU[u as Unit] ?? u;

// Корректировка себестоимости for one month (method «Б»): the month walked day
// by day by document date, every outflow valued again at the average it really
// had. A preview while the month is open; the recorded one once it is closed.
export function CostCorrectionModal({ year, month, onClose }: { year: number; month: number; onClose: () => void }) {
  const [data, setData] = useState<CostCorrectionDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.periods
      .costCorrection(year, month)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось рассчитать корректировку"));
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  function exportExcel(d: CostCorrectionDto) {
    downloadTable(
      `korrektirovka-sebestoimosti-${d.year}-${String(d.month).padStart(2, "0")}.xlsx`,
      [
        "Товар",
        "Ед.",
        "Ушло",
        "Себестоимость продаж по документам",
        "Себестоимость продаж пересчитанная",
        "Потери по документам",
        "Потери пересчитанные",
        "В производство по документам",
        "В производство пересчитанное",
        "Разница",
        "Средняя на начало",
        "Средняя на конец",
      ],
      d.lines.map((l) => [
        l.productName,
        unitLabel(l.unit),
        l.quantityOut,
        l.cogsStamped,
        l.cogsRecomputed,
        l.lossStamped,
        l.lossRecomputed,
        l.productionStamped,
        l.productionRecomputed,
        l.difference,
        l.openingAverage ?? "",
        l.closingAverage ?? "",
      ]),
      {
        sheetName: "Корректировка",
        titleLines: [`Корректировка себестоимости — ${MONTHS_RU[d.month - 1]} ${d.year}`, d.status === "POSTED" ? "Проведена при закрытии периода" : "Предварительный расчёт"],
      },
    );
  }

  return (
    <Modal title={`Корректировка себестоимости — ${MONTHS_RU[month - 1]} ${year}`} onClose={onClose} width="max-w-5xl">
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-8 text-center text-sm text-muted">Расчёт…</p>}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {data.status === "POSTED"
                ? `Проведена при закрытии периода · ${formatDateTime(data.computedAt)}${data.postedByName ? ` · ${data.postedByName}` : ""}${data.version ? ` · версия ${data.version}` : ""}`
                : `Предварительный расчёт на ${formatDateTime(data.computedAt)} — проводится при закрытии периода`}
            </p>
            <button
              type="button"
              onClick={() => exportExcel(data)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              Excel
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Себестоимость продаж" value={signed(data.cogsCorrection)} />
            <Stat label="Потери запасов" value={signed(data.lossCorrection)} />
            <Stat label="Итого корректировка" value={signed(data.totalCorrection)} strong />
          </div>

          {data.unstampedLines > 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Строк без себестоимости в документах: {data.unstampedLines} — не скорректированы
            </p>
          )}

          {data.lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Расхождений нет</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">Товар</th>
                    <th className="px-3 py-2 text-right font-medium">Ушло</th>
                    <th className="px-3 py-2 text-right font-medium">По документам</th>
                    <th className="px-3 py-2 text-right font-medium">Пересчитано</th>
                    <th className="px-3 py-2 text-right font-medium">Разница</th>
                    <th className="px-3 py-2 text-right font-medium">В производство</th>
                    <th className="px-3 py-2 text-right font-medium">Средняя на конец</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.lines.map((l) => {
                    const stamped = l.cogsStamped + l.lossStamped;
                    const recomputed = l.cogsRecomputed + l.lossRecomputed;
                    const production = l.productionRecomputed - l.productionStamped;
                    return (
                      <tr key={l.productId}>
                        <td className="px-3 py-2 text-foreground">
                          {l.productName}
                          {l.unstampedLines > 0 && <span className="ml-2 text-xs text-amber-700">без себестоимости: {l.unstampedLines}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                          {formatQuantity(l.quantityOut)} {unitLabel(l.unit)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{stamped ? formatMoneyPrecise(stamped) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{recomputed ? formatMoneyPrecise(recomputed) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-foreground">{Math.abs(l.difference) >= 0.01 ? signed(l.difference) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{Math.abs(production) >= 0.01 ? signed(production) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                          {l.closingAverage !== null ? formatMoneyPrecise(l.closingAverage) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={strong ? "mt-0.5 text-base font-semibold text-foreground" : "mt-0.5 font-semibold text-foreground"}>{value}</div>
    </div>
  );
}
