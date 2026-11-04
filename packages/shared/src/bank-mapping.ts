import type { ParsedBankLineDto } from "./bank";
import { parseBankDateTime, parseMoney, splitCounterparty, type Cell, type ParsedBankStatement } from "./bank-parse";

// A statement from any bank (ТЗ §6.2): the file's columns are mapped to our
// fields once — which header is the date, the amounts, the counterparty — and
// the mapping is saved for that bank. Kaspi and BCC are recognised without it.

export const BANK_NAMES = ["Kaspi", "Halyk", "Freedom", "Forte", "BCC", "Jusan", "Bereke", "Другой"];

export interface BankColumnMappingDto {
  // Header texts, exactly as in the file.
  date: string;
  // Either one signed amount column, or money in / money out.
  amount?: string | null;
  inflow?: string | null;
  outflow?: string | null;
  counterparty?: string | null;
  bin?: string | null;
  purpose?: string | null;
  docNumber?: string | null;
}

export interface BankImportProfileDto {
  bankName: string;
  mapping: BankColumnMappingDto;
}

export const BANK_MAPPING_FIELDS: { key: keyof BankColumnMappingDto; label: string }[] = [
  { key: "date", label: "Дата" },
  { key: "inflow", label: "Поступление (приход)" },
  { key: "outflow", label: "Списание (расход)" },
  { key: "amount", label: "Сумма со знаком" },
  { key: "counterparty", label: "Контрагент" },
  { key: "bin", label: "БИН/ИИН" },
  { key: "purpose", label: "Назначение платежа" },
  { key: "docNumber", label: "Номер документа" },
];

const text = (c: Cell): string => (c === null || c === undefined ? "" : String(c)).replace(/\s+/g, " ").trim();
const norm = (c: Cell) => text(c).toLowerCase().replace(/ё/g, "е");

// ── CSV ──
// «;» (Kazakh/Russian exports), «,» or tab, whichever the first lines use most;
// quoted fields may hold the separator, doubled quotes and line breaks.
export function readCsv(source: string): Cell[][] {
  const body = source.replace(/^﻿/, "");
  const sample = body.split(/\r?\n/).slice(0, 10).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const sep = [";", "\t", ","].sort((a, b) => count(b) - count(a))[0];
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => text(c) !== ""));
}

// ── dates ──
// «31.10.2026 14:05», «31/10/2026», «2026-10-31 14:05», an Excel day number — read in Almaty time.
export function parseAnyBankDate(c: Cell): string | null {
  if (typeof c === "number" && c > 30000 && c < 80000) {
    // Excel's day 25569 is 1970-01-01; the fraction is the time of day (wall clock in Almaty).
    const ms = Math.round((c - 25569) * 86_400_000);
    return new Date(ms - 5 * 3_600_000).toISOString();
  }
  const s = text(c);
  const dotted = parseBankDateTime(s.replace(/\//g, "."));
  if (dotted) return dotted;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, mo, d, h, mi, sec] = iso;
    const time = h !== undefined ? `${h.padStart(2, "0")}:${mi}:${sec ?? "00"}` : "00:00:00";
    const date = new Date(`${y}-${mo}-${d}T${time}+05:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

// ── finding the table ──
const DATE_WORDS = /дата|date|күні/;

// The header row: the first of the first 40 rows with a date-like header and at least three filled cells.
export function findHeaderRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const filled = rows[i].filter((c) => text(c) !== "");
    if (filled.length >= 3 && filled.some((c) => typeof c === "string" && DATE_WORDS.test(norm(c)))) return i;
  }
  return -1;
}

export function headersOf(rows: Cell[][]): string[] {
  const h = findHeaderRow(rows);
  return h < 0 ? [] : rows[h].map(text);
}

// A first guess at which header is which; the person checks it before loading.
export function guessColumnMapping(headers: string[]): BankColumnMappingDto | null {
  const lower = headers.map((h) => norm(h));
  const find = (re: RegExp, except?: RegExp) => {
    const i = lower.findIndex((h) => re.test(h) && !(except && except.test(h)));
    return i >= 0 ? headers[i] : null;
  };
  const date = find(/дата|date|күні/);
  if (!date) return null;
  const inflow = find(/кредит|приход|поступ|зачисл|credit|income/);
  const outflow = find(/дебет|расход|списан|debit|expense/);
  const amount = inflow || outflow ? null : find(/сумма|amount/);
  return {
    date,
    inflow,
    outflow,
    amount,
    counterparty: find(/контрагент|наименование|получател|отправител|плательщик|counterparty|бенефициар/, /назначени/),
    bin: find(/бин|иин|bin/),
    purpose: find(/назначени|purpose|описани|комментари/),
    docNumber: find(/номер|№|документ|document/, /дата/),
  };
}

// FNV-1a over a string: a short stable key for lines whose bank gives no document number.
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// The statement as the mapping reads it. A line with no document number gets one
// from date + amount + counterparty + purpose (ТЗ: «повторная загрузка той же
// операции не создаёт копию»), with a counter for identical lines in one file.
export function parseMappedStatement(rows: Cell[][], mapping: BankColumnMappingDto, bankName: string): ParsedBankStatement | { error: string } {
  const h = findHeaderRow(rows);
  if (h < 0) return { error: "Не найдена строка заголовков таблицы (с колонкой даты)" };
  const header = rows[h].map(text);
  const col = (name: string | null | undefined) => (name ? header.findIndex((x) => x === name) : -1);
  const at = {
    date: col(mapping.date),
    amount: col(mapping.amount),
    inflow: col(mapping.inflow),
    outflow: col(mapping.outflow),
    counterparty: col(mapping.counterparty),
    bin: col(mapping.bin),
    purpose: col(mapping.purpose),
    docNumber: col(mapping.docNumber),
  };
  if (at.date < 0) return { error: `В файле нет колонки «${mapping.date}»` };
  if (at.amount < 0 && at.inflow < 0 && at.outflow < 0) return { error: "Укажите колонку суммы или колонки прихода и расхода" };

  const seen = new Map<string, number>();
  const lines: ParsedBankLineDto[] = [];
  for (const r of rows.slice(h + 1)) {
    const occurredAt = parseAnyBankDate(r[at.date]);
    if (!occurredAt) continue;
    const signed =
      at.amount >= 0
        ? (parseMoney(r[at.amount]) ?? 0)
        : (at.inflow >= 0 ? Math.abs(parseMoney(r[at.inflow]) ?? 0) : 0) - (at.outflow >= 0 ? Math.abs(parseMoney(r[at.outflow]) ?? 0) : 0);
    const amount = Math.round(signed * 100) / 100;
    if (amount === 0) continue;
    const party = at.counterparty >= 0 ? splitCounterparty(r[at.counterparty]) : { name: null, bin: null };
    const binText = at.bin >= 0 ? text(r[at.bin]).replace(/\D/g, "") : "";
    const bin = /^\d{12}$/.test(binText) ? binText : party.bin;
    const purpose = at.purpose >= 0 ? text(r[at.purpose]) || null : null;
    let docNumber = at.docNumber >= 0 ? text(r[at.docNumber]) : "";
    if (!docNumber) {
      const base = `auto:${fnv([occurredAt, amount.toFixed(2), bin ?? party.name ?? "", purpose ?? ""].join("|"))}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      docNumber = n === 1 ? base : `${base}:${n}`;
    }
    lines.push({ docNumber, occurredAt, amount, counterpartyName: party.name, counterpartyBin: bin, counterpartyIban: null, knp: null, purpose });
  }
  if (lines.length === 0) return { error: "В файле не найдено ни одной операции с датой и суммой" };
  const dates = lines.map((l) => l.occurredAt).sort();
  return {
    bankName,
    iban: null,
    holderBin: null,
    holderName: null,
    periodFrom: dates[0],
    periodTo: dates[dates.length - 1],
    openingBalance: null,
    closingBalance: null,
    lines,
  };
}
