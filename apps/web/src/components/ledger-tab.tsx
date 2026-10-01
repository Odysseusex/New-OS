"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ACCOUNTING_EVENT_STATUS_LABELS_RU,
  AccountingEventStatus,
  DEFAULT_NORMAL_BALANCE,
  JOURNAL_ENTRY_KIND_LABELS_RU,
  JournalEntryKind,
  LEDGER_ACCOUNT_TYPE_LABELS_RU,
  LEDGER_MANAGE_ROLES,
  LEDGER_SETUP_ROLES,
  LedgerAccountType,
  NORMAL_BALANCE_LABELS_RU,
  SYSTEM_ACCOUNT_DEFS,
} from "@bakery-os/shared";
import type { JournalEntryDto, LedgerAccountDto, LedgerStatusDto, OpeningBalanceProposalDto, PostPendingResultDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, formatMoneyPrecise } from "@/lib/format";
import { Modal } from "@/components/modal";
import {
  LedgerBookPanel,
  LedgerCoveragePanel,
  LedgerDiagnosticsPanel,
  LedgerReportsPanel,
  TrialBalancePanel,
} from "@/components/ledger-panels";

type Sub = "overview" | "accounts" | "journal" | "book" | "tb" | "reports" | "diagnostics" | "coverage";
const SUBS: { id: Sub; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "accounts", label: "План счетов" },
  { id: "journal", label: "Журнал проводок" },
  { id: "book", label: "Главная книга" },
  { id: "tb", label: "ОСВ" },
  { id: "reports", label: "Отчёты" },
  { id: "diagnostics", label: "Диагностика" },
  { id: "coverage", label: "Покрытие" },
];

const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";
const buttonClass = "rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60";
const ghostButton = "rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-60";
const th = "px-4 py-2.5 font-medium";
const todayIso = () => new Date().toISOString().slice(0, 10);

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function LedgerTab() {
  const { user } = useAuth();
  const canManage = user ? LEDGER_MANAGE_ROLES.includes(user.role) : false;
  const canSetup = user ? LEDGER_SETUP_ROLES.includes(user.role) : false;
  const [sub, setSub] = useState<Sub>("overview");
  const [status, setStatus] = useState<LedgerStatusDto | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccountDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.ledger.status(), api.ledger.accounts()]);
      setStatus(s);
      setAccounts(a);
      setState("ready");
    } catch (err) {
      setError(errorText(err, "Не удалось загрузить главную книгу"));
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error" || !status) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {SUBS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              sub === s.id ? "bg-foreground text-surface" : "bg-surface-muted text-muted hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === "overview" && <OverviewPanel status={status} canManage={canManage} canSetup={canSetup} onChanged={load} />}
      {sub === "accounts" && <AccountsPanel accounts={accounts} canManage={canManage} onChanged={load} />}
      {sub === "journal" && <JournalPanel accounts={accounts} canManage={canManage} enabled={status.enabled} />}
      {sub === "book" && <LedgerBookPanel accounts={accounts} />}
      {sub === "tb" && <TrialBalancePanel />}
      {sub === "reports" && <LedgerReportsPanel />}
      {sub === "diagnostics" && <LedgerDiagnosticsPanel />}
      {sub === "coverage" && <LedgerCoveragePanel />}
    </div>
  );
}

// ── Обзор: запуск, начальный остаток, непроведённые операции ───────────────

function OverviewPanel({
  status,
  canManage,
  canSetup,
  onChanged,
}: {
  status: LedgerStatusDto;
  canManage: boolean;
  canSetup: boolean;
  onChanged: () => Promise<void>;
}) {
  const [startsAt, setStartsAt] = useState(todayIso());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PostPendingResultDto | null>(null);
  const [proposal, setProposal] = useState<OpeningBalanceProposalDto | null>(null);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorText(err, "Не удалось выполнить действие"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Главная книга</h3>
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", status.enabled ? "bg-green-50 text-green-700" : "bg-surface-muted text-muted")}>
            {status.enabled ? `Запущена с ${formatDate(status.startsAt!)}` : "Не запущена"}
          </span>
        </div>

        {!status.systemAccountsReady && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">Не заведены системные счета: {status.missingSystemAccounts.length}</span>
            {canSetup && (
              <button className={buttonClass} disabled={busy !== null} onClick={() => run("sys", async () => void (await api.ledger.initSystemAccounts()))}>
                Создать системные счета
              </button>
            )}
          </div>
        )}

        {!status.enabled && status.systemAccountsReady && canSetup && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-muted">
              Дата запуска
              <input type="date" className={clsx(inputClass, "mt-1 w-auto")} value={startsAt} max={todayIso()} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <button
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => run("enable", async () => void (await api.ledger.enable({ startsAt: new Date(`${startsAt}T00:00:00`).toISOString() })))}
            >
              Запустить главную книгу
            </button>
          </div>
        )}

        {status.enabled && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Object.values(AccountingEventStatus).map((s) => (
              <div key={s} className="rounded-xl bg-surface-muted p-3">
                <p className="text-xs text-muted">{ACCOUNTING_EVENT_STATUS_LABELS_RU[s]}</p>
                <p className="text-lg font-semibold text-foreground tabular-nums">{status.eventCounts[s]}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {status.enabled && canManage && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Начальный остаток</h3>
          {status.openingEntryPosted ? (
            <p className="text-sm text-green-700">Проведён</p>
          ) : (
            <button
              className={ghostButton}
              disabled={busy !== null}
              onClick={() => run("proposal", async () => setProposal(await api.ledger.openingProposal()))}
            >
              Подготовить проводку начального остатка
            </button>
          )}
        </div>
      )}

      {status.enabled && canManage && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Операции с даты запуска</h3>
          <button className={ghostButton} disabled={busy !== null} onClick={() => run("pending", async () => setPending(await api.ledger.postPending()))}>
            {busy === "pending" ? "Проведение…" : "Провести непроведённые операции"}
          </button>
          {pending && (
            <p className="mt-3 text-sm text-muted">
              Рассмотрено: {pending.considered} · Проведено: {pending.posted} · Не проведено: {pending.notPosted} · Уже в книге: {pending.alreadyDone}
            </p>
          )}
        </div>
      )}

      {proposal && (
        <OpeningModal
          proposal={proposal}
          onClose={() => setProposal(null)}
          onPosted={async () => {
            setProposal(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function OpeningModal({
  proposal,
  onClose,
  onPosted,
}: {
  proposal: OpeningBalanceProposalDto;
  onClose: () => void;
  onPosted: () => Promise<void>;
}) {
  const [lines, setLines] = useState(proposal.lines.map((l) => ({ ...l, amount: String(l.amount) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.ledger.postOpening({
        lines: lines.filter((l) => Number(l.amount) !== 0).map((l) => ({ systemAccountKey: l.systemAccountKey, amount: Number(l.amount) })),
      });
      await onPosted();
    } catch (err) {
      setError(errorText(err, "Не удалось провести начальный остаток"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Начальный остаток" onClose={onClose} width="max-w-2xl">
      {proposal.notes.map((n, i) => (
        <p key={i} className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{n}</p>
      ))}
      {lines.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className={th}>Счёт</th>
              <th className={th}>Источник</th>
              <th className={clsx(th, "text-right")}>Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => (
              <tr key={l.systemAccountKey}>
                <td className="px-4 py-2">{l.accountName}</td>
                <td className="px-4 py-2 text-muted">{l.source}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    className="w-32 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums"
                    value={l.amount}
                    inputMode="decimal"
                    onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={ghostButton} onClick={onClose}>Отмена</button>
        <button className={buttonClass} disabled={busy || lines.length < 2} onClick={submit}>Провести</button>
      </div>
    </Modal>
  );
}

// ── План счетов ────────────────────────────────────────────────────────────

function AccountsPanel({ accounts, canManage, onChanged }: { accounts: LedgerAccountDto[]; canManage: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<LedgerAccountDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  async function toggle(a: LedgerAccountDto) {
    setError(null);
    try {
      await api.ledger.updateAccount(a.id, { isActive: !a.isActive });
      await onChanged();
    } catch (err) {
      setError(errorText(err, "Не удалось изменить счёт"));
    }
  }

  return (
    <div>
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {canManage && (
        <div className="mb-4">
          <button className={buttonClass} onClick={() => setEditing("new")}>Добавить счёт</button>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className={th}>Код</th>
              <th className={th}>Название</th>
              <th className={th}>Тип</th>
              <th className={th}>Сальдо</th>
              <th className={th}>Входит в</th>
              <th className={th}>Статус</th>
              {canManage && <th className={th}></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id} className={a.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-2 font-medium">{a.code}</td>
                <td className="px-4 py-2">
                  {a.name}
                  {a.systemAccountKey && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">системный</span>}
                </td>
                <td className="px-4 py-2 text-muted">{LEDGER_ACCOUNT_TYPE_LABELS_RU[a.type]}</td>
                <td className="px-4 py-2 text-muted">{NORMAL_BALANCE_LABELS_RU[a.normalBalance]}</td>
                <td className="px-4 py-2 text-muted">{a.parentId ? byId.get(a.parentId)?.name ?? "—" : "—"}</td>
                <td className="px-4 py-2">{a.isActive ? "Активен" : "Отключён"}</td>
                {canManage && (
                  <td className="space-x-3 whitespace-nowrap px-4 py-2 text-right">
                    <button className="text-sm text-accent" onClick={() => setEditing(a)}>Изменить</button>
                    {!a.systemAccountKey && (
                      <button className="text-sm text-muted hover:text-foreground" onClick={() => toggle(a)}>
                        {a.isActive ? "Отключить" : "Включить"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted" colSpan={7}>Счетов нет</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <AccountModal
          account={editing === "new" ? null : editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function AccountModal({
  account,
  accounts,
  onClose,
  onSaved,
}: {
  account: LedgerAccountDto | null;
  accounts: LedgerAccountDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<LedgerAccountType>(account?.type ?? LedgerAccountType.ASSET);
  const [normal, setNormal] = useState(account?.normalBalance ?? DEFAULT_NORMAL_BALANCE[LedgerAccountType.ASSET]);
  const [parentId, setParentId] = useState(account?.parentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = account !== null && (account.hasPostings || account.systemAccountKey !== null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (account) {
        await api.ledger.updateAccount(account.id, {
          code,
          name,
          parentId: parentId || null,
          ...(locked ? {} : { type, normalBalance: normal }),
        });
      } else {
        await api.ledger.createAccount({ code, name, type, normalBalance: normal, parentId: parentId || null });
      }
      await onSaved();
    } catch (err) {
      setError(errorText(err, "Не удалось сохранить счёт"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? "Счёт" : "Новый счёт"} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm text-muted">Код<input className={clsx(inputClass, "mt-1")} value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label className="block text-sm text-muted">Название<input className={clsx(inputClass, "mt-1")} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-sm text-muted">
          Тип
          <select
            className={clsx(inputClass, "mt-1")}
            value={type}
            disabled={locked}
            onChange={(e) => {
              const t = e.target.value as LedgerAccountType;
              setType(t);
              setNormal(DEFAULT_NORMAL_BALANCE[t]);
            }}
          >
            {Object.values(LedgerAccountType).map((t) => (
              <option key={t} value={t}>{LEDGER_ACCOUNT_TYPE_LABELS_RU[t]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted">
          Сальдо
          <select className={clsx(inputClass, "mt-1")} value={normal} disabled={locked} onChange={(e) => setNormal(e.target.value as typeof normal)}>
            {Object.entries(NORMAL_BALANCE_LABELS_RU).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted">
          Входит в
          <select className={clsx(inputClass, "mt-1")} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">—</option>
            {accounts
              .filter((a) => a.id !== account?.id && a.type === type)
              .map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
          </select>
        </label>
        {account?.systemAccountKey && <p className="text-xs text-muted">Системный счёт: {SYSTEM_ACCOUNT_DEFS[account.systemAccountKey].name}. Код и название можно изменить.</p>}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className={ghostButton} onClick={onClose}>Отмена</button>
          <button className={buttonClass} disabled={busy || !code.trim() || !name.trim()} onClick={submit}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Журнал проводок ────────────────────────────────────────────────────────

function JournalPanel({ accounts, canManage, enabled }: { accounts: LedgerAccountDto[]; canManage: boolean; enabled: boolean }) {
  const [entries, setEntries] = useState<JournalEntryDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [accountId, setAccountId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [reversing, setReversing] = useState<JournalEntryDto | null>(null);

  const load = useCallback(() => {
    setState("loading");
    api.ledger
      .entries({ kind: kind || undefined, accountId: accountId || undefined, limit: 200 })
      .then((rows) => {
        setEntries(rows);
        setState("ready");
      })
      .catch((err) => {
        setError(errorText(err, "Не удалось загрузить журнал"));
        setState("error");
      });
  }, [kind, accountId]);
  useEffect(load, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={clsx(inputClass, "w-auto")} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все проводки</option>
          {Object.values(JournalEntryKind).map((k) => (
            <option key={k} value={k}>{JOURNAL_ENTRY_KIND_LABELS_RU[k]}</option>
          ))}
        </select>
        <select className={clsx(inputClass, "w-auto")} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Все счета</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </select>
        {canManage && enabled && <button className={buttonClass} onClick={() => setManual(true)}>Ручная проводка</button>}
      </div>
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {state === "ready" && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className={th}>№</th>
                <th className={th}>Дата</th>
                <th className={th}>Описание</th>
                <th className={th}>Вид</th>
                <th className={clsx(th, "text-right")}>Сумма</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer hover:bg-surface-muted" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="px-4 py-2 font-medium">{e.number}</td>
                    <td className="px-4 py-2 text-muted">{formatDateTime(e.entryDate)}</td>
                    <td className="px-4 py-2">
                      {e.description}
                      {e.reversedByEntryId && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">сторнирована</span>}
                    </td>
                    <td className="px-4 py-2 text-muted">{JOURNAL_ENTRY_KIND_LABELS_RU[e.kind]}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoneyPrecise(e.totalDebit)}</td>
                    <td className="px-4 py-2 text-right">
                      {canManage && e.kind !== JournalEntryKind.REVERSAL && !e.reversedByEntryId && (
                        <button
                          className="text-sm text-accent"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setReversing(e);
                          }}
                        >
                          Сторно
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr>
                      <td colSpan={6} className="bg-surface-muted px-4 py-3">
                        <table className="w-full text-sm">
                          <tbody>
                            {e.lines.map((l) => (
                              <tr key={l.lineNo}>
                                <td className="py-1 pr-3">{l.accountName} <span className="text-xs text-muted">{l.accountCode}</span></td>
                                <td className="w-32 py-1 text-right tabular-nums">{l.debit ? formatMoneyPrecise(l.debit) : ""}</td>
                                <td className="w-32 py-1 text-right tabular-nums">{l.credit ? formatMoneyPrecise(l.credit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-xs text-muted">
                          {e.source ? `Источник: ${e.source.sourceType} ${e.source.sourceId} · ` : ""}
                          Проведено {formatDateTime(e.postedAt)}{e.postedByName ? ` · ${e.postedByName}` : ""}
                          {e.reversalReason ? ` · Причина сторно: ${e.reversalReason}` : ""}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={6}>Проводок нет</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {manual && (
        <ManualEntryModal
          accounts={accounts}
          onClose={() => setManual(false)}
          onPosted={() => {
            setManual(false);
            load();
          }}
        />
      )}
      {reversing && (
        <ReverseModal
          entry={reversing}
          onClose={() => setReversing(null)}
          onDone={() => {
            setReversing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ManualEntryModal({ accounts, onClose, onPosted }: { accounts: LedgerAccountDto[]; onClose: () => void; onPosted: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = accounts.filter((a) => a.isActive);

  const cents = (v: string) => Math.round((Number(v) || 0) * 100);
  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  const balanced = debit === credit && debit > 0;
  const valid = balanced && lines.every((l) => l.accountId && (cents(l.debit) > 0) !== (cents(l.credit) > 0) || (!l.accountId && !l.debit && !l.credit));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.ledger.postManual({
        entryDate: new Date(`${date}T12:00:00`).toISOString(),
        description,
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || undefined, credit: Number(l.credit) || undefined })),
      });
      onPosted();
    } catch (err) {
      setError(errorText(err, "Не удалось провести"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Ручная проводка" onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm text-muted">Дата<input type="date" className={clsx(inputClass, "mt-1")} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="col-span-2 text-sm text-muted">Описание<input className={clsx(inputClass, "mt-1")} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1 font-medium">Счёт</th>
              <th className="w-28 py-1 text-right font-medium">Дебет</th>
              <th className="w-28 py-1 text-right font-medium">Кредит</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <select className={inputClass} value={l.accountId} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                    <option value="">—</option>
                    {active.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input className={clsx(inputClass, "text-right tabular-nums")} inputMode="decimal" value={l.debit} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x)))} />
                </td>
                <td className="py-1">
                  <input className={clsx(inputClass, "text-right tabular-nums")} inputMode="decimal" value={l.credit} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x)))} />
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2">
                <button className="text-sm text-accent" onClick={() => setLines((p) => [...p, { accountId: "", debit: "", credit: "" }])}>+ строка</button>
              </td>
              <td className="py-2 text-right tabular-nums">{formatMoneyPrecise(debit / 100)}</td>
              <td className="py-2 text-right tabular-nums">{formatMoneyPrecise(credit / 100)}</td>
            </tr>
          </tbody>
        </table>
        {!balanced && debit + credit > 0 && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Не сбалансирована: разница {formatMoneyPrecise((debit - credit) / 100)}</p>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className={ghostButton} onClick={onClose}>Отмена</button>
          <button className={buttonClass} disabled={busy || !valid || !description.trim()} onClick={submit}>Провести</button>
        </div>
      </div>
    </Modal>
  );
}

function ReverseModal({ entry, onClose, onDone }: { entry: JournalEntryDto; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.ledger.reverse(entry.id, reason);
      onDone();
    } catch (err) {
      setError(errorText(err, "Не удалось выполнить сторно"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Сторно проводки №${entry.number}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{entry.description} · {formatMoneyPrecise(entry.totalDebit)}</p>
      <label className="block text-sm text-muted">
        Причина
        <textarea className={clsx(inputClass, "mt-1")} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="mt-3 text-xs text-muted">Исходная проводка не меняется: вносится обратная проводка текущей датой.</p>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className={ghostButton} onClick={onClose}>Отмена</button>
        <button className={buttonClass} disabled={busy || !reason.trim()} onClick={submit}>Выполнить сторно</button>
      </div>
    </Modal>
  );
}
