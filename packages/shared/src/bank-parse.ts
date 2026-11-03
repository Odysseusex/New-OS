import type { ParsedBankLineDto } from "./bank";

// Reading a bank statement exported to Excel, once its first sheet is a grid of
// cells. Reads Банк ЦентрКредит's «Обороты по счетам» (.xls) as well. Written for Kaspi Pay's «Выписка по текущему счёту» (header lines
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

// A label and its value: «Входящий остаток:» with the value in a later cell
// (Kaspi), or «ИИН / БИН:   061107551240» in the same cell after the colon
// (Банк ЦентрКредит). Labels are looked for in the first cell of a row.
function labelled(rows: Cell[][], label: RegExp): Cell {
  for (const r of rows) {
    const first = text(r[0]);
    if (!label.test(first)) continue;
    const colon = first.indexOf(":");
    const inline = colon >= 0 ? first.slice(colon + 1).trim() : "";
    if (inline) return inline;
    return r.slice(1).find((c) => text(c) !== "");
  }
  return undefined;
}

// Header cells are often bilingual and broken over lines: «Күні / Дата»,
// «Алушының\nИИН / БИН \nполучателя».
const headerText = (c: Cell) => text(c).toLowerCase().replace(/\s+/g, " ");
const word = (w: string) => new RegExp(`(^|[\\s/(])${w}`);
const isHeaderRow = (r: Cell[]) => {
  const h = r.map(headerText);
  return h.some((x) => word("дебет").test(x)) && h.some((x) => word("кредит").test(x)) && h.some((x) => word("дата").test(x));
};

export function parseBankStatementRows(rows: Cell[][]): ParsedBankStatement {
  const headerIndex = rows.findIndex(isHeaderRow);
  if (headerIndex < 0) throw new Error("Не найдена таблица операций (нет колонок «Дата», «Дебет», «Кредит»)");
  const header = rows[headerIndex].map(headerText);
  const col = (re: RegExp, not?: RegExp) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const dateOp = col(/дата операции/);
  const cols = {
    doc: col(/документ|№ п\/п/),
    date: dateOp >= 0 ? dateOp : col(word("дата")),
    debit: col(word("дебет")),
    credit: col(word("кредит")),
    name: col(/наименование|корреспондент/, /банк корреспондент|бик|бск|иик|жск/),
    iban: col(/иик|iban|сч[её]т/),
    knp: col(/кнп/),
    purpose: col(/назначение/),
    senderBin: col(/бин отправителя/),
    recipientBin: col(/бин получателя/),
  };

  const head = rows.slice(0, headerIndex);
  const iban = text(labelled(head, /текущий сч[её]т|номер сч[её]та|iban|иик/i)) || null;
  const holderBin = text(labelled(head, /ИИН\/БИН|БИН|ИИН/i)).replace(/\D/g, "") || null;
  const holderName = text(labelled(head, /наименование|^клиент/i)) || null;
  // «Период: 01.10.2026 - 31.10.2026» (Kaspi) or «Движения по счету за 01.10.2026 по 31.10.2026».
  let period = text(labelled(head, /период/i)).split(/\s*[-–—]\s*/);
  if (!parseBankDateTime(period[0])) {
    const cell = head.flat().map(text).find((c) => /движени[яе] по сч[её]ту/i.test(c) && /\d{2}\.\d{2}\.\d{4}.*\d{2}\.\d{2}\.\d{4}/.test(c));
    period = cell?.match(/\d{2}\.\d{2}\.\d{4}/g) ?? [];
  }
  // The closing balance may come after the table (Банк ЦентрКредит).
  const openingBalance = parseMoney(labelled(rows, /входящ(ий|ее)\s+(остаток|сальдо)/i));
  const closingBalance = parseMoney(labelled(rows, /исходящ(ий|ее)\s+(остаток|сальдо)/i));
  const headText = head.flat().map(text).join(" ");
  const bankName = /центркредит/i.test(headText)
    ? "Банк ЦентрКредит"
    : rows.some((r) => r.some((c) => /kaspi/i.test(text(c)) && /банк|bank/i.test(text(c))))
      ? "Kaspi Bank"
      : "Банк";

  const lines: ParsedBankLineDto[] = [];
  for (const r of rows.slice(headerIndex + 1)) {
    if (r.some((c) => /(^|\/\s*)итого/i.test(text(c)))) break; // «Итого», «Жиынтығы / Итого:»
    const occurredAt = parseBankDateTime(r[cols.date]);
    if (!occurredAt) continue; // the numbering row «1 2 3 …», blank rows
    const debit = parseMoney(r[cols.debit]) ?? 0;
    const credit = parseMoney(r[cols.credit]) ?? 0;
    const amount = Math.round((credit - debit) * 100) / 100;
    if (amount === 0) continue;
    const who = splitCounterparty(cols.name >= 0 ? r[cols.name] : null);
    // Банк ЦентрКредит puts the БИН in its own columns: the sender's on a credit, the recipient's on a debit.
    const binCol = amount > 0 ? cols.senderBin : cols.recipientBin;
    const binCell = binCol >= 0 ? text(r[binCol]).replace(/\D/g, "") : "";
    if (!who.bin && binCell.length === 12) who.bin = binCell;
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
