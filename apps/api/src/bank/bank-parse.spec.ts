import { guessColumnMapping, headersOf, parseMappedStatement, readCsv, parseAnyBankDate } from "@bakery-os/shared";
import { readFileSync } from "fs";
import { join } from "path";
import { BankLineAction, BankPresetCategory, parseBankStatementRows, readXlsFirstSheet } from "@bakery-os/shared";
import { builtInSuggestion, settlementDateOf } from "./bank-statements.service";

// Reading statements of both banks the owner uses. Every figure here is
// invented — the real files carry personal data and never enter the repo.

describe("reading a bank statement", () => {
  it("reads Kaspi Pay's layout (labels in the first cell, values further right)", () => {
    const rows = [
      [null],
      ["Текущий счет: ", null, "KZ000000000000000010"],
      ["Период:", null, "01.09.2026 - 30.09.2026"],
      ["ИИН/БИН: ", null, "990101000001"],
      ["Наименование: ", null, "ИП ТЕСТ"],
      ["Входящий остаток:", null, 100, null, "KZT"],
      ["Исходящий остаток:", null, 1550, null, "KZT"],
      ["№\nдокумента", "Дата операции", "Дебет", "Кредит", "Наименование бенефициара / отправителя денег", "ИИК бенефициара / отправителя денег", "БИК банка", "КНП", "Назначение платежа"],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      ["11", "02.09.2026 09:00:00", null, 1500, 'АО "KASPI BANK"\nИИН/БИН 971240001315', "KZ1", "", "190", "Продажи с Kaspi.kz за 01/09/2026"],
      ["12", "03.09.2026 10:00:00", 50, null, "ТОО Kaspi Pay\nИИН/БИН 200840000951", "KZ2", "", "851", "Оплата за услуги процессинга"],
    ];
    const p = parseBankStatementRows(rows);
    expect(p).toMatchObject({ bankName: "Kaspi Bank", iban: "KZ000000000000000010", holderBin: "990101000001", holderName: "ИП ТЕСТ", openingBalance: 100, closingBalance: 1550 });
    expect(p.periodFrom).toBe("2026-08-31T19:00:00.000Z");
    expect(p.lines.map((l) => [l.docNumber, l.amount, l.counterpartyBin])).toEqual([
      ["11", 1500, "971240001315"],
      ["12", -50, "200840000951"],
    ]);
  });

  it("reads Банк ЦентрКредит's old Excel (.xls) «Обороты по счетам»", () => {
    const file = readFileSync(join(__dirname, "../../test/fixtures/bcc-statement-invented.xls"));
    const p = parseBankStatementRows(readXlsFirstSheet(new Uint8Array(file)));
    expect(p).toMatchObject({
      bankName: "Банк ЦентрКредит",
      iban: "KZ000000000000000001",
      holderBin: "990101000001",
      holderName: "Индивидуальный предприниматель ТЕСТ",
      periodFrom: "2026-08-31T19:00:00.000Z",
      periodTo: "2026-09-30T18:59:59.999Z",
      openingBalance: 1000,
      closingBalance: 4000.5, // after the table
    });
    // The БИН sits in its own columns: the sender's on a credit, the recipient's on a debit.
    expect(p.lines.map((l) => [l.docNumber, l.amount, l.counterpartyBin, l.knp])).toEqual([
      ["NT-000001", 2500, "980640000093", "190"],
      ["NT-000002", 1200.5, "980640000093", "190"],
      ["NT-000003", -700, "000000000009", "841"],
    ]);
    const sum = p.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(((p.openingBalance ?? 0) + sum) * 100) / 100).toBe(p.closingBalance);
  });

  it("refuses a file that is not an old Excel file", () => {
    expect(() => readXlsFirstSheet(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/не файл Excel/);
  });

  it("knows a Банк ЦентрКредит payout is the previous day's takings", () => {
    const line = { amount: 2500, knp: "190", purpose: "Возмещение коммерсанту: у-во 1, г. Тест, на сумму 2500KZT минус комиссия 0KZT" };
    expect(builtInSuggestion(line)).toMatchObject({ action: BankLineAction.SALES_SETTLEMENT });
    expect(builtInSuggestion({ ...line, purpose: "Возмещение НПК QR: у-во 1" })).toMatchObject({ action: BankLineAction.SALES_SETTLEMENT });
    // Arrived 02.09 at 06:10 Almaty → the takings of 01.09; also across a month end.
    expect(settlementDateOf(line.purpose, new Date("2026-09-02T01:10:00Z"))).toBe("2026-09-01");
    expect(settlementDateOf(line.purpose, new Date("2026-10-01T00:30:00Z"))).toBe("2026-09-30");
    expect(builtInSuggestion({ amount: -700, knp: "841", purpose: "Расчет комиссии Опция" })).toMatchObject({ presetCategory: BankPresetCategory.BANK_FEE });
  });
});

describe("any bank's file by a column mapping", () => {
  const csv = [
    "Выписка по счёту KZ00;;;;;",
    "Дата операции;Приход;Расход;Получатель / Отправитель;БИН;Назначение платежа",
    '01.10.2026 10:15;;1 200,50;ТОО Аренда Плюс;123456789012;"Аренда; октябрь"',
    "01.10.2026 11:00;5000;;ТОО Мерей;999988887777;Оплата за хлеб",
    "01.10.2026 11:00;5000;;ТОО Мерей;999988887777;Оплата за хлеб",
    ";;;;;",
  ].join("\r\n");

  it("reads a CSV with «;», quotes and a title line, and guesses the columns", () => {
    const rows = readCsv(csv);
    expect(rows[2][5]).toBe("Аренда; октябрь");
    const mapping = guessColumnMapping(headersOf(rows))!;
    expect(mapping).toMatchObject({ date: "Дата операции", inflow: "Приход", outflow: "Расход", counterparty: "Получатель / Отправитель", bin: "БИН", purpose: "Назначение платежа" });

    const parsed = parseMappedStatement(rows, mapping, "Halyk");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.lines.map((l) => [l.amount, l.counterpartyBin])).toEqual([
      [-1200.5, "123456789012"],
      [5000, "999988887777"],
      [5000, "999988887777"],
    ]);
    // No document number in the file: the same operation always gets the same key, two identical ones differ.
    const again = parseMappedStatement(readCsv(csv), mapping, "Halyk");
    if ("error" in again) throw new Error(again.error);
    expect(again.lines.map((l) => l.docNumber)).toEqual(parsed.lines.map((l) => l.docNumber));
    expect(new Set(parsed.lines.map((l) => l.docNumber)).size).toBe(3);
    expect(parsed.lines[0].occurredAt).toBe("2026-10-01T05:15:00.000Z");
  });

  it("reads dates in several shapes and an amount column with a sign", () => {
    expect(parseAnyBankDate("2026-10-01 10:15")).toBe("2026-10-01T05:15:00.000Z");
    expect(parseAnyBankDate("01/10/2026")).toBe("2026-09-30T19:00:00.000Z");
    expect(parseAnyBankDate(46296.5)).toBe("2026-10-01T07:00:00.000Z");
    const rows = readCsv("Date,Amount,Description\n2026-10-01,-300,Fee\n2026-10-02,700,Payment");
    const parsed = parseMappedStatement(rows, { date: "Date", amount: "Amount", purpose: "Description" }, "Freedom");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.lines.map((l) => l.amount)).toEqual([-300, 700]);
    expect(parseMappedStatement(rows, { date: "Нет такой" }, "X")).toEqual({ error: "В файле нет колонки «Нет такой»" });
  });
});
