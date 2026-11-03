"use client";

import { useEffect, useState } from "react";
import type { CashAccountDto, CustomerPaymentResultDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";

const fieldClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// «Принять оплату» on a wholesale customer's card: settles their unpaid sales
// oldest first; what is left becomes their advance (counted toward the next sales).
export function CustomerPaymentForm({ customerId, owed, onDone }: { customerId: string; owed: number; onDone: () => void }) {
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerPaymentResultDto | null>(null);

  useEffect(() => {
    api.finance.accounts
      .list()
      .then((list) => {
        const active = list.filter((a) => a.isActive);
        setAccounts(active);
        setAccountId((cur) => cur || active.find((a) => a.isDefault)?.id || active[0]?.id || "");
      })
      .catch(() => setError("Не удалось загрузить счета"));
  }, []);

  const value = Number(amount.replace(",", "."));
  const toAdvance = Math.max(0, Math.round((value - owed) * 100) / 100);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.sales.customerPayment({ customerId, amount: value, accountId, note: note.trim() || undefined });
      setResult(r);
      setAmount("");
      setNote("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять оплату");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 space-y-3 rounded-2xl border border-border p-4">
      <div className="text-sm font-semibold text-foreground">Принять оплату</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select className={fieldClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Счёт">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input className={fieldClass} inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Сумма" />
        <input className={fieldClass} placeholder="Комментарий" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {value > 0 && toAdvance > 0 && (
        <p className="text-xs text-muted">
          {owed > 0 ? `${formatMoney(owed)} в погашение долга, ` : ""}
          {formatMoney(toAdvance)} — аванс
        </p>
      )}
      {result && (
        <p className="text-xs text-emerald-700">
          Принято: в погашение {formatMoney(result.appliedToSales.reduce((s, a) => s + a.amount, 0))}
          {result.advance > 0 ? `, аванс ${formatMoney(result.advance)}` : ""}
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        disabled={busy || !accountId || !(value > 0)}
        onClick={submit}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Сохранение…" : "Принять"}
      </button>
    </div>
  );
}
