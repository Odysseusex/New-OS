"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  BalanceControlMode,
  DepreciationMethod,
  NegativeStockPolicy,
  POLICY_MANAGE_ROLES,
  ReturnScrapPresentation,
  WriteOffPresentation,
} from "@bakery-os/shared";
import type { AccountingPolicyDto, PolicySettingDto, UpdateAccountingPolicyRequestDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";

const SOURCE_LABEL: Record<string, string> = {
  APPROVED: "Утверждено",
  CURRENT_BEHAVIOR: "Текущее поведение",
  NOT_CONFIGURED: "Не настроено",
};
const SOURCE_STYLE: Record<string, string> = {
  APPROVED: "bg-green-50 text-green-700",
  CURRENT_BEHAVIOR: "bg-amber-50 text-amber-700",
  NOT_CONFIGURED: "bg-surface-muted text-muted",
};

type Row = {
  field: keyof Omit<UpdateAccountingPolicyRequestDto, "reason">;
  label: string;
  setting: PolicySettingDto<unknown>;
  options?: { value: string; label: string }[];
  numeric?: boolean;
};

// What the business has APPROVED, kept apart from what the system merely does.
// A setting with no approval is shown as current behaviour or "not configured";
// nothing here turns a guess into a rule.
export function AccountingPolicyCard() {
  const { user } = useAuth();
  const canManage = user ? POLICY_MANAGE_ROLES.includes(user.role) : false;
  const [policy, setPolicy] = useState<AccountingPolicyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.policy.get().then(setPolicy).catch(() => setError("Не удалось загрузить учётную политику"));
  }, []);
  useEffect(load, [load]);

  if (!policy) return error ? <p className="text-sm text-red-700">{error}</p> : null;

  const rows: Row[] = [
    { field: "negativeStockPolicy", label: "Отрицательные остатки", setting: policy.negativeStockPolicy, options: [{ value: NegativeStockPolicy.BLOCK, label: "Запрещены" }] },
    {
      field: "writeOffPresentation", label: "Списания в отчёте", setting: policy.writeOffPresentation,
      options: [{ value: WriteOffPresentation.SEPARATE_LINE, label: "Отдельной строкой" }, { value: WriteOffPresentation.IN_COGS, label: "В себестоимости" }],
    },
    {
      field: "returnScrapPresentation", label: "Возврат с утилизацией", setting: policy.returnScrapPresentation,
      options: [{ value: ReturnScrapPresentation.KEEP_IN_COGS, label: "Себестоимость сохраняется" }, { value: ReturnScrapPresentation.INVENTORY_LOSS, label: "Потеря запасов" }],
    },
    {
      field: "balanceControlMode", label: "Контроль баланса при закрытии", setting: policy.balanceControlMode,
      options: [{ value: BalanceControlMode.WARN, label: "Предупреждать" }, { value: BalanceControlMode.BLOCK, label: "Блокировать закрытие" }],
    },
    { field: "capitalizationThreshold", label: "Порог капитализации, ₸", setting: policy.capitalizationThreshold, numeric: true },
    {
      field: "depreciationMethod", label: "Метод амортизации", setting: policy.depreciationMethod,
      options: [{ value: DepreciationMethod.STRAIGHT_LINE, label: "Линейный" }, { value: DepreciationMethod.NOT_DEPRECIATED, label: "Не амортизируется" }],
    },
    { field: "depreciationUsefulLifeMonths", label: "Срок полезного использования, мес.", setting: policy.depreciationUsefulLifeMonths, numeric: true },
  ];

  const display = (row: Row): string => {
    const v = row.setting.value;
    if (v === null || v === undefined) return "—";
    return row.options?.find((o) => o.value === v)?.label ?? String(v);
  };

  async function save(next: string | null) {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = next === null ? null : editing.numeric ? Number(next.replace(",", ".")) : next;
      setPolicy(await api.policy.update({ [editing.field]: parsed, reason: reason.trim() } as UpdateAccountingPolicyRequestDto));
      setEditing(null);
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Учётная политика</h2>
      </div>
      {error && <p className="px-5 pt-3 text-sm text-red-700">{error}</p>}
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.field}>
              <td className="px-5 py-3 text-foreground">{row.label}</td>
              <td className="px-5 py-3 text-foreground">{display(row)}</td>
              <td className="px-5 py-3">
                <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", SOURCE_STYLE[row.setting.source])}>
                  {SOURCE_LABEL[row.setting.source]}
                </span>
                {row.setting.approvedAt && (
                  <span className="ml-2 text-xs text-muted">
                    {formatDateTime(row.setting.approvedAt)} · {row.setting.approvedByName}
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-right">
                {canManage && (
                  <button
                    onClick={() => {
                      setEditing(row);
                      setValue(row.setting.value === null ? (row.options?.[0]?.value ?? "") : String(row.setting.value));
                    }}
                    className="text-accent hover:underline"
                  >
                    Изменить
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="space-y-3 border-t border-border px-5 py-4">
          <div className="text-sm font-medium text-foreground">{editing.label}</div>
          {editing.options ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {editing.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Основание решения"
            className="block w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={saving || reason.trim().length < 3 || !value}
              onClick={() => save(value)}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              Утвердить
            </button>
            {editing.setting.source === "APPROVED" && (
              <button
                disabled={saving || reason.trim().length < 3}
                onClick={() => save(null)}
                className="rounded-xl border border-border px-4 py-2 text-sm text-foreground disabled:opacity-50"
              >
                Отозвать утверждение
              </button>
            )}
            <button onClick={() => setEditing(null)} className="rounded-xl border border-border px-4 py-2 text-sm text-foreground">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
