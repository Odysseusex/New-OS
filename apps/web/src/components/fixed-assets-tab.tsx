"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  DEPRECIATION_STATUS_LABELS_RU,
  DepreciationMethod,
  DepreciationStatus,
  FIXED_ASSET_DISPOSE_ROLES,
  FIXED_ASSET_MANAGE_ROLES,
  FIXED_ASSET_STATUS_LABELS_RU,
  FixedAssetStatus,
} from "@bakery-os/shared";
import type { CashAccountDto, FixedAssetDto, UnregisteredCapitalExpenseDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Modal } from "@/components/modal";

const field =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

// The asset register. Capital purchases wait in the list above until someone
// registers them; depreciation happens only on terms a person has stated.
export function FixedAssetsTab() {
  const { user } = useAuth();
  const canManage = user ? FIXED_ASSET_MANAGE_ROLES.includes(user.role) : false;
  const canDispose = user ? FIXED_ASSET_DISPOSE_ROLES.includes(user.role) : false;
  const [assets, setAssets] = useState<FixedAssetDto[]>([]);
  const [waiting, setWaiting] = useState<UnregisteredCapitalExpenseDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [registering, setRegistering] = useState<UnregisteredCapitalExpenseDto | "opening" | null>(null);
  const [terms, setTerms] = useState<FixedAssetDto | null>(null);
  const [disposing, setDisposing] = useState<FixedAssetDto | null>(null);

  const load = useCallback(() => {
    Promise.all([api.fixedAssets.list(), api.fixedAssets.unregistered()])
      .then(([a, w]) => {
        setAssets(a);
        setWaiting(w);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  async function runDepreciation() {
    setError(null);
    setInfo(null);
    // Up to the last fully elapsed month.
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    try {
      const r = await api.fixedAssets.runDepreciation(d.getFullYear(), d.getMonth() + 1);
      setInfo(`Начислено записей: ${r.created}${r.notConfigured ? ` · без условий амортизации: ${r.notConfigured}` : ""}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось начислить амортизацию");
    }
  }

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error") return <p className="text-sm text-red-700">Не удалось загрузить основные средства</p>;

  const total = assets.filter((a) => a.status === FixedAssetStatus.ACTIVE).reduce((s, a) => s + a.bookValue, 0);

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{info}</div>}

      {waiting.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Капитальные расходы без записи в реестре</h3>
          <ul className="divide-y divide-amber-200 text-sm">
            {waiting.map((w) => (
              <li key={w.expenseId} className="flex items-center justify-between gap-3 py-2">
                <span className="text-amber-900">
                  {w.description ?? w.categoryName ?? "Расход"} · {formatDateTime(w.incurredOn)}
                  {w.belowThreshold && <span className="ml-2 text-xs">(ниже порога капитализации)</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-amber-900">{formatMoney(w.amount)}</span>
                  {canManage && (
                    <button onClick={() => setRegistering(w)} className="text-accent hover:underline">
                      Зарегистрировать
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          Остаточная стоимость: <span className="font-semibold text-foreground">{formatMoney(total)}</span>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => setRegistering("opening")} className="rounded-xl border border-border px-3.5 py-2 text-sm text-foreground hover:bg-surface-muted">
              Добавить в начальный остаток
            </button>
            <button onClick={runDepreciation} className="rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
              Начислить амортизацию
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Наименование</th>
              <th className="px-5 py-3 text-right font-medium">Стоимость</th>
              <th className="px-5 py-3 text-right font-medium">Амортизация</th>
              <th className="px-5 py-3 text-right font-medium">Остаточная стоимость</th>
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assets.map((a) => (
              <tr key={a.id} className={clsx(a.status === FixedAssetStatus.DISPOSED && "opacity-60")}>
                <td className="px-5 py-3 font-medium text-foreground">
                  {a.name}
                  {a.isOpening && <span className="ml-2 text-xs font-normal text-muted">начальный остаток</span>}
                </td>
                <td className="px-5 py-3 text-right">{formatMoney(a.acquisitionCost)}</td>
                <td className="px-5 py-3 text-right">{formatMoney(a.accumulatedDepreciation)}</td>
                <td className="px-5 py-3 text-right">{formatMoney(a.bookValue)}</td>
                <td className="px-5 py-3">
                  {a.status === FixedAssetStatus.DISPOSED ? (
                    <span className="text-muted">{FIXED_ASSET_STATUS_LABELS_RU[a.status]}</span>
                  ) : (
                    <span
                      className={clsx(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        a.depreciationStatus === DepreciationStatus.NOT_CONFIGURED ? "bg-amber-50 text-amber-700" : "bg-surface-muted text-muted",
                      )}
                    >
                      {DEPRECIATION_STATUS_LABELS_RU[a.depreciationStatus]}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {a.status === FixedAssetStatus.ACTIVE && (
                    <div className="flex gap-3">
                      {canManage && (
                        <button onClick={() => setTerms(a)} className="text-accent hover:underline">
                          Условия
                        </button>
                      )}
                      {canDispose && (
                        <button onClick={() => setDisposing(a)} className="text-red-700 hover:underline">
                          Выбытие
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted">
                  Основных средств пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {registering && (
        <RegisterModal
          source={registering}
          onClose={() => setRegistering(null)}
          onDone={() => {
            setRegistering(null);
            load();
          }}
        />
      )}
      {terms && (
        <TermsModal
          asset={terms}
          onClose={() => setTerms(null)}
          onDone={() => {
            setTerms(null);
            load();
          }}
        />
      )}
      {disposing && (
        <DisposeModal
          asset={disposing}
          onClose={() => setDisposing(null)}
          onDone={() => {
            setDisposing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Footer({ onClose, onSubmit, busy, label }: { onClose: () => void; onSubmit: () => void; busy: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-3">
      <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted">
        Отмена
      </button>
      <button
        onClick={onSubmit}
        disabled={busy}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}

function useAction(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

function RegisterModal({ source, onClose, onDone }: { source: UnregisteredCapitalExpenseDto | "opening"; onClose: () => void; onDone: () => void }) {
  const opening = source === "opening";
  const [name, setName] = useState(opening ? "" : (source.description ?? ""));
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const { error, busy, run } = useAction(onDone);
  return (
    <Modal title={opening ? "Основное средство — начальный остаток" : "Регистрация основного средства"} onClose={onClose}>
      <div className="space-y-4">
        <input className={field} placeholder="Наименование" value={name} onChange={(e) => setName(e.target.value)} />
        {opening ? (
          <>
            <input className={field} inputMode="decimal" placeholder="Стоимость" value={cost} onChange={(e) => setCost(e.target.value)} />
            <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className={field} placeholder="Причина (после запуска финансового учёта)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        ) : (
          <p className="text-sm text-muted">Стоимость: {formatMoney(source.amount)}</p>
        )}
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <Footer
          onClose={onClose}
          busy={busy || !name.trim() || (opening && !(num(cost) > 0))}
          label="Зарегистрировать"
          onSubmit={() =>
            run(() =>
              api.fixedAssets.register(
                opening
                  ? { name, opening: { acquisitionCost: num(cost), acquiredAt: new Date(date).toISOString(), reason: reason.trim() || undefined } }
                  : { name, sourceExpenseId: source.expenseId },
              ),
            )
          }
        />
      </div>
    </Modal>
  );
}

function TermsModal({ asset, onClose, onDone }: { asset: FixedAssetDto; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<string>(asset.depreciationMethod ?? "");
  const [life, setLife] = useState(asset.usefulLifeMonths ? String(asset.usefulLifeMonths) : "");
  const [salvage, setSalvage] = useState(asset.salvageValue !== null ? String(asset.salvageValue) : "");
  const [year, setYear] = useState(asset.depreciationStartYear ? String(asset.depreciationStartYear) : String(new Date().getFullYear()));
  const [month, setMonth] = useState(asset.depreciationStartMonth ? String(asset.depreciationStartMonth) : "");
  const { error, busy, run } = useAction(onDone);
  const straight = method === DepreciationMethod.STRAIGHT_LINE;
  return (
    <Modal title={`Условия амортизации — ${asset.name}`} onClose={onClose}>
      <div className="space-y-4">
        <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Не задан</option>
          <option value={DepreciationMethod.STRAIGHT_LINE}>Линейный</option>
          <option value={DepreciationMethod.NOT_DEPRECIATED}>Не амортизируется</option>
        </select>
        {straight && (
          <div className="grid grid-cols-2 gap-3">
            <input className={field} inputMode="numeric" placeholder="Срок, мес." value={life} onChange={(e) => setLife(e.target.value)} />
            <input className={field} inputMode="decimal" placeholder="Остаточная стоимость" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
            <input className={field} inputMode="numeric" placeholder="Год начала" value={year} onChange={(e) => setYear(e.target.value)} />
            <input className={field} inputMode="numeric" placeholder="Месяц начала (1–12)" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <Footer
          onClose={onClose}
          busy={busy}
          label="Сохранить"
          onSubmit={() =>
            run(() =>
              api.fixedAssets.setTerms(
                asset.id,
                method === ""
                  ? { method: null }
                  : straight
                    ? { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: num(life), salvageValue: num(salvage), startYear: num(year), startMonth: num(month) }
                    : { method: DepreciationMethod.NOT_DEPRECIATED },
              ),
            )
          }
        />
      </div>
    </Modal>
  );
}

function DisposeModal({ asset, onClose, onDone }: { asset: FixedAssetDto; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [proceeds, setProceeds] = useState("");
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [accountId, setAccountId] = useState("");
  const { error, busy, run } = useAction(onDone);
  useEffect(() => {
    api.finance.accounts.list().then((l) => {
      setAccounts(l);
      setAccountId(l[0]?.id ?? "");
    }).catch(() => {});
  }, []);
  const amount = proceeds.trim() ? num(proceeds) : 0;
  return (
    <Modal title={`Выбытие — ${asset.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Остаточная стоимость: {formatMoney(asset.bookValue)}</p>
        <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className={field} inputMode="decimal" placeholder="Выручка от продажи (если была)" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
        {amount > 0 && (
          <select className={field} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <Footer
          onClose={onClose}
          busy={busy || !(amount >= 0)}
          label="Списать"
          onSubmit={() =>
            run(() =>
              api.fixedAssets.dispose(asset.id, {
                disposedAt: new Date(date).toISOString(),
                ...(amount > 0 ? { proceeds: amount, accountId } : {}),
              }),
            )
          }
        />
      </div>
    </Modal>
  );
}
