import { Injectable } from "@nestjs/common";
import {
  AccountingEventStatus,
  CoverageStatus,
  DiagnosticSeverity,
  DiagnosticStatus,
  FinancialEventType,
  LedgerCoverageDto,
  LedgerCoverageRowDto,
  LedgerDiagnosticDto,
  LedgerDiagnosticsReportDto,
  SYSTEM_ACCOUNT_DEFS,
  SystemAccountKey,
} from "@bakery-os/shared";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../costing/costing.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { FinanceService } from "../finance/finance.service";
import { BalanceService, BALANCE_TOLERANCE } from "../finance/balance/balance.service";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerService } from "./ledger.service";
import { decideEvent, draftFingerprint } from "./posting-rules";
import { loadPostingContext } from "./event-posting";

// One place that asks every question the books can be asked about themselves.
// A check never repairs anything and never hides what it finds: it reports what
// it expected, what it found and the difference, and says where the number came from.

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Result {
  check: string;
  title: string;
  expected: number | string | null;
  actual: number | string | null;
  source: string;
  details?: string[];
  // How a difference is judged; default is "any difference beyond tolerance fails".
  tolerance?: number;
  severity?: DiagnosticSeverity;
  // Overrides the verdict for checks that count findings rather than compare figures.
  count?: number;
}

@Injectable()
export class LedgerDiagnosticsService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
    private balance: BalanceService,
    private reports: LedgerReportsService,
    private ledger: LedgerService,
  ) {}

  async run(organizationId: string): Promise<LedgerDiagnosticsReportDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
    const generatedAt = new Date().toISOString();
    if (!org.ledgerStartsAt) {
      return { generatedAt, enabled: false, checks: [], summary: { pass: 0, fail: 0, warning: 0, notAvailable: 0 } };
    }
    const now = new Date();
    const status = await this.ledger.getStatus(organizationId);

    const tb = await this.ledger.getTrialBalance(organizationId, {});
    const sheet = await this.reports.getBalanceSheet(organizationId, now);
    const glBalance = new Map<SystemAccountKey, number>();
    for (const a of await this.prisma.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { not: null } }, select: { id: true, systemAccountKey: true } })) {
      const g = await this.prisma.journalLine.aggregate({ where: { organizationId, accountId: a.id }, _sum: { debit: true, credit: true } });
      const d = Number(g._sum.debit ?? 0);
      const c = Number(g._sum.credit ?? 0);
      const normal = SYSTEM_ACCOUNT_DEFS[a.systemAccountKey as SystemAccountKey].normalBalance;
      glBalance.set(a.systemAccountKey as SystemAccountKey, r2(normal === "DEBIT" ? d - c : c - d));
    }
    const gl = (k: SystemAccountKey) => glBalance.get(k) ?? 0;

    const openingNote = status.openingEntryPosted ? [] : ["Начальный остаток в главную книгу не проведён — до его проводки расхождения ожидаемы"];
    const out: LedgerDiagnosticDto[] = [];
    const push = (r: Result, kind: "compare" | "count" | "info" = "compare") => out.push(this.finish(r, kind));

    // 1–2 the arithmetic of the books themselves
    push({ check: "TB_BALANCED", title: "Оборотно-сальдовая ведомость сбалансирована", expected: tb.totals.closingCredit, actual: tb.totals.closingDebit, source: "Главная книга", severity: "CRITICAL", tolerance: 0 });
    push({
      check: "BALANCE_EQUATION",
      title: "Активы = Обязательства + Капитал",
      expected: r2(sheet.liabilities.total + sheet.equity.total),
      actual: sheet.assets.total,
      source: "Главная книга",
      severity: "CRITICAL",
      tolerance: 0,
    });

    // 3–7 the ledger against the operational subledgers
    const [inventoryValue, payables, receivables, cashRows, fixedAssets] = await Promise.all([
      this.balance.inventoryValueAt(organizationId, now),
      this.finance.getPayablesBreakdown(organizationId),
      this.finance.getAccountsReceivable(organizationId),
      this.prisma.cashAccount.findMany({ where: { organizationId }, select: { type: true, currentBalance: true } }),
      this.balance.fixedAssetsAt(organizationId, now),
    ]);
    push({ check: "INVENTORY_SUBLEDGER", title: "Запасы: складской учёт × себестоимость = главная книга", expected: inventoryValue, actual: gl(SystemAccountKey.INVENTORY), source: "Остатки склада × CostingService / главная книга", details: openingNote, tolerance: BALANCE_TOLERANCE, severity: "ERROR" });
    push({
      check: "AP_SUBLEDGER",
      title: "Кредиторская задолженность: документы = главная книга",
      expected: r2(payables.suppliers + payables.expenses + payables.consignment),
      actual: r2(gl(SystemAccountKey.SUPPLIER_PAYABLES) + gl(SystemAccountKey.EXPENSE_PAYABLES) + gl(SystemAccountKey.CONSIGNMENT_PAYABLES)),
      source: "Документы закупок и расходов / главная книга",
      details: openingNote,
      tolerance: BALANCE_TOLERANCE,
      severity: "ERROR",
    });
    push({ check: "AR_SUBLEDGER", title: "Дебиторская задолженность: продажи = главная книга", expected: receivables, actual: gl(SystemAccountKey.RECEIVABLES), source: "Продажи и платежи / главная книга", details: openingNote, tolerance: BALANCE_TOLERANCE, severity: "ERROR" });
    const cashExpected = r2(cashRows.reduce((s, c) => s + c.currentBalance.toNumber(), 0));
    push({ check: "CASH_BANK_SUBLEDGER", title: "Касса и банк: денежный журнал = главная книга", expected: cashExpected, actual: r2(gl(SystemAccountKey.CASH_ON_HAND) + gl(SystemAccountKey.BANK)), source: "Остатки счетов / главная книга", details: openingNote, tolerance: BALANCE_TOLERANCE, severity: "ERROR" });
    push({ check: "FIXED_ASSETS_SUBLEDGER", title: "Основные средства: реестр = главная книга", expected: fixedAssets, actual: gl(SystemAccountKey.FIXED_ASSETS), source: "Реестр основных средств / главная книга", details: openingNote, tolerance: BALANCE_TOLERANCE, severity: "ERROR" });

    // 8–9 statements agree with each other
    const pnlAll = await this.reports.getPnl(organizationId, org.ledgerStartsAt, now);
    push({ check: "PNL_EQUITY", title: "Чистая прибыль отчёта = результат в капитале", expected: pnlAll.netProfit, actual: sheet.equity.accumulatedResult, source: "ОПиУ и баланс из главной книги", severity: "CRITICAL", tolerance: 0 });
    const flow = await this.reports.getCashFlow(organizationId, org.ledgerStartsAt, now);
    push({ check: "DDS_CASH", title: "ДДС: конечный остаток = касса и банк в главной книге", expected: r2(gl(SystemAccountKey.CASH_ON_HAND) + gl(SystemAccountKey.BANK)), actual: flow.closingBalance, source: "ДДС из главной книги", severity: "ERROR", tolerance: 0 });

    // 10–17 structural integrity, straight from the tables
    await this.structural(organizationId, push);

    // 18–20 ledger against the events it came from
    await this.againstEvents(organizationId, org.ledgerStartsAt, push);

    return {
      generatedAt,
      enabled: true,
      checks: out,
      summary: {
        pass: out.filter((c) => c.status === "PASS").length,
        fail: out.filter((c) => c.status === "FAIL").length,
        warning: out.filter((c) => c.status === "WARNING").length,
        notAvailable: out.filter((c) => c.status === "NOT_AVAILABLE").length,
      },
    };
  }

  private finish(r: Result, kind: "compare" | "count" | "info"): LedgerDiagnosticDto {
    let status: DiagnosticStatus;
    let difference: number | null = null;
    if (kind === "count") {
      const n = r.count ?? 0;
      status = n === 0 ? "PASS" : r.severity === "WARNING" || r.severity === "INFO" ? "WARNING" : "FAIL";
      difference = n;
    } else if (kind === "info") {
      status = "NOT_AVAILABLE";
    } else if (typeof r.expected === "number" && typeof r.actual === "number") {
      difference = r2(r.actual - r.expected);
      status = Math.abs(difference) <= (r.tolerance ?? 0.005) ? "PASS" : "FAIL";
    } else {
      status = "NOT_AVAILABLE";
    }
    return {
      check: r.check,
      title: r.title,
      status,
      expected: r.expected,
      actual: r.actual,
      difference,
      severity: status === "PASS" ? "INFO" : r.severity ?? "ERROR",
      source: r.source,
      ...(r.details && r.details.length > 0 ? { details: r.details } : {}),
    };
  }

  private async structural(organizationId: string, push: (r: Result, kind?: "compare" | "count" | "info") => void): Promise<void> {
    const q = <T,>(sql: TemplateStringsArray, ...values: unknown[]) => this.prisma.$queryRaw<T[]>(sql as never, ...(values as never[]));
    const [noJournal, orphanEntries, unbalanced, duplicates, foreignPeriod, closedPosting, badAmounts, badAccounts, noLines] = await Promise.all([
      q<{ id: string }>`SELECT e."id" FROM "accounting_events" e LEFT JOIN "journal_entries" j ON j."accountingEventId" = e."id" WHERE e."organizationId" = ${organizationId} AND e."status" = 'POSTED' AND j."id" IS NULL`,
      q<{ id: string }>`SELECT j."id" FROM "journal_entries" j LEFT JOIN "accounting_events" e ON e."id" = j."accountingEventId" WHERE j."organizationId" = ${organizationId} AND j."kind" = 'STANDARD' AND (j."accountingEventId" IS NULL OR e."id" IS NULL OR e."organizationId" <> j."organizationId")`,
      q<{ id: string }>`SELECT "journalEntryId" AS "id" FROM "journal_lines" WHERE "organizationId" = ${organizationId} GROUP BY "journalEntryId" HAVING SUM("debit") <> SUM("credit")`,
      q<{ id: string }>`SELECT MIN(j."id") AS "id" FROM "journal_entries" j WHERE j."organizationId" = ${organizationId} AND j."kind" = 'STANDARD' AND j."reference" IS NOT NULL GROUP BY j."reference", j."description" HAVING COUNT(*) > 1`,
      q<{ id: string }>`SELECT j."id" FROM "journal_entries" j LEFT JOIN "financial_periods" p ON p."id" = j."accountingPeriodId" WHERE j."organizationId" = ${organizationId} AND (p."id" IS NULL OR p."organizationId" <> j."organizationId")`,
      q<{ id: string }>`SELECT j."id" FROM "journal_entries" j JOIN "financial_periods" p ON p."id" = j."accountingPeriodId" WHERE j."organizationId" = ${organizationId} AND p."status" = 'CLOSED' AND p."closedAt" IS NOT NULL AND j."postedAt" > p."closedAt"`,
      q<{ id: string }>`SELECT "id" FROM "journal_lines" WHERE "organizationId" = ${organizationId} AND ("debit" < 0 OR "credit" < 0 OR "amount" <= 0)`,
      q<{ id: string }>`SELECT l."id" FROM "journal_lines" l JOIN "ledger_accounts" a ON a."id" = l."accountId" WHERE l."organizationId" = ${organizationId} AND (a."organizationId" <> l."organizationId")`,
      q<{ id: string }>`SELECT j."id" FROM "journal_entries" j LEFT JOIN "journal_lines" l ON l."journalEntryId" = j."id" WHERE j."organizationId" = ${organizationId} GROUP BY j."id" HAVING COUNT(l."id") < 2`,
    ]);
    const systemTypeMismatch = (
      await this.prisma.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { not: null } }, select: { code: true, type: true, normalBalance: true, systemAccountKey: true } })
    ).filter((a) => {
      const def = SYSTEM_ACCOUNT_DEFS[a.systemAccountKey as SystemAccountKey];
      return !def || def.type !== a.type || def.normalBalance !== a.normalBalance;
    });
    const list = (rows: { id: string }[]) => rows.slice(0, 5).map((r) => r.id);
    push({ check: "ORPHAN_EVENTS", title: "Нет событий «проведено» без проводки", expected: 0, actual: noJournal.length, count: noJournal.length, source: "Учётные события", details: list(noJournal), severity: "ERROR" }, "count");
    push({ check: "ORPHAN_ENTRIES", title: "Нет проводок из операций без учётного события", expected: 0, actual: orphanEntries.length, count: orphanEntries.length, source: "Журнал проводок", details: list(orphanEntries), severity: "ERROR" }, "count");
    push({ check: "UNBALANCED_ENTRIES", title: "Нет несбалансированных проводок и проводок без строк", expected: 0, actual: unbalanced.length + noLines.length, count: unbalanced.length + noLines.length, source: "Строки проводок", details: [...list(unbalanced), ...list(noLines)], severity: "CRITICAL" }, "count");
    push({ check: "DUPLICATE_POSTING", title: "Нет повторной проводки одной операции", expected: 0, actual: duplicates.length, count: duplicates.length, source: "Журнал проводок", details: list(duplicates), severity: "CRITICAL" }, "count");
    push({ check: "ENTRY_WITHOUT_PERIOD", title: "У каждой проводки есть период этой организации", expected: 0, actual: foreignPeriod.length, count: foreignPeriod.length, source: "Журнал проводок и периоды", details: list(foreignPeriod), severity: "CRITICAL" }, "count");
    push({ check: "POSTING_INTO_CLOSED_PERIOD", title: "Нет проводок, внесённых в закрытый период", expected: 0, actual: closedPosting.length, count: closedPosting.length, source: "Журнал проводок и периоды", details: list(closedPosting), severity: "CRITICAL" }, "count");
    push({ check: "NEGATIVE_AMOUNTS", title: "Нет отрицательных и нулевых сумм в строках", expected: 0, actual: badAmounts.length, count: badAmounts.length, source: "Строки проводок", details: list(badAmounts), severity: "CRITICAL" }, "count");
    push(
      {
        check: "INVALID_ACCOUNTS",
        title: "Счета проводок принадлежат организации, типы системных счетов верны",
        expected: 0,
        actual: badAccounts.length + systemTypeMismatch.length,
        count: badAccounts.length + systemTypeMismatch.length,
        source: "План счетов",
        details: [...list(badAccounts), ...systemTypeMismatch.map((a) => `${a.code}: тип/сторона не соответствуют назначению`)],
        severity: "CRITICAL",
      },
      "count",
    );
  }

  private async againstEvents(organizationId: string, startsAt: Date, push: (r: Result, kind?: "compare" | "count" | "info") => void): Promise<void> {
    const projector = new FinancialEventProjector(this.prisma, new CostingService(this.prisma));
    const events = (await projector.project(organizationId)).filter((e) => new Date(e.occurredAt) >= startsAt);
    const byKey = new Map(events.map((e) => [e.key, e]));
    const rows = await this.prisma.accountingEvent.findMany({ where: { organizationId }, select: { eventKey: true, status: true, contentHash: true, sourceType: true, statusReason: true } });

    // A posted event whose source no longer exists as a fact.
    const vanished = rows.filter((r) => r.status === AccountingEventStatus.POSTED && !byKey.has(r.eventKey) && r.sourceType !== "ProductionBatch");
    push({ check: "POSTED_SOURCE_VANISHED", title: "У проведённых событий сохранился источник", expected: 0, actual: vanished.length, count: vanished.length, source: "Учётные события и документы", details: vanished.slice(0, 5).map((r) => r.eventKey), severity: "ERROR" }, "count");

    // A posted event whose source now reads differently from what was posted.
    const ctx = await this.prisma.$transaction((tx) => loadPostingContext(tx, organizationId, "diagnostics"));
    const drift: string[] = [];
    if (ctx) {
      for (const r of rows) {
        const e = byKey.get(r.eventKey);
        if (!e || r.status !== AccountingEventStatus.POSTED || !r.contentHash) continue;
        const decision = decideEvent(e, ctx.cashKinds);
        if (decision.status !== "POST") {
          drift.push(r.eventKey);
          continue;
        }
        const hash = createHash("sha256").update(draftFingerprint(e.occurredAt, decision.lines)).digest("hex");
        if (hash !== r.contentHash) drift.push(r.eventKey);
      }
    }
    push({ check: "SOURCE_DRIFT", title: "Источники не изменились после проводки", expected: 0, actual: drift.length, count: drift.length, source: "Учётные события и документы", details: drift.slice(0, 5), severity: "WARNING" }, "count");

    // Operations from the start date that are not in the ledger.
    const state = new Map(rows.map((r) => [r.eventKey, r.status]));
    const notInLedger = events.filter((e) => {
      const s = state.get(e.key);
      return s !== AccountingEventStatus.POSTED && s !== AccountingEventStatus.REVERSED && s !== AccountingEventStatus.NO_GL_EFFECT;
    });
    const unapproved = notInLedger.filter((e) => e.type === FinancialEventType.OPENING_BALANCE || e.type === FinancialEventType.OPENING_POSITION).length;
    const real = notInLedger.length - unapproved;
    push({ check: "UNPOSTED_OPERATIONS", title: "Все операции с даты запуска проведены в книгу", expected: 0, actual: real, count: real, source: "Покрытие (см. отчёт «Покрытие»)", details: [`Не проведено: ${real}`, `Начальные остатки вне проводок (политика не утверждена): ${unapproved}`], severity: "WARNING" }, "count");
  }

  // ── coverage ─────────────────────────────────────────────────────────────

  async coverage(organizationId: string): Promise<LedgerCoverageDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
    const generatedAt = new Date().toISOString();
    const startsAt = org.ledgerStartsAt;
    const projector = new FinancialEventProjector(this.prisma, new CostingService(this.prisma));
    const [events, rows] = await Promise.all([
      projector.project(organizationId),
      this.prisma.accountingEvent.findMany({ where: { organizationId }, select: { eventKey: true, status: true, eventType: true } }),
    ]);
    const state = new Map(rows.map((r) => [r.eventKey, r.status as AccountingEventStatus]));

    const T = FinancialEventType;
    const families: { key: string; label: string; match: (e: { type: FinancialEventType; unclassified: boolean; sourceType: string }) => boolean; note?: string }[] = [
      { key: "sales", label: "Продажи (выручка и себестоимость)", match: (e) => e.type === T.SALE || e.type === T.SALE_COST },
      { key: "returns", label: "Возвраты от покупателей", match: (e) => e.type === T.SALE_RETURN || e.type === T.SALE_RETURN_COST },
      { key: "purchases", label: "Закупки (приёмка заказов и накладных)", match: (e) => e.type === T.PURCHASE_RECEIPT || e.type === T.INVOICE_RECEIPT },
      { key: "supplierPayments", label: "Оплаты поставщикам", match: (e) => e.type === T.SUPPLIER_PAYMENT },
      { key: "customerPayments", label: "Платежи покупателей и возвраты денег", match: (e) => e.type === T.CUSTOMER_RECEIPT || e.type === T.CUSTOMER_REFUND },
      { key: "expenses", label: "Расходы (начисление и оплата)", match: (e) => e.type === T.EXPENSE_ACCRUAL || e.type === T.EXPENSE_PAYMENT },
      { key: "stockLosses", label: "Списания и результаты инвентаризации", match: (e) => (e.type === T.INVENTORY_LOSS || e.type === T.INVENTORY_GAIN) && !e.unclassified },
      { key: "manualReceipts", label: "Приход на склад без закупочного документа", match: (e) => e.type === T.INVENTORY_GAIN && e.unclassified, note: "Чем оплачен приход — не записано; вторая сторона неизвестна, проводка не выдумывается" },
      { key: "transfers", label: "Переводы между своими счетами", match: (e) => e.type === T.INTERNAL_TRANSFER },
      { key: "fixedAssets", label: "Основные средства (амортизация, выбытие)", match: (e) => e.type === T.DEPRECIATION || e.type === T.ASSET_DISPOSAL },
      { key: "owner", label: "Операции собственника", match: (e) => e.type === T.OWNER_CONTRIBUTION || e.type === T.OWNER_WITHDRAWAL },
      { key: "loans", label: "Займы и кредиты", match: (e) => e.type === T.LOAN_PROCEEDS || e.type === T.LOAN_REPAYMENT },
      { key: "otherCash", label: "Прочие движения денег (по классификации категории)", match: (e) => e.type === T.CASH_RESULT || e.type === T.CASH_UNCLASSIFIED },
      { key: "opening", label: "Начальные остатки", match: (e) => e.type === T.OPENING_BALANCE || e.type === T.OPENING_POSITION },
    ];

    const out: LedgerCoverageRowDto[] = families.map((f) => {
      const mine = events.filter(f.match);
      const before = startsAt ? mine.filter((e) => new Date(e.occurredAt) < startsAt) : mine;
      const since = startsAt ? mine.filter((e) => new Date(e.occurredAt) >= startsAt) : [];
      const posted = since.filter((e) => [AccountingEventStatus.POSTED, AccountingEventStatus.REVERSED].includes(state.get(e.key) as AccountingEventStatus)).length;
      const unapproved = f.key === "opening" ? since.length : 0;
      let status: CoverageStatus;
      if (f.key === "opening") status = CoverageStatus.UNAPPROVED;
      else if (since.length === 0) status = CoverageStatus.NOT_APPLICABLE;
      else if (posted === since.length) status = CoverageStatus.GL_POSTED;
      else if (posted === 0) status = CoverageStatus.NOT_POSTED;
      else status = CoverageStatus.PARTIALLY_POSTED;
      return {
        key: f.key,
        label: f.label,
        status,
        total: since.length,
        posted,
        notPosted: since.length - posted - unapproved,
        notMigrated: before.length,
        note:
          f.key === "opening"
            ? "Начальный остаток вносится отдельной проводкой после проверки (решение D3 не утверждено)"
            : f.note ?? (before.length > 0 ? "Операции до запуска книги не переносятся автоматически" : null),
      };
    });

    // Production is an event with no ledger effect under the current policy.
    const production = rows.filter((r) => r.eventType === "PRODUCTION");
    out.push({
      key: "production",
      label: "Производство (расход сырья → готовая продукция)",
      status: production.length > 0 ? CoverageStatus.UNAPPROVED : CoverageStatus.NOT_APPLICABLE,
      total: production.length,
      posted: 0,
      notPosted: 0,
      notMigrated: 0,
      note: "Движение по себестоимости внутри запасов, баланс не меняет. Труд, коммунальные и накладные затраты не капитализируются — решение D6 не принято",
    });
    out.push(
      { key: "taxes", label: "Налоги и НДС", status: CoverageStatus.UNAPPROVED, total: 0, posted: 0, notPosted: 0, notMigrated: 0, note: "Налоговая политика не утверждена (D5): ставки не заданы, обязательства не начисляются" },
      { key: "payroll", label: "Расчёт с персоналом", status: CoverageStatus.UNAPPROVED, total: 0, posted: 0, notPosted: 0, notMigrated: 0, note: "Начисление ФЗП проводками в приложении не ведётся" },
      { key: "stockTransfers", label: "Перемещение товара между точками", status: CoverageStatus.NOT_APPLICABLE, total: 0, posted: 0, notPosted: 0, notMigrated: 0, note: "Стоимость запасов организации не меняет" },
    );
    return { generatedAt, startsAt: startsAt?.toISOString() ?? null, rows: out };
  }
}
