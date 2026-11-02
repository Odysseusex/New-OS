"use client";

import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import type { CounterpartyStatementDto } from "@bakery-os/shared";
import { DebtCounterpartyKind, statementConclusion } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { downloadCsv } from "@/lib/csv";
import { formatMoneyPrecise } from "@/lib/format";
import { firstOfMonthKey, zonedDateKey } from "@/lib/reporting-period";

const inputClass =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const keyLabel = (key: string) => key.split("-").reverse().join(".");
const amount = (n: number) => (Math.abs(n) < 0.005 ? "" : formatMoneyPrecise(n));
// On the paper the currency is in the column heading, so amounts are bare.
const paperAmount = (n: number) =>
  Math.abs(n) < 0.005 ? "" : n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ourName = (s: CounterpartyStatementDto) => s.organization.legalName || s.organization.name;

// The акт сверки взаиморасчётов in its usual form: our figures on the left,
// an empty right half for the counterparty to fill in from their own books,
// the closing sentence, and room for both signatures. Printed from the
// browser, where «Сохранить как PDF» makes the PDF.
function printAct(s: CounterpartyStatementDto) {
  const us = ourName(s);
  const them = s.counterparty.name;
  const bin = (b: string | null) => (b ? `, БИН/ИИН ${escapeHtml(b)}` : "");
  const row = (date: string, doc: string, debit: number, credit: number, strong = false) =>
    `<tr${strong ? ' class="s"' : ""}><td>${date}</td><td>${escapeHtml(doc)}</td><td class="n">${paperAmount(debit)}</td><td class="n">${paperAmount(credit)}</td><td></td><td></td><td></td><td></td></tr>`;
  const side = (balance: number) => (balance >= 0 ? [balance, 0] : [0, -balance]) as [number, number];
  const [od, oc] = side(s.opening);
  const [cd, cc] = side(s.closing);
  const body = [
    row("", `Сальдо на ${keyLabel(s.fromKey)}`, od, oc, true),
    ...s.lines.map((l) => row(keyLabel(l.dateKey), l.document, l.debit, l.credit)),
    row("", "Обороты за период", s.turnoverDebit, s.turnoverCredit, true),
    row("", `Сальдо на ${keyLabel(s.toKey)}`, cd, cc, true),
  ].join("");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Акт сверки — ${escapeHtml(them)}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;margin:18px;color:#000}h1{font-size:16px;text-align:center;margin:0 0 4px}
p{margin:4px 0}.c{text-align:center}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #777;padding:3px 4px;vertical-align:top}
th{background:#eee;font-weight:bold}.n{text-align:right;white-space:nowrap}.s td{font-weight:bold;background:#f6f6f6}
.sign{display:flex;gap:40px;margin-top:24px}.sign div{flex:1}.line{margin-top:22px}</style></head><body>
<h1>Акт сверки взаиморасчётов</h1>
<p class="c">за период с ${keyLabel(s.fromKey)} по ${keyLabel(s.toKey)}</p>
<p class="c">между ${escapeHtml(us)}${bin(s.organization.bin)} и ${escapeHtml(them)}${bin(s.counterparty.bin)}</p>
<p>Мы, нижеподписавшиеся, составили настоящий акт о том, что состояние взаимных расчётов по данным учёта следующее:</p>
<table><thead>
<tr><th colspan="4">По данным ${escapeHtml(us)}, ₸</th><th colspan="4">По данным ${escapeHtml(them)}, ₸</th></tr>
<tr><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th></tr>
</thead><tbody>${body}</tbody></table>
<p><b>По данным ${escapeHtml(us)}:</b> ${escapeHtml(statementConclusion(s.closing, us, them))}</p>
<p><b>По данным ${escapeHtml(them)}:</b> ______________________________________________</p>
<div class="sign"><div><p><b>От ${escapeHtml(us)}</b></p><p class="line">Руководитель ______________ / ______________ /</p><p class="line">Главный бухгалтер ______________ / ______________ /</p><p class="line">М.П.</p></div>
<div><p><b>От ${escapeHtml(them)}</b></p><p class="line">Руководитель ______________ / ______________ /</p><p class="line">Главный бухгалтер ______________ / ______________ /</p><p class="line">М.П.</p></div></div>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function exportCsv(s: CounterpartyStatementDto) {
  const rows: (string | number)[][] = [
    ["", `Сальдо на ${keyLabel(s.fromKey)}`, "", "", s.opening],
    ...s.lines.map((l) => [keyLabel(l.dateKey), l.document, l.debit || "", l.credit || "", l.balance]),
    ["", "Обороты за период", s.turnoverDebit, s.turnoverCredit, ""],
    ["", `Сальдо на ${keyLabel(s.toKey)}`, "", "", s.closing],
  ];
  downloadCsv(`akt-sverki-${s.counterparty.name}-${s.fromKey}-${s.toKey}.csv`, ["Дата", "Документ", "Дебет", "Кредит", "Сальдо"], rows);
}

export function CounterpartyStatementModal({
  kind,
  counterpartyId,
  name,
  onClose,
}: {
  kind: DebtCounterpartyKind;
  counterpartyId: string;
  name: string;
  onClose: () => void;
}) {
  const today = zonedDateKey();
  const [from, setFrom] = useState(firstOfMonthKey(today));
  const [to, setTo] = useState(today);
  const [statement, setStatement] = useState<CounterpartyStatementDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.debts
      .statement({ kind, id: counterpartyId, from, to })
      .then((s) => !cancelled && setStatement(s))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Не удалось загрузить карточку контрагента"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [kind, counterpartyId, from, to]);

  return (
    <Modal title={`Карточка контрагента: ${name}`} onClose={onClose} width="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">С</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">По</label>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={!statement}
            onClick={() => statement && exportCsv(statement)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            CSV
          </button>
          <button
            type="button"
            disabled={!statement}
            onClick={() => statement && printAct(statement)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Акт сверки
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && !statement && <p className="py-8 text-center text-sm text-muted">Загрузка…</p>}

      {statement && (
        <div className={loading ? "opacity-60" : undefined}>
          {statement.counterparty.bin && <p className="mb-2 text-xs text-muted">БИН/ИИН {statement.counterparty.bin}</p>}
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Документ</th>
                  <th className="px-3 py-2 text-right font-medium">Дебет</th>
                  <th className="px-3 py-2 text-right font-medium">Кредит</th>
                  <th className="px-3 py-2 text-right font-medium">Сальдо</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-surface-muted font-medium">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-foreground">Сальдо на {keyLabel(statement.fromKey)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right text-foreground">{formatMoneyPrecise(statement.opening)}</td>
                </tr>
                {statement.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{keyLabel(l.dateKey)}</td>
                    <td className="px-3 py-2 text-foreground">{l.document}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{amount(l.debit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{amount(l.credit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{formatMoneyPrecise(l.balance)}</td>
                  </tr>
                ))}
                {statement.lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                      Операций за период нет
                    </td>
                  </tr>
                )}
                <tr className="bg-surface-muted font-medium">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-foreground">Обороты за период</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{formatMoneyPrecise(statement.turnoverDebit)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{formatMoneyPrecise(statement.turnoverCredit)}</td>
                  <td className="px-3 py-2" />
                </tr>
                <tr className="bg-surface-muted font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-foreground">Сальдо на {keyLabel(statement.toKey)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{formatMoneyPrecise(statement.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            {statementConclusion(statement.closing, ourName(statement), statement.counterparty.name)}
          </p>
        </div>
      )}
    </Modal>
  );
}
