"use client";

import { useState } from "react";
import {
  BALANCE_TREATMENT_LABELS_RU,
  BalanceTreatment,
  CASH_ACTIVITY_LABELS_RU,
  CashActivity,
  FinanceCategoryKind,
  PNL_TREATMENT_LABELS_RU,
  PnlTreatment,
  validateClassification,
} from "@bakery-os/shared";
import type { FinanceCategoryDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

const selectClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// Three independent answers about one category: how it shows in the ОПиУ,
// which section of the ДДС its money belongs to, and what it does to the
// баланс. Saved together, checked for coherence before the request is sent
// (and again on the server).
export function CategoryClassificationModal({
  category,
  onClose,
  onSaved,
}: {
  category: FinanceCategoryDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pnl, setPnl] = useState<PnlTreatment>(category.pnlTreatment);
  const [cash, setCash] = useState<CashActivity>(category.cashActivity);
  const [balance, setBalance] = useState<BalanceTreatment>(category.balanceTreatment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const problem = validateClassification(category.kind as FinanceCategoryKind, {
    pnlTreatment: pnl,
    cashActivity: cash,
    balanceTreatment: balance,
  });

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.finance.categories.setClassification(category.id, {
        pnlTreatment: pnl,
        cashActivity: cash,
        balanceTreatment: balance,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить классификацию");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Классификация — ${category.name}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Отчёт о прибылях и убытках</span>
          <select className={selectClass} value={pnl} onChange={(e) => setPnl(e.target.value as PnlTreatment)}>
            {Object.values(PnlTreatment).map((v) => (
              <option key={v} value={v}>
                {PNL_TREATMENT_LABELS_RU[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Отчёт о движении денежных средств</span>
          <select className={selectClass} value={cash} onChange={(e) => setCash(e.target.value as CashActivity)}>
            {Object.values(CashActivity).map((v) => (
              <option key={v} value={v}>
                {CASH_ACTIVITY_LABELS_RU[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Баланс</span>
          <select
            className={selectClass}
            value={balance}
            onChange={(e) => setBalance(e.target.value as BalanceTreatment)}
          >
            {Object.values(BalanceTreatment).map((v) => (
              <option key={v} value={v}>
                {BALANCE_TREATMENT_LABELS_RU[v]}
              </option>
            ))}
          </select>
        </label>

        {(error || problem) && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? problem}</p>}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            onClick={save}
            disabled={saving || !!problem}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
