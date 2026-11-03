"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Upload } from "lucide-react";
import type {
  BankStatementDto,
  BankStatementLineDto,
  BankStatementSummaryDto,
  CashAccountDto,
  FinanceCategoryDto,
  ParsedBankStatement,
  PostBankLineRequestDto,
  SupplierDto,
} from "@bakery-os/shared";
import {
  BANK_LINE_ACTION_LABELS_RU,
  BANK_LINE_STATUS_LABELS_RU,
  BANK_PRESET_CATEGORY_NAMES_RU,
  BankLineAction,
  BankLineStatus,
  BankPresetCategory,
  CashAccountType,
  FinanceCategoryKind,
  parseBankStatementRows,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { readFirstSheet } from "@/lib/xlsx-read";
import { formatDate, formatDateTime, formatMoneyPrecise } from "@/lib/format";

const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

interface Choice {
  action: BankLineAction | "";
  // "preset:BANK_FEE" or a category id
  category: string;
  targetAccountId: string;
  supplierId: string;
  remember: boolean;
}

const emptyChoice: Choice = { action: "", category: "", targetAccountId: "", supplierId: "", remember: false };

function choiceFromSuggestion(line: BankStatementLineDto): Choice {
  const s = line.suggestion;
  if (!s) return { ...emptyChoice };
  return {
    action: s.action,
    category: s.categoryId ?? (s.presetCategory ? `preset:${s.presetCategory}` : ""),
    targetAccountId: s.targetAccountId ?? "",
    supplierId: s.supplierId ?? "",
    remember: false,
  };
}

function isReady(c: Choice): boolean {
  if (!c.action) return false;
  if (c.action === BankLineAction.CATEGORY) return !!c.category;
  if (c.action === BankLineAction.TRANSFER) return !!c.targetAccountId;
  if (c.action === BankLineAction.SUPPLIER_PAYMENT) return !!c.supplierId;
  return true;
}

// Финансы → «Выписки»: load a bank statement (.xlsx), decide how each line is
// posted (most are suggested), post. The file is read here, in the browser.
export function BankStatementsTab() {
  const [list, setList] = useState<BankStatementSummaryDto[] | null>(null);
  const [accounts, setAccounts] = useState<CashAccountDto[]>([]);
  const [accountId, setAccountId] = useState("");
  const [parsed, setParsed] = useState<(ParsedBankStatement & { fileName: string }) | null>(null);
  const [open, setOpen] = useState<BankStatementDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(() => {
    api.bankStatements
      .list()
      .then(setList)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить список выписок"));
  }, []);

  useEffect(() => {
    loadList();
    api.finance.accounts
      .list()
      .then((all) => {
        setAccounts(all);
        setAccountId((prev) => prev || all.find((a) => a.type === CashAccountType.BANK && a.isDefault)?.id || all.find((a) => a.type === CashAccountType.BANK)?.id || "");
      })
      .catch(() => {});
  }, [loadList]);

  async function onFile(file: File) {
    setError(null);
    setParsed(null);
    try {
      const rows = await readFirstSheet(await file.arrayBuffer());
      const result = parseBankStatementRows(rows);
      setParsed({ ...result, fileName: file.name });
      // The statement's bank names its account when one is called that way («BCC», «Kaspi Pay»).
      const byName = result.bankName === "Банк ЦентрКредит" ? /bcc|бцк|центркредит/i : result.bankName === "Kaspi Bank" ? /kaspi|каспи/i : null;
      const match = byName && accounts.find((a) => a.isActive && a.type === CashAccountType.BANK && byName.test(a.name));
      if (match) setAccountId(match.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function upload() {
    if (!parsed || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const dto = await api.bankStatements.upload({
        accountId,
        bankName: parsed.bankName,
        iban: parsed.iban,
        holderBin: parsed.holderBin,
        periodFrom: parsed.periodFrom,
        periodTo: parsed.periodTo,
        openingBalance: parsed.openingBalance,
        closingBalance: parsed.closingBalance,
        fileName: parsed.fileName,
        lines: parsed.lines,
      });
      setParsed(null);
      setOpen(dto);
      loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить выписку");
    } finally {
      setBusy(false);
    }
  }

  async function openStatement(id: string) {
    setError(null);
    try {
      setOpen(await api.bankStatements.get(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось открыть выписку");
    }
  }

  if (open) {
    return (
      <StatementView
        statement={open}
        accounts={accounts}
        onBack={() => {
          setOpen(null);
          loadList();
        }}
        onChange={setOpen}
      />
    );
  }

  const parsedSum = parsed ? parsed.lines.reduce((s, l) => s + l.amount, 0) : 0;
  const balanceOk = parsed && parsed.openingBalance !== null && parsed.closingBalance !== null
    ? Math.abs(parsed.openingBalance + parsedSum - parsed.closingBalance) < 0.01
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${selectClass} px-3 py-2`}>
          <option value="">Счёт выписки…</option>
          {accounts.filter((a) => a.isActive).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
        >
          <Upload className="h-4 w-4" strokeWidth={1.75} />
          Загрузить выписку (Excel)
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {parsed && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground">{parsed.fileName}</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Field label="Банк" value={parsed.bankName} />
            <Field label="Счёт" value={parsed.iban ?? "—"} />
            <Field label="Период" value={`${formatDate(parsed.periodFrom)} — ${formatDate(parsed.periodTo)}`} />
            <Field label="Операций" value={String(parsed.lines.length)} />
            <Field label="Входящий остаток" value={parsed.openingBalance !== null ? formatMoneyPrecise(parsed.openingBalance) : "—"} />
            <Field label="Исходящий остаток" value={parsed.closingBalance !== null ? formatMoneyPrecise(parsed.closingBalance) : "—"} />
          </div>
          {balanceOk === false && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Остатки не сходятся с суммой операций — файл прочитан не полностью</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setParsed(null)} className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-muted">
              Отмена
            </button>
            <button
              onClick={upload}
              disabled={busy || !accountId}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Загрузка…" : "Загрузить"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Период</th>
              <th className="px-4 py-3 font-medium">Счёт</th>
              <th className="px-4 py-3 text-right font-medium">Операций</th>
              <th className="px-4 py-3 text-right font-medium">Не проведено</th>
              <th className="px-4 py-3 font-medium">Загружена</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list === null && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  Загрузка…
                </td>
              </tr>
            )}
            {list?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  Выписок пока нет
                </td>
              </tr>
            )}
            {list?.map((s) => (
              <tr key={s.id} onClick={() => openStatement(s.id)} className="cursor-pointer hover:bg-surface-muted">
                <td className="px-4 py-2.5 text-foreground">
                  {formatDate(s.periodFrom)} — {formatDate(s.periodTo)}
                </td>
                <td className="px-4 py-2.5 text-foreground">
                  {s.accountName} <span className="text-xs text-muted">{s.bankName}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-foreground">{s.lineCount}</td>
                <td className={`px-4 py-2.5 text-right ${s.newCount > 0 ? "font-semibold text-amber-700" : "text-muted"}`}>{s.newCount}</td>
                <td className="px-4 py-2.5 text-muted">{formatDateTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatementView({
  statement,
  accounts,
  onBack,
  onChange,
}: {
  statement: BankStatementDto;
  accounts: CashAccountDto[];
  onBack: () => void;
  onChange: (s: BankStatementDto) => void;
}) {
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    api.finance.categories.list().then((c) => setCategories(c.filter((x) => x.isActive))).catch(() => {});
    api.suppliers.list().then(setSuppliers).catch(() => {});
  }, []);

  useEffect(() => {
    setChoices((prev) => {
      const next: Record<string, Choice> = {};
      for (const l of statement.lines) if (l.status === BankLineStatus.NEW) next[l.id] = prev[l.id] ?? choiceFromSuggestion(l);
      return next;
    });
  }, [statement]);

  const presetExisting = useMemo(() => {
    const byName = new Map(categories.map((c) => [c.name, c.id]));
    return (p: BankPresetCategory) => byName.get(BANK_PRESET_CATEGORY_NAMES_RU[p]) ?? null;
  }, [categories]);

  // A suggested «Комиссия банка» that already exists is that category.
  useEffect(() => {
    setChoices((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, c] of Object.entries(prev)) {
        if (!c.category.startsWith("preset:")) continue;
        const existing = presetExisting(c.category.slice(7) as BankPresetCategory);
        if (existing) {
          next[id] = { ...c, category: existing };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [presetExisting, choices]);

  const lines = statement.lines.filter((l) => !onlyNew || l.status === BankLineStatus.NEW);
  const ready = statement.lines.filter((l) => l.status === BankLineStatus.NEW && choices[l.id] && isReady(choices[l.id]));
  const newCount = statement.lines.filter((l) => l.status === BankLineStatus.NEW).length;
  const balanceDiff = statement.closingBalance !== null ? Math.round((statement.closingBalance - statement.systemClosingBalance) * 100) / 100 : null;

  const set = (id: string, patch: Partial<Choice>) => setChoices((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyChoice), ...patch } }));

  async function postReady() {
    setBusy(true);
    setError(null);
    try {
      const payload: PostBankLineRequestDto[] = ready.map((l) => {
        const c = choices[l.id];
        const preset = c.category.startsWith("preset:") ? (c.category.slice(7) as BankPresetCategory) : null;
        return {
          lineId: l.id,
          action: c.action as BankLineAction,
          categoryId: c.action === BankLineAction.CATEGORY && !preset ? c.category : null,
          presetCategory: c.action === BankLineAction.CATEGORY ? preset : null,
          targetAccountId: c.action === BankLineAction.TRANSFER ? c.targetAccountId : null,
          supplierId: c.action === BankLineAction.SUPPLIER_PAYMENT ? c.supplierId : null,
          remember: c.remember,
        };
      });
      // In parts, so a slow connection never holds one request for minutes.
      let posted = 0;
      const failed: { lineId: string; message: string }[] = [];
      for (let i = 0; i < payload.length; i += 20) {
        setProgress(`Проведено ${i} из ${payload.length}…`);
        const result = await api.bankStatements.post(statement.id, { lines: payload.slice(i, i + 20) });
        posted += result.posted;
        failed.push(...result.failed);
        onChange(result.statement);
      }
      setFailures(Object.fromEntries(failed.map((f) => [f.lineId, f.message])));
      if (failed.length > 0) setError(`Проведено: ${posted}. Не проведено: ${failed.length} — причина указана у строки`);
      api.finance.categories.list().then((c) => setCategories(c.filter((x) => x.isActive))).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Все выписки
      </button>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-border bg-surface p-5 text-sm shadow-card sm:grid-cols-4">
        <Field label="Счёт" value={`${statement.accountName} · ${statement.bankName}`} />
        <Field label="Период" value={`${formatDate(statement.periodFrom)} — ${formatDate(statement.periodTo)}`} />
        <Field label="Остаток по банку на конец" value={statement.closingBalance !== null ? formatMoneyPrecise(statement.closingBalance) : "—"} />
        <Field label="Остаток в системе на конец" value={formatMoneyPrecise(statement.systemClosingBalance)} />
        {balanceDiff !== null && balanceDiff !== 0 && (
          <p className="col-span-2 text-amber-700 sm:col-span-4">
            Расхождение остатка: {formatMoneyPrecise(balanceDiff)}
            {newCount > 0 ? ` · не проведено операций: ${newCount}` : ""}
          </p>
        )}
        {statement.duplicatesSkipped > 0 && (
          <p className="col-span-2 text-muted sm:col-span-4">Уже загружены раньше и пропущены: {statement.duplicatesSkipped}</p>
        )}
      </div>

      {statement.settlement.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Выручка с кассы: банк и чеки</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">День</th>
                <th className="px-4 py-2 text-right font-medium">Зачислено банком</th>
                <th className="px-4 py-2 text-right font-medium">По чекам (карта, Kaspi)</th>
                <th className="px-4 py-2 text-right font-medium">Разница</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {statement.settlement.map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-2 text-foreground">{formatDate(d.date)}</td>
                  <td className="px-4 py-2 text-right text-foreground">{formatMoneyPrecise(d.bankAmount)}</td>
                  <td className="px-4 py-2 text-right text-foreground">{formatMoneyPrecise(d.systemAmount)}</td>
                  <td className={`px-4 py-2 text-right ${Math.abs(d.difference) >= 0.01 ? "font-semibold text-amber-700" : "text-muted"}`}>
                    {Math.abs(d.difference) >= 0.01 ? formatMoneyPrecise(d.difference) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Только непроведённые
        </label>
        <div className="ml-auto flex items-center gap-3">
          {newCount === statement.lines.length && (
            <button
              onClick={async () => {
                if (!confirm("Удалить загруженную выписку? Ничего проведено не было.")) return;
                try {
                  await api.bankStatements.remove(statement.id);
                  onBack();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Не удалось удалить");
                }
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Удалить выписку
            </button>
          )}
          <button
            onClick={postReady}
            disabled={busy || ready.length === 0}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? progress ?? "Проведение…" : `Провести заполненные (${ready.length})`}
          </button>
        </div>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Операция</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
              <th className="px-4 py-3 font-medium">Как провести</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Все операции проведены
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const c = choices[l.id] ?? emptyChoice;
              const out = l.amount < 0;
              const categoryOptions = categories.filter((x) => x.kind === (out ? FinanceCategoryKind.EXPENSE : FinanceCategoryKind.INCOME));
              const presets = out
                ? Object.values(BankPresetCategory).filter((p) => !presetExisting(p))
                : [];
              return (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDateTime(l.occurredAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-foreground">{l.purpose ?? "—"}</div>
                    <div className="text-xs text-muted">
                      {l.counterpartyName ?? ""}
                      {l.counterpartyBin ? ` · БИН ${l.counterpartyBin}` : ""}
                    </div>
                    {failures[l.id] && <div className="mt-1 text-xs text-red-600">{failures[l.id]}</div>}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${out ? "text-foreground" : "text-emerald-700"}`}>
                    {out ? "" : "+"}
                    {formatMoneyPrecise(l.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.status !== BankLineStatus.NEW ? (
                      <div>
                        <span className="text-xs font-medium text-muted">{BANK_LINE_STATUS_LABELS_RU[l.status]}</span>
                        <div className="text-xs text-foreground">{l.resultNote}</div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={c.action} onChange={(e) => set(l.id, { action: e.target.value as BankLineAction | "" })} className={selectClass}>
                          <option value="">Выберите…</option>
                          {Object.values(BankLineAction)
                            .filter((a) => (out ? a !== BankLineAction.SALES_SETTLEMENT : a !== BankLineAction.SUPPLIER_PAYMENT))
                            .map((a) => (
                              <option key={a} value={a}>
                                {BANK_LINE_ACTION_LABELS_RU[a]}
                              </option>
                            ))}
                        </select>
                        {c.action === BankLineAction.CATEGORY && (
                          <select value={c.category} onChange={(e) => set(l.id, { category: e.target.value })} className={selectClass}>
                            <option value="">Статья…</option>
                            {presets.map((p) => (
                              <option key={p} value={`preset:${p}`}>
                                {BANK_PRESET_CATEGORY_NAMES_RU[p]} (новая)
                              </option>
                            ))}
                            {categoryOptions.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {c.action === BankLineAction.TRANSFER && (
                          <select value={c.targetAccountId} onChange={(e) => set(l.id, { targetAccountId: e.target.value })} className={selectClass}>
                            <option value="">{out ? "На счёт…" : "Со счёта…"}</option>
                            {accounts
                              .filter((a) => a.isActive && a.id !== statement.accountId)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        )}
                        {c.action === BankLineAction.SUPPLIER_PAYMENT && (
                          <select value={c.supplierId} onChange={(e) => set(l.id, { supplierId: e.target.value })} className={selectClass}>
                            <option value="">Поставщик…</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {c.action && c.action !== BankLineAction.SALES_SETTLEMENT && (
                          <label className="flex items-center gap-1 text-xs text-muted">
                            <input type="checkbox" checked={c.remember} onChange={(e) => set(l.id, { remember: e.target.checked })} />
                            запомнить
                          </label>
                        )}
                        {l.suggestion?.source === "RULE" && <span className="text-xs text-muted">по правилу</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}
