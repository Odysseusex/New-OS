"use client";

import { useEffect, useState } from "react";
import type { CashAccountDto, LocationNonCashAccountDto } from "@bakery-os/shared";
import { CashAccountType } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";

// Финансы → Банк и касса → «Безналичная оплата на точках»: which bank account a
// point's card / Kaspi / transfer takings land in. Empty = the default account.
export function NonCashAccountsCard({ accounts, canManage }: { accounts: CashAccountDto[]; canManage: boolean }) {
  const [rows, setRows] = useState<LocationNonCashAccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.finance.accounts
      .nonCash()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить"));
  }, []);

  const banks = accounts.filter((a) => a.type === CashAccountType.BANK && a.isActive);
  const defaultBank = banks.find((a) => a.isDefault);

  async function change(locationId: string, accountId: string) {
    setSaving(locationId);
    setError(null);
    try {
      setRows(await api.finance.accounts.setNonCash(locationId, accountId || null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Безналичная оплата на точках</h2>
      </div>
      {error && <p className="m-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="px-5 py-6 text-sm text-muted">Загрузка…</p>}
      {rows && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Точка</th>
              <th className="px-5 py-3 font-medium">Карта, Kaspi, перевод — на счёт</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.locationId}>
                <td className="px-5 py-2.5 text-foreground">{r.locationName}</td>
                <td className="px-5 py-2.5">
                  {canManage ? (
                    <select
                      value={r.accountId ?? ""}
                      disabled={saving === r.locationId}
                      onChange={(e) => change(r.locationId, e.target.value)}
                      className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="">Основной счёт{defaultBank ? ` (${defaultBank.name})` : ""}</option>
                      {banks.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-foreground">
                      {banks.find((a) => a.id === r.accountId)?.name ?? `Основной счёт${defaultBank ? ` (${defaultBank.name})` : ""}`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
