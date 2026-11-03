import type { ParsedBankLineDto } from "./bank";

// Reading a bank statement exported to Excel, once its first sheet is a grid of
// cells. Written for Kaspi Pay's «Выписка по текущему счёту» (header lines
// «Текущий счет:», «Период:», «Входящий остаток:»…, then a table whose header
// row has «Дата операции», «Дебет», «Кредит», «Наименование бенефициара /
// отправителя денег», «ИИК…», «КНП», «Назначение платежа»), and tolerant
// enough for another bank's export with the same column names. Pure: the
// browser unzips the file, this reads the cells.

export type Cell = string | number | null | undefined;

export interface ParsedBankStatement {
  bankName: string;
  iban: string | null;
  holderBin: string | null;
  holderName: string | null;
  periodFrom: string;
  periodTo: string;
  openingBalance: number | null;
  closingBalance: number | null;
  lines: ParsedBankLineDto[];
}

const text = (c: Cell): string => (c === null || c === undefined ? "" : String(c)).trim();

export function parseMoney(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = text(c).replace(/\s| /g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// «31.10.2026 20:59:09» in Almaty time (UTC+5) → an instant.
export function parseBankDateTime(c: Cell, endOfDay = false): string | null {
  const m = text(c).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  const time = h !== undefined ? `${h.padStart(2, "0")}:${mi}:${s ?? "00"}.000` : endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${y}-${mo}-${d}T${time}+05:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// «АО "KASPI BANK"\nИИН/БИН 971240001315» → the name and the БИН.
export function splitCounterparty(c: Cell): { name: string | null; bin: string | null } {
  const raw = text(c);
  if (!raw) return { name: null, bin: null };
  const bin = raw.match(/(?:ИИН|БИН)[^\d]*(\d{12})/i)?.[1] ?? null;
  const name = raw
    .replace(/(?:ИИН\/БИН|ИИН|БИН)[^\d]*\d{12}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name: name || null, bin };
}

const findLabel = (rows: Cell[][], label: RegExp): Cell[] | undefined => rows.find((r) => label.test(text(r[0])));
const valueAfterLabel = (row: Cell[] | undefined): Cell => row?.slice(1).find((c) => text(c) !== "");

export function parseBankStatementRows(rows: Cell[][]): ParsedBankStatement {
  const headerIndex = rows.findIndex((r) => r.some((c) => /дата операции/i.test(text(c))));
  if (headerIndex < 0) throw new Error("Не найдена таблица операций (нет колонки «Дата операции»)");
  const header = rows[headerIndex].map((c) => text(c).toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cols = {
    doc: col(/документ/),
    date: col(/дата операции/),
    debit: col(/^дебет/),
    credit: col(/^кредит/),
    name: col(/наименование/),
    iban: col(/иик|iban|счет/),
    knp: col(/кнп/),
    purpose: col(/назначение/),
  };
  if (cols.date < 0 || cols.debit < 0 || cols.credit < 0) throw new Error("В таблице нет колонок «Дебет» и «Кредит»");

  const head = rows.slice(0, headerIndex);
  const iban = text(valueAfterLabel(findLabel(head, /текущий сч[её]т|номер сч[её]та|iban/i))) || null;
  const holderBin = text(valueAfterLabel(findLabel(head, /ИИН\/БИН|БИН|ИИН/i))).replace(/\D/g, "") || null;
  const holderName = text(valueAfterLabel(findLabel(head, /наименование/i))) || null;
  const period = text(valueAfterLabel(findLabel(head, /период/i))).split(/\s*[-–—]\s*/);
  const openingBalance = parseMoney(valueAfterLabel(findLabel(head, /входящий остаток/i)));
  const closingBalance = parseMoney(valueAfterLabel(findLabel(head, /исходящий остаток/i)));
  const bankName = rows.some((r) => r.some((c) => /kaspi/i.test(text(c)) && /банк|bank/i.test(text(c)))) ? "Kaspi Bank" : "Банк";

  const lines: ParsedBankLineDto[] = [];
  for (const r of rows.slice(headerIndex + 1)) {
    if (r.some((c) => /^итого/i.test(text(c)))) break;
    const occurredAt = parseBankDateTime(r[cols.date]);
    if (!occurredAt) continue; // the numbering row «1 2 3 …», blank rows
    const debit = parseMoney(r[cols.debit]) ?? 0;
    const credit = parseMoney(r[cols.credit]) ?? 0;
    const amount = Math.round((credit - debit) * 100) / 100;
    if (amount === 0) continue;
    const who = splitCounterparty(cols.name >= 0 ? r[cols.name] : null);
    const docNumber = cols.doc >= 0 ? text(r[cols.doc]) : "";
    lines.push({
      docNumber: docNumber || `${occurredAt}|${amount}`,
      occurredAt,
      amount,
      counterpartyName: who.name,
      counterpartyBin: who.bin,
      counterpartyIban: cols.iban >= 0 ? text(r[cols.iban]) || null : null,
      knp: cols.knp >= 0 ? text(r[cols.knp]) || null : null,
      purpose: cols.purpose >= 0 ? text(r[cols.purpose]).replace(/\s+/g, " ") || null : null,
    });
  }
  if (lines.length === 0) throw new Error("В выписке не найдено ни одной операции");

  const sorted = lines.map((l) => l.occurredAt).sort();
  const periodFrom = parseBankDateTime(period[0]) ?? sorted[0];
  const periodTo = parseBankDateTime(period[1], true) ?? sorted[sorted.length - 1];
  return { bankName, iban, holderBin, holderName, periodFrom, periodTo, openingBalance, closingBalance, lines };
}
