"use client";

import { useState } from "react";
import type { CashAccountDto, FinanceCategoryDto } from "@bakery-os/shared";
import { FinanceCategoryKind, isFullyClassified } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Modal } from "@/components/modal";

const OWNER = "__owner_withdrawal__";
const input =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// «Корректировка остатка»: the counted balance of one account against the books; the
// difference is ONE new movement on today's date (nothing earlier is changed), booked to
// the article chosen — a shortage nobody can trace to «Изъятие собственника».
export function CashAdjustmentModal({
  account,
  categories,
  onClose,
  onSaved,
}: {
  account: CashAccountDto;
  categories: FinanceCategoryDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [actual, setActual] = useState("");
  const [target, setTarget] = useState(OWNER);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = Number(actual.replace(/\s/g, "").replace(",", "."));
  const valid = actual.trim() !== "" && Number.isFinite(value) && value >= 0;
  const delta = valid ? Math.round((value - account.currentBalance) * 100) / 100 : null;
  const shortage = delta !== null && delta < 0;
  const kind = shortage ? FinanceCategoryKind.EXPENSE : FinanceCategoryKind.INCOME;
  const usable = categories.filter((c) => c.isActive && c.kind === kind && isFullyClassified(c));
  const chosen = shortage && target === OWNER ? OWNER : usable.some((c) => c.id === target) ? target : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (delta === null || delta === 0 || !chosen) return;
    setError(null);
    setBusy(true);
    try {
      await api.finance.movements.adjust({
        accountId: account.id,
        actualBalance: value,
        reason: reason.trim(),
        ...(chosen === OWNER ? { ownerWithdrawal: true } : { categoryId: chosen }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести корректировку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Корректировка остатка · ${account.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <span className="text-muted">По учёту</span>
          <span className="font-semibold text-foreground">{formatMoney(account.currentBalance)}</span>
        </div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">Фактический остаток, ₸</label>
        <input autoFocus inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} className={input} />
        {delta !== null && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm">
            <span className="text-muted">{delta < 0 ? "Недостача" : delta > 0 ? "Излишек" : "Расхождения нет"}</span>
            <span className={delta < 0 ? "font-semibold text-red-700" : delta > 0 ? "font-semibold text-emerald-700" : "font-semibold text-foreground"}>
              {formatMoney(delta)}
            </span>
          </div>
        )}
        {delta !== null && delta !== 0 && (
          <>
            <label className="mb-1.5 mt-4 block text-sm font-medium text-foreground">Статья</label>
            <select value={chosen} onChange={(e) => setTarget(e.target.value)} className={input}>
              {!chosen && <option value="">Выберите статью</option>}
              {shortage && <option value={OWNER}>Изъятие собственника</option>}
              {usable
                .filter((c) => !(shortage && c.name === "Изъятие собственника"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} ` : ""}
                    {c.name}
                  </option>
                ))}
            </select>
          </>
        )}
        <label className="mb-1.5 mt-4 block text-sm font-medium text-foreground">Основание</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Пересчёт кассы 04.11" className={input} />
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          data-submit
          disabled={busy || delta === null || delta === 0 || !chosen || reason.trim().length < 3}
          className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Проводим…" : "Провести корректировку"}
        </button>
      </form>
    </Modal>
  );
}
