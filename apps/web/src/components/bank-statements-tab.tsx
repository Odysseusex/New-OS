"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trash2, Upload } from "lucide-react";
import type {
  BankStatementDto,
  BankStatementLineDto,
  BankStatementSummaryDto,
  BankColumnMappingDto,
  BankImportProfileDto,
  BankKeywordRuleDto,
  CashAccountDto,
  CustomerDto,
  DirectionDto,
  LocationDto,
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
  BANK_MAPPING_FIELDS,
  BANK_NAMES,
  guessColumnMapping,
  headersOf,
  parseMappedStatement,
  readCsv,
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
  customerId: string;
  locationId: string;
  directionId: string;
  remember: boolean;
}

const emptyChoice: Choice = { action: "", category: "", targetAccountId: "", supplierId: "", customerId: "", locationId: "", directionId: "", remember: false };

// A CSV from a Kazakh bank is UTF-8 or Windows-1251; the wrong guess shows as «�».
async function readCsvFile(file: File) {
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1251").decode(bytes);
  }
  return readCsv(text);
}

function choiceFromSuggestion(line: BankStatementLineDto): Choice {
  const s = line.suggestion;
  if (!s) return { ...emptyChoice };
  return {
    action: s.action,
    category: s.categoryId ?? (s.presetCategory ? `preset:${s.presetCategory}` : ""),
    targetAccountId: s.targetAccountId ?? "",
    supplierId: s.supplierId ?? "",
    customerId: s.customerId ?? "",
    locationId: "",
    directionId: "",
    remember: false,
  };
}

function isReady(c: Choice): boolean {
  if (!c.action) return false;
  if (c.action === BankLineAction.CATEGORY) return !!c.category;
  if (c.action === BankLineAction.TRANSFER) return !!c.targetAccountId;
  if (c.action === BankLineAction.SUPPLIER_PAYMENT) return !!c.supplierId;
  if (c.action === BankLineAction.CUSTOMER_PAYMENT) return !!c.customerId;
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
  // A file the built-in reading does not know (another bank, a .csv): its columns are mapped by hand.
  const [raw, setRaw] = useState<{ rows: (string | number | null | undefined)[][]; fileName: string } | null>(null);
  const [bankName, setBankName] = useState("");
  const [mapping, setMapping] = useState<BankColumnMappingDto | null>(null);
  const [profiles, setProfiles] = useState<BankImportProfileDto[]>([]);

  const loadList = useCallback(() => {
    api.bankStatements
      .list()
      .then(setList)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить список выписок"));
  }, []);

  useEffect(() => {
    loadList();
    api.bankStatements.profiles().then(setProfiles).catch(() => {});
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
    setRaw(null);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      const rows = isCsv ? await readCsvFile(file) : await readFirstSheet(await file.arrayBuffer());
      let result: ParsedBankStatement | null = null;
      if (!isCsv) {
        try {
          result = parseBankStatementRows(rows);
          if (result.lines.length === 0) result = null;
        } catch {
          result = null;
        }
      }
      if (!result) {
        const headers = headersOf(rows);
        if (headers.length === 0) throw new Error("В файле не найдена таблица операций (строка заголовков с датой)");
        setRaw({ rows, fileName: file.name });
        setMapping(guessColumnMapping(headers));
        setBankName("");
        return;
      }
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

  // A file read by its column mapping: the mapping is kept for that bank.
  const mappedHeaders = useMemo(() => (raw ? headersOf(raw.rows).filter(Boolean) : []), [raw]);
  const mapped = useMemo(() => (raw && mapping && bankName ? parseMappedStatement(raw.rows, mapping, bankName) : null), [raw, mapping, bankName]);

  function chooseBank(name: string) {
    setBankName(name);
    const saved = profiles.find((p) => p.bankName === name);
    if (saved && saved.mapping.date && mappedHeaders.includes(saved.mapping.date)) setMapping(saved.mapping);
  }

  async function uploadMapped() {
    if (!raw || !mapping || !bankName || !mapped || "error" in mapped || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      setProfiles(await api.bankStatements.saveProfile({ bankName, mapping }));
      const dto = await api.bankStatements.upload({
        accountId,
        bankName,
        iban: null,
        holderBin: null,
        periodFrom: mapped.periodFrom,
        periodTo: mapped.periodTo,
        openingBalance: null,
        closingBalance: null,
        fileName: raw.fileName,
        lines: mapped.lines,
      });
      setRaw(null);
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
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
        >
          <Upload className="h-4 w-4" strokeWidth={1.75} />
          Загрузить выписку (Excel, CSV)
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {raw && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground">{raw.fileName} — колонки выписки</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Банк</span>
            <select value={bankName} onChange={(e) => chooseBank(e.target.value)} className={selectClass}>
              <option value="">Выберите банк…</option>
              {BANK_NAMES.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {profiles.some((p) => p.bankName === b) ? " (схема сохранена)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {BANK_MAPPING_FIELDS.map((f) => (
              <label key={f.key} className="text-xs text-muted">
                {f.label}
                <select
                  value={(mapping?.[f.key] as string | null | undefined) ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...(m ?? { date: "" }), [f.key]: e.target.value || null }))}
                  className={`${selectClass} mt-1 w-full`}
                >
                  <option value="">—</option>
                  {mappedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {mapped && "error" in mapped && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{mapped.error}</p>}
          {mapped && !("error" in mapped) && (
            <p className="text-sm text-foreground">
              Операций: {mapped.lines.length} · {formatDate(mapped.periodFrom)} — {formatDate(mapped.periodTo)} · поступления{" "}
              {formatMoneyPrecise(mapped.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))} · списания{" "}
              {formatMoneyPrecise(mapped.lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0))}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setRaw(null)} className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-muted">
              Отмена
            </button>
            <button
              onClick={uploadMapped}
              disabled={busy || !accountId || !bankName || !mapped || "error" in mapped}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Загрузка…" : "Загрузить"}
            </button>
          </div>
        </div>
      )}

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

      <KeywordRulesCard />

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
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [directions, setDirections] = useState<DirectionDto[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    api.finance.categories.list().then((c) => setCategories(c.filter((x) => x.isActive))).catch(() => {});
    api.suppliers.list().then(setSuppliers).catch(() => {});
    api.customers.list().then(setCustomers).catch(() => {});
    api.locations.list().then((l) => setLocations(l.filter((x) => x.isActive !== false))).catch(() => {});
    api.directions.list().then(setDirections).catch(() => {});
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
          customerId: c.action === BankLineAction.CUSTOMER_PAYMENT ? c.customerId : null,
          locationId: c.action === BankLineAction.CATEGORY && l.amount < 0 && c.locationId ? c.locationId : null,
          directionId: c.action === BankLineAction.CATEGORY && l.amount < 0 && c.directionId ? c.directionId : null,
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
                            .filter((a) =>
                              out
                                ? a !== BankLineAction.SALES_SETTLEMENT && a !== BankLineAction.CUSTOMER_PAYMENT
                                : a !== BankLineAction.SUPPLIER_PAYMENT,
                            )
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
                        {c.action === BankLineAction.CATEGORY && out && (
                          <>
                            <select value={c.locationId} onChange={(e) => set(l.id, { locationId: e.target.value })} className={selectClass} aria-label="Точка">
                              <option value="">Без точки</option>
                              {locations.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                            <select value={c.directionId} onChange={(e) => set(l.id, { directionId: e.target.value })} className={selectClass} aria-label="Направление">
                              <option value="">Общий расход</option>
                              {directions.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                          </>
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
                        {c.action === BankLineAction.CUSTOMER_PAYMENT && (
                          <select value={c.customerId} onChange={(e) => set(l.id, { customerId: e.target.value })} className={selectClass}>
                            <option value="">Покупатель…</option>
                            {customers.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
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
                        {l.suggestion?.source === "KEYWORD" && <span className="text-xs text-muted">по ключевому слову</span>}
                        {l.suggestion?.source === "COUNTERPARTY" && <span className="text-xs text-muted">по БИН</span>}
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

// «Ключевые слова»: a word in the payment purpose → a ДДС article, suggested on every next statement.
function KeywordRulesCard() {
  const [rules, setRules] = useState<BankKeywordRuleDto[] | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [keyword, setKeyword] = useState("");
  const [direction, setDirection] = useState<1 | -1>(-1);
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.bankStatements.keywordRules().then(setRules).catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить правила"));
    api.finance.categories.list().then((c) => setCategories(c.filter((x) => x.isActive))).catch(() => {});
  }, []);

  const options = categories.filter((c) => c.kind === (direction === -1 ? FinanceCategoryKind.EXPENSE : FinanceCategoryKind.INCOME));

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="mb-3 text-sm font-semibold text-foreground">Ключевые слова в назначении платежа</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="часть слова: аренд, зарплат, налог"
          className={`${selectClass} w-64`}
        />
        <select value={direction} onChange={(e) => { setDirection(Number(e.target.value) as 1 | -1); setCategoryId(""); }} className={selectClass}>
          <option value={-1}>Списание</option>
          <option value={1}>Поступление</option>
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
          <option value="">Статья…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            setError(null);
            try {
              setRules(await api.bankStatements.addKeywordRule({ keyword: keyword.trim(), direction, categoryId }));
              setKeyword("");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
            }
          }}
          disabled={keyword.trim().length < 2 || !categoryId}
          className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          Добавить
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {rules && rules.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rules.map((r) => (
            <span key={r.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-sm">
              <span className="font-medium text-foreground">«{r.keyword}»</span>
              <span className="text-muted">
                {r.direction === -1 ? "списание" : "поступление"} → {r.categoryName}
              </span>
              <button
                onClick={async () => {
                  try {
                    setRules(await api.bankStatements.removeKeywordRule(r.id));
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : "Не удалось удалить");
                  }
                }}
                aria-label={`Удалить правило ${r.keyword}`}
                className="text-muted hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
