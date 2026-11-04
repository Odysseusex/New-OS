"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { FileText } from "lucide-react";
import type { ProductionBatchDocumentDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney, formatMoneyPrecise, formatQuantity } from "@/lib/format";
import { downloadTable, withExportTarget } from "@/lib/export-table";

const signed = (v: number) => (v > 0 ? `+${formatQuantity(v)}` : formatQuantity(v));
const signedMoney = (v: number) => (v > 0 ? `+${formatMoney(v)}` : formatMoney(v));

// «Акт выпуска» of a completed batch: raw material written off per ingredient,
// the batch cost and the cost of one unit, and the deviation from the recipe.
export function ProductionDocumentModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [doc, setDoc] = useState<ProductionBatchDocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.production
      .batchDocument(batchId)
      .then(setDoc)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить акт выпуска"));
  }, [batchId]);

  function print() {
    if (!doc) return;
    withExportTarget("pdf", () =>
      downloadTable(
        `akt-vypuska-${doc.batchId}`,
        ["Сырьё", "Ед.", "Норма", "Факт", "Цена списания", "Сумма", "Отклонение", "Отклонение, ₸"],
        [
          ...doc.lines.map((l) => [
            l.ingredientName,
            UNIT_LABELS_RU[l.unit],
            l.norm,
            l.actual,
            l.unitCost ?? "—",
            l.actualAmount ?? "—",
            l.deviation,
            l.deviationValue ?? "—",
          ]),
          ...(doc.untrackedCost > 0 ? [["Прочее (не учитывается на складе)", "", "", "", "", doc.untrackedCost, "", ""]] : []),
        ],
        {
          sheetName: "Акт выпуска",
          titleLines: [
            `Акт выпуска: ${doc.productName} — ${formatQuantity(doc.actualQuantity)} ${UNIT_LABELS_RU[doc.unit]}`,
            `${formatDateTime(doc.completedAt)} · ${doc.locationName}${doc.outputLocationName !== doc.locationName ? ` → ${doc.outputLocationName}` : ""}${doc.recipeVersionNumber ? ` · техкарта, версия ${doc.recipeVersionNumber}` : ""}`,
            `Себестоимость партии: ${doc.batchCost === null ? "—" : formatMoney(doc.batchCost)} · себестоимость единицы: ${doc.unitCost === null ? "—" : formatMoney(doc.unitCost)}`,
          ],
        },
      ),
    );
  }

  return (
    <Modal title="Акт выпуска" onClose={onClose} width="max-w-3xl">
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!doc && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {doc && (
        <>
          <p className="mb-4 text-sm text-muted">
            <span className="font-medium text-foreground">
              {doc.productName} — {formatQuantity(doc.actualQuantity)} {UNIT_LABELS_RU[doc.unit]}
            </span>{" "}
            (план {formatQuantity(doc.plannedQuantity)}) · {formatDateTime(doc.completedAt)} · {doc.locationName}
            {doc.outputLocationName !== doc.locationName && ` → оприходовано: ${doc.outputLocationName}`}
            {doc.recipeVersionNumber !== null && ` · техкарта, версия ${doc.recipeVersionNumber}`} · {doc.createdByName}
          </p>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Сырьё</th>
                  <th className="py-2 pr-3 text-right font-medium">Норма</th>
                  <th className="py-2 pr-3 text-right font-medium">Факт</th>
                  <th className="py-2 pr-3 text-right font-medium">Цена списания</th>
                  <th className="py-2 pr-3 text-right font-medium">Сумма</th>
                  <th className="py-2 text-right font-medium">Отклонение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {doc.lines.map((l) => (
                  <tr key={l.ingredientId}>
                    <td className="py-2 pr-3 text-foreground">{l.ingredientName}</td>
                    <td className="py-2 pr-3 text-right text-muted">
                      {formatQuantity(l.norm)} {UNIT_LABELS_RU[l.unit]}
                    </td>
                    <td className="py-2 pr-3 text-right text-foreground">
                      {formatQuantity(l.actual)} {UNIT_LABELS_RU[l.unit]}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted">{l.unitCost === null ? "—" : formatMoneyPrecise(l.unitCost)}</td>
                    <td className="py-2 pr-3 text-right text-foreground">{l.actualAmount === null ? "—" : formatMoney(l.actualAmount)}</td>
                    <td className={clsx("py-2 text-right", l.deviation > 0 ? "text-red-600" : l.deviation < 0 ? "text-emerald-700" : "text-muted")}>
                      {l.deviation === 0 ? "—" : `${signed(l.deviation)} ${UNIT_LABELS_RU[l.unit]}${l.deviationValue !== null ? ` · ${signedMoney(l.deviationValue)}` : ""}`}
                    </td>
                  </tr>
                ))}
                {doc.untrackedCost > 0 && (
                  <tr>
                    <td className="py-2 pr-3 text-muted">Прочее (не учитывается на складе)</td>
                    <td colSpan={3} />
                    <td className="py-2 pr-3 text-right text-foreground">{formatMoney(doc.untrackedCost)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-muted px-4 py-3">
              <p className="text-xs text-muted">Себестоимость партии</p>
              <p className="text-lg font-semibold text-foreground">{doc.batchCost === null ? "—" : formatMoney(doc.batchCost)}</p>
            </div>
            <div className="rounded-xl bg-surface-muted px-4 py-3">
              <p className="text-xs text-muted">Себестоимость единицы</p>
              <p className="text-lg font-semibold text-foreground">{doc.unitCost === null ? "—" : formatMoney(doc.unitCost)}</p>
            </div>
            <div className="rounded-xl bg-surface-muted px-4 py-3">
              <p className="text-xs text-muted">Отклонение от техкарты</p>
              <p className={clsx("text-lg font-semibold", doc.deviationValue > 0 ? "text-red-600" : doc.deviationValue < 0 ? "text-emerald-700" : "text-foreground")}>
                {signedMoney(doc.deviationValue)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={print}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            Печать
          </button>
        </>
      )}
    </Modal>
  );
}
