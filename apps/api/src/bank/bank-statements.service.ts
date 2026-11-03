import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  BANK_PRESET_CATEGORY_NAMES_RU,
  BalanceTreatment,
  BankLineAction,
  BankLineStatus,
  BankLineSuggestionDto,
  BankPresetCategory,
  BankStatementDto,
  BankStatementLineDto,
  BankStatementSummaryDto,
  CashActivity,
  CashMovementType,
  CostBehavior,
  ExpenseStatus,
  FinanceCategoryKind,
  PnlTreatment,
  PostBankLineRequestDto,
  PostBankLinesResultDto,
  SettlementDayDto,
  UploadBankStatementRequestDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashMovementsService } from "../finance/cash-movements.service";
import { ProcurementService } from "../procurement/procurement.service";
import { PeriodGuard } from "../finance/periods/period-guard";
import { recordAudit } from "../audit/audit";
import { postLedgerSources } from "../ledger/event-posting";
import { round2 } from "../common/money";
import { businessDateOf, businessDayRange } from "../reconciliation/reconciliation.service";
import { cashSignOf } from "../common/ledger-effects";

// Banks' own ИИН/БИН (Kaspi Bank, Kaspi Pay, Банк ЦентрКредит): their lines are
// told apart by their purpose, never by who sent them — the same BIN pays out
// the day's takings, charges the commission and carries a QR purchase from any shop.
const AGGREGATOR_BINS = new Set(["971240001315", "200840000951", "980640000093"]);

// Банк ЦентрКредит pays a day's card and QR takings the next morning:
// «Возмещение коммерсанту: у-во …» / «Возмещение НПК QR: у-во …».
const BCC_SETTLEMENT = /^возмещение (коммерсанту|нпк qr)/i;

export const purposeKey = (purpose: string | null): string | null => {
  if (!purpose) return null;
  const key = purpose
    .toLowerCase()
    .replace(/\*\d+/g, "")
    .replace(/\d+/g, "")
    .replace(/[/.:,№#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return key || null;
};

// The Almaty day a «Продажи с Kaspi.kz за 31/10/2026» line pays out; a
// Банк ЦентрКредит «Возмещение…» line pays out the day before it arrived.
export function settlementDateOf(purpose: string | null, occurredAt: Date): string {
  const m = purpose?.match(/за\s+(\d{2})[/.](\d{2})[/.](\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const day = businessDateOf(occurredAt);
  if (!BCC_SETTLEMENT.test(purpose ?? "")) return day;
  const prev = new Date(`${day}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

// What the bank's own wording says a line is. Learned rules come first.
export function builtInSuggestion(line: { amount: number; knp: string | null; purpose: string | null }): BankLineSuggestionDto | null {
  const purpose = line.purpose ?? "";
  const base = { categoryId: null, presetCategory: null, targetAccountId: null, supplierId: null, source: "BUILT_IN" as const };
  if (line.amount > 0 && (/^продажи с kaspi\.kz/i.test(purpose) || BCC_SETTLEMENT.test(purpose))) return { ...base, action: BankLineAction.SALES_SETTLEMENT };
  if (line.amount < 0 && (line.knp === "841" || line.knp === "851" || /оплата за услуги (процессинга|операций по картам)/i.test(purpose))) {
    return { ...base, action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.BANK_FEE };
  }
  if (line.amount < 0 && (line.knp === "342" || /перевод собственных средств/i.test(purpose))) {
    return { ...base, action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.OWNER_WITHDRAWAL };
  }
  return null;
}

interface PresetClassification {
  kind: FinanceCategoryKind;
  pnlTreatment: PnlTreatment;
  cashActivity: CashActivity;
  balanceTreatment: BalanceTreatment;
  costBehavior: CostBehavior;
}

const PRESETS: Record<BankPresetCategory, PresetClassification> = {
  [BankPresetCategory.BANK_FEE]: {
    kind: FinanceCategoryKind.EXPENSE,
    pnlTreatment: PnlTreatment.OPERATING_EXPENSE,
    cashActivity: CashActivity.OPERATING,
    balanceTreatment: BalanceTreatment.NONE,
    costBehavior: CostBehavior.VARIABLE,
  },
  [BankPresetCategory.OWNER_WITHDRAWAL]: {
    kind: FinanceCategoryKind.EXPENSE,
    pnlTreatment: PnlTreatment.NOT_IN_PNL,
    cashActivity: CashActivity.FINANCING,
    balanceTreatment: BalanceTreatment.OWNER_WITHDRAWAL,
    costBehavior: CostBehavior.UNCLASSIFIED,
  },
};

const MAX_LINES = 2000;

// Загрузка банковской выписки. The file is read in the browser; here the lines
// are stored once per account (by the bank's document number), a way to post
// each is suggested (a remembered rule, the bank's own wording, a supplier's
// БИН), and each is posted into the ordinary ledgers dated when the bank says:
//   · the day's card/Kaspi takings — nothing is written, the till recorded
//     them at the sale; the screen compares the two per day;
//   · by a finance category — an expense document paid from the account, or an
//     owner/loan flow, or other income, exactly as entered by hand;
//   · a transfer between two of our own accounts;
//   · a supplier payment — over that supplier's received orders, oldest first;
//   · ignored — already in the books some other way.
// A posted line is never posted again (a conditional status flip in the same
// transaction as what it writes). A line in a closed month is refused.
@Injectable()
export class BankStatementsService {
  constructor(
    private prisma: PrismaService,
    private cash: CashMovementsService,
    private procurement: ProcurementService,
  ) {}

  async upload(user: AuthenticatedUser, dto: UploadBankStatementRequestDto): Promise<BankStatementDto> {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: dto.accountId, organizationId: user.organizationId } });
    if (!account || !account.isActive) throw new BadRequestException("Счёт не найден или заархивирован");
    if (!dto.lines?.length) throw new BadRequestException("В выписке нет операций");
    if (dto.lines.length > MAX_LINES) throw new BadRequestException(`Слишком много операций в одном файле (больше ${MAX_LINES})`);
    const periodFrom = new Date(dto.periodFrom);
    const periodTo = new Date(dto.periodTo);
    if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime()) || periodFrom > periodTo) {
      throw new BadRequestException("Не удалось прочитать период выписки");
    }
    const seen = new Set<string>();
    for (const l of dto.lines) {
      if (!l.docNumber || !Number.isFinite(l.amount) || l.amount === 0 || Number.isNaN(new Date(l.occurredAt).getTime())) {
        throw new BadRequestException(`Не удалось прочитать операцию ${l.docNumber || "без номера"}`);
      }
      if (seen.has(l.docNumber)) throw new BadRequestException(`Номер документа ${l.docNumber} встречается в файле дважды`);
      seen.add(l.docNumber);
    }

    const statement = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bankStatementLine.findMany({
        where: { organizationId: user.organizationId, accountId: account.id, docNumber: { in: [...seen] } },
        select: { docNumber: true },
      });
      const known = new Set(existing.map((e) => e.docNumber));
      const created = await tx.bankStatement.create({
        data: {
          organizationId: user.organizationId,
          accountId: account.id,
          bankName: dto.bankName.slice(0, 100),
          iban: dto.iban,
          holderBin: dto.holderBin,
          periodFrom,
          periodTo,
          openingBalance: dto.openingBalance,
          closingBalance: dto.closingBalance,
          fileName: dto.fileName?.slice(0, 200) ?? null,
          createdById: user.id,
        },
      });
      const fresh = dto.lines.filter((l) => !known.has(l.docNumber));
      if (fresh.length > 0) {
        await tx.bankStatementLine.createMany({
          data: fresh.map((l) => ({
            organizationId: user.organizationId,
            statementId: created.id,
            accountId: account.id,
            docNumber: l.docNumber,
            occurredAt: new Date(l.occurredAt),
            amount: round2(l.amount),
            counterpartyName: l.counterpartyName?.slice(0, 300) ?? null,
            counterpartyBin: l.counterpartyBin,
            counterpartyIban: l.counterpartyIban,
            knp: l.knp,
            purpose: l.purpose?.slice(0, 500) ?? null,
          })),
        });
      }
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "bankStatement.upload",
        entityType: "BankStatement",
        entityId: created.id,
        after: { accountId: account.id, lines: dto.lines.length, duplicates: known.size, periodFrom: dto.periodFrom, periodTo: dto.periodTo },
      });
      return { id: created.id, duplicates: known.size };
    });
    return this.get(user, statement.id, statement.duplicates);
  }

  async list(user: AuthenticatedUser): Promise<BankStatementSummaryDto[]> {
    const rows = await this.prisma.bankStatement.findMany({
      where: { organizationId: user.organizationId },
      include: { account: { select: { name: true } }, lines: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      accountName: r.account.name,
      bankName: r.bankName,
      periodFrom: r.periodFrom.toISOString(),
      periodTo: r.periodTo.toISOString(),
      lineCount: r.lines.length,
      newCount: r.lines.filter((l) => l.status === "NEW").length,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // A statement with nothing posted or skipped yet can be removed (a wrong
  // account was picked); after that its lines are the record of what was done.
  async remove(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const statement = await this.prisma.bankStatement.findFirst({ where: { id, organizationId: user.organizationId }, include: { lines: { select: { status: true } } } });
    if (!statement) throw new NotFoundException("Выписка не найдена");
    if (statement.lines.some((l) => l.status !== "NEW")) {
      throw new BadRequestException("По выписке уже проведены операции — удалить её нельзя");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatement.delete({ where: { id } });
      await recordAudit(tx, { organizationId: user.organizationId, actorId: user.id, action: "bankStatement.delete", entityType: "BankStatement", entityId: id });
    });
    return { deleted: true };
  }

  async get(user: AuthenticatedUser, id: string, duplicatesSkipped = 0): Promise<BankStatementDto> {
    const statement = await this.prisma.bankStatement.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { account: true, createdBy: { select: { fullName: true } }, lines: { orderBy: [{ occurredAt: "asc" }, { docNumber: "asc" }] } },
    });
    if (!statement) throw new NotFoundException("Выписка не найдена");

    const [rules, suppliers, categories] = await Promise.all([
      this.prisma.bankRule.findMany({ where: { organizationId: user.organizationId } }),
      this.prisma.supplier.findMany({ where: { organizationId: user.organizationId, bin: { not: null } }, select: { id: true, bin: true } }),
      this.prisma.financeCategory.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }),
    ]);
    const supplierByBin = new Map(suppliers.map((s) => [s.bin as string, s.id]));
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));

    const suggest = (l: { amount: number; counterpartyBin: string | null; knp: string | null; purpose: string | null }): BankLineSuggestionDto | null => {
      const direction = l.amount > 0 ? 1 : -1;
      const key = purposeKey(l.purpose);
      const byBin = l.counterpartyBin && !AGGREGATOR_BINS.has(l.counterpartyBin)
        ? rules.find((r) => r.direction === direction && r.counterpartyBin === l.counterpartyBin)
        : undefined;
      const rule = byBin ?? (key ? rules.find((r) => r.direction === direction && !r.counterpartyBin && r.purposeKey === key) : undefined);
      if (rule) {
        return {
          action: rule.action as BankLineAction,
          categoryId: rule.categoryId,
          presetCategory: null,
          targetAccountId: rule.targetAccountId,
          supplierId: rule.supplierId,
          source: "RULE",
        };
      }
      const builtIn = builtInSuggestion(l);
      if (builtIn) return builtIn;
      const supplierId = l.amount < 0 && l.counterpartyBin ? supplierByBin.get(l.counterpartyBin) : undefined;
      if (supplierId) {
        return { action: BankLineAction.SUPPLIER_PAYMENT, categoryId: null, presetCategory: null, targetAccountId: null, supplierId, source: "COUNTERPARTY" };
      }
      return null;
    };

    const lines: BankStatementLineDto[] = statement.lines.map((l) => {
      const amount = l.amount.toNumber();
      const plain = { amount, counterpartyBin: l.counterpartyBin, knp: l.knp, purpose: l.purpose };
      const suggestion = l.status === "NEW" ? suggest(plain) : null;
      const isSettlement = (l.action ?? suggestion?.action) === BankLineAction.SALES_SETTLEMENT;
      return {
        id: l.id,
        docNumber: l.docNumber,
        occurredAt: l.occurredAt.toISOString(),
        amount,
        counterpartyName: l.counterpartyName,
        counterpartyBin: l.counterpartyBin,
        counterpartyIban: l.counterpartyIban,
        knp: l.knp,
        purpose: l.purpose,
        status: l.status as BankLineStatus,
        action: l.action as BankLineAction | null,
        categoryId: l.categoryId,
        categoryName: l.categoryId ? categoryName.get(l.categoryId) ?? null : null,
        targetAccountId: l.targetAccountId,
        supplierId: l.supplierId,
        resultNote: l.resultNote,
        suggestion,
        settlementDate: isSettlement ? settlementDateOf(l.purpose, l.occurredAt) : null,
      };
    });

    const settlement = await this.settlementDays(user.organizationId, statement.accountId, lines);
    const systemClosingBalance = await this.balanceAt(statement.accountId, statement.periodTo);

    return {
      id: statement.id,
      accountId: statement.accountId,
      accountName: statement.account.name,
      bankName: statement.bankName,
      iban: statement.iban,
      periodFrom: statement.periodFrom.toISOString(),
      periodTo: statement.periodTo.toISOString(),
      openingBalance: statement.openingBalance?.toNumber() ?? null,
      closingBalance: statement.closingBalance?.toNumber() ?? null,
      fileName: statement.fileName,
      createdAt: statement.createdAt.toISOString(),
      createdByName: statement.createdBy.fullName,
      lines,
      duplicatesSkipped,
      settlement,
      systemClosingBalance,
    };
  }

  // Per Almaty day: what the bank paid out as the day's takings vs what the
  // till recorded into this account (receipts − refunds) that day.
  private async settlementDays(organizationId: string, accountId: string, lines: BankStatementLineDto[]): Promise<SettlementDayDto[]> {
    const bankByDay = new Map<string, number>();
    for (const l of lines) {
      if (!l.settlementDate || l.status === BankLineStatus.IGNORED) continue;
      bankByDay.set(l.settlementDate, round2((bankByDay.get(l.settlementDate) ?? 0) + l.amount));
    }
    if (bankByDay.size === 0) return [];
    const days = [...bankByDay.keys()].sort();
    const from = businessDayRange(days[0]).start;
    const to = businessDayRange(days[days.length - 1]).end;
    const movements = await this.prisma.cashMovement.findMany({
      where: { organizationId, accountId, type: { in: [CashMovementType.SALE_RECEIPT, CashMovementType.SALE_REFUND] }, occurredAt: { gte: from, lt: to } },
      select: { type: true, amount: true, occurredAt: true },
    });
    const systemByDay = new Map<string, number>();
    for (const m of movements) {
      const day = businessDateOf(m.occurredAt);
      const signed = m.type === CashMovementType.SALE_REFUND ? -m.amount.toNumber() : m.amount.toNumber();
      systemByDay.set(day, round2((systemByDay.get(day) ?? 0) + signed));
    }
    return days.map((date) => {
      const bankAmount = bankByDay.get(date)!;
      const systemAmount = systemByDay.get(date) ?? 0;
      return { date, bankAmount, systemAmount, difference: round2(bankAmount - systemAmount) };
    });
  }

  // The account's balance in the system at a moment: every movement up to it.
  private async balanceAt(accountId: string, at: Date): Promise<number> {
    const groups = await this.prisma.cashMovement.groupBy({ by: ["type"], where: { accountId, occurredAt: { lte: at } }, _sum: { amount: true } });
    let total = 0;
    for (const g of groups) {
      const sign = cashSignOf(g.type);
      const sum = g._sum.amount?.toNumber() ?? 0;
      total += sign === "SIGNED" ? sum : sign * sum;
    }
    return round2(total);
  }

  async post(user: AuthenticatedUser, statementId: string, requests: PostBankLineRequestDto[]): Promise<PostBankLinesResultDto> {
    const statement = await this.prisma.bankStatement.findFirst({ where: { id: statementId, organizationId: user.organizationId } });
    if (!statement) throw new NotFoundException("Выписка не найдена");
    const guard = new PeriodGuard(this.prisma);
    const failed: { lineId: string; message: string }[] = [];
    let posted = 0;
    for (const request of requests) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const line = await tx.bankStatementLine.findFirst({ where: { id: request.lineId, statementId, organizationId: user.organizationId } });
          if (!line) throw new NotFoundException("Операция не найдена");
          // Marking a line as known writes no money, so a closed month does not stop it.
          const writesMoney = request.action !== BankLineAction.IGNORE && request.action !== BankLineAction.SALES_SETTLEMENT;
          if (writesMoney) await guard.assertOpen(user.organizationId, line.occurredAt, tx);
          const outcome = await this.apply(tx, user, statement.accountId, line, request);
          const flipped = await tx.bankStatementLine.updateMany({
            where: { id: line.id, status: "NEW" },
            data: {
              status: request.action === BankLineAction.IGNORE ? "IGNORED" : "POSTED",
              action: request.action,
              categoryId: outcome.categoryId,
              targetAccountId: request.targetAccountId ?? null,
              supplierId: request.supplierId ?? null,
              resultNote: outcome.note,
              postedAt: new Date(),
              postedById: user.id,
            },
          });
          if (flipped.count !== 1) throw new BadRequestException("Операция уже проведена");
          if (request.remember) await this.remember(tx, user.organizationId, line, request, outcome.categoryId);
          await recordAudit(tx, {
            organizationId: user.organizationId,
            actorId: user.id,
            action: "bankStatementLine.post",
            entityType: "BankStatementLine",
            entityId: line.id,
            after: { action: request.action, amount: line.amount.toNumber(), docNumber: line.docNumber, note: outcome.note },
          });
        });
        posted += 1;
      } catch (err) {
        failed.push({ lineId: request.lineId, message: err instanceof Error ? err.message : "Ошибка" });
      }
    }
    return { posted, failed, statement: await this.get(user, statementId) };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    accountId: string,
    line: { id: string; amount: Prisma.Decimal; occurredAt: Date; docNumber: string; purpose: string | null; counterpartyName: string | null; status: string },
    request: PostBankLineRequestDto,
  ): Promise<{ note: string; categoryId: string | null }> {
    if (line.status !== "NEW") throw new BadRequestException("Операция уже проведена");
    const signed = line.amount.toNumber();
    const amount = Math.abs(signed);
    const label = (line.purpose ?? line.counterpartyName ?? "Операция по выписке").slice(0, 200);
    const reason = `Выписка №${line.docNumber}: ${label}`;
    switch (request.action) {
      case BankLineAction.IGNORE:
        return { note: "Пропущено", categoryId: null };
      case BankLineAction.SALES_SETTLEMENT:
        if (signed <= 0) throw new BadRequestException("Выручка с кассы — это поступление денег");
        return { note: "Выручка с кассы — уже учтена продажами", categoryId: null };
      case BankLineAction.TRANSFER: {
        const target = request.targetAccountId
          ? await tx.cashAccount.findFirst({ where: { id: request.targetAccountId, organizationId: user.organizationId, isActive: true } })
          : null;
        if (!target || target.id === accountId) throw new BadRequestException("Укажите другой свой счёт для перевода");
        const transferGroupId = `bank-${line.id}`;
        const [fromId, toId] = signed < 0 ? [accountId, target.id] : [target.id, accountId];
        for (const [acc, type] of [[fromId, CashMovementType.TRANSFER_OUT], [toId, CashMovementType.TRANSFER_IN]] as const) {
          await this.cash.recordMovement(tx, {
            organizationId: user.organizationId,
            accountId: acc,
            type,
            amount,
            reason,
            transferGroupId,
            createdById: user.id,
            occurredAt: line.occurredAt,
          });
        }
        return { note: `Перевод ${signed < 0 ? "на" : "со"} счёт «${target.name}»`, categoryId: null };
      }
      case BankLineAction.SUPPLIER_PAYMENT: {
        if (signed >= 0) throw new BadRequestException("Оплата поставщику — это списание денег");
        if (!request.supplierId) throw new BadRequestException("Укажите поставщика");
        const supplier = await tx.supplier.findFirst({ where: { id: request.supplierId, organizationId: user.organizationId } });
        if (!supplier) throw new BadRequestException("Поставщик не найден");
        const note = await this.procurement.paySupplierOrders(tx, user, {
          supplierId: supplier.id,
          accountId,
          amount,
          paidAt: line.occurredAt,
          note: reason,
        });
        return { note: `Оплата ${supplier.name}: ${note}`, categoryId: null };
      }
      case BankLineAction.CATEGORY: {
        const category = await this.categoryFor(tx, user.organizationId, request);
        if (signed < 0) {
          if (category.kind !== FinanceCategoryKind.EXPENSE) throw new BadRequestException("Для списания выберите статью расхода");
          const ownerFlow =
            category.balanceTreatment === BalanceTreatment.OWNER_WITHDRAWAL || category.balanceTreatment === BalanceTreatment.LOAN_REPAYMENT;
          if (ownerFlow) {
            await this.cash.recordMovement(tx, {
              organizationId: user.organizationId,
              accountId,
              type: CashMovementType.CASH_WITHDRAWAL,
              amount,
              categoryId: category.id,
              reason,
              createdById: user.id,
              occurredAt: line.occurredAt,
            });
            return { note: category.name, categoryId: category.id };
          }
          const expense = await tx.expense.create({
            data: {
              organizationId: user.organizationId,
              categoryId: category.id,
              status: ExpenseStatus.CONFIRMED,
              amount,
              amountPaid: amount,
              description: reason,
              incurredOn: line.occurredAt,
              createdById: user.id,
            },
          });
          await this.cash.recordMovement(tx, {
            organizationId: user.organizationId,
            accountId,
            type: CashMovementType.EXPENSE_PAYMENT,
            amount,
            categoryId: category.id,
            expenseId: expense.id,
            reason,
            createdById: user.id,
            occurredAt: line.occurredAt,
          });
          await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { expenseIds: [expense.id] } });
          return { note: `Расход «${category.name}»`, categoryId: category.id };
        }
        if (category.kind !== FinanceCategoryKind.INCOME) throw new BadRequestException("Для поступления выберите статью дохода");
        await this.cash.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId,
          type: CashMovementType.CASH_DEPOSIT,
          amount,
          categoryId: category.id,
          reason,
          createdById: user.id,
          occurredAt: line.occurredAt,
        });
        return { note: `Поступление «${category.name}»`, categoryId: category.id };
      }
      default:
        throw new BadRequestException("Неизвестное действие");
    }
  }

  // A chosen category, or one of the import's own (created, classified, on first use).
  private async categoryFor(tx: Prisma.TransactionClient, organizationId: string, request: PostBankLineRequestDto) {
    if (request.categoryId) {
      const category = await tx.financeCategory.findFirst({ where: { id: request.categoryId, organizationId } });
      if (!category) throw new BadRequestException("Статья не найдена");
      return category;
    }
    if (!request.presetCategory || !(request.presetCategory in PRESETS)) throw new BadRequestException("Укажите статью");
    const name = BANK_PRESET_CATEGORY_NAMES_RU[request.presetCategory];
    const existing = await tx.financeCategory.findFirst({ where: { organizationId, name } });
    if (existing) return existing;
    return tx.financeCategory.create({ data: { organizationId, name, ...PRESETS[request.presetCategory] } });
  }

  private async remember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    line: { amount: Prisma.Decimal; counterpartyBin: string | null; purpose: string | null },
    request: PostBankLineRequestDto,
    categoryId: string | null,
  ): Promise<void> {
    const direction = line.amount.toNumber() > 0 ? 1 : -1;
    const byBin = line.counterpartyBin && !AGGREGATOR_BINS.has(line.counterpartyBin) ? line.counterpartyBin : null;
    const key = byBin ? null : purposeKey(line.purpose);
    if (!byBin && !key) return;
    const data = {
      action: request.action,
      categoryId,
      targetAccountId: request.targetAccountId ?? null,
      supplierId: request.supplierId ?? null,
    };
    const existing = await tx.bankRule.findFirst({ where: { organizationId, direction, counterpartyBin: byBin, purposeKey: key } });
    if (existing) await tx.bankRule.update({ where: { id: existing.id }, data });
    else await tx.bankRule.create({ data: { organizationId, direction, counterpartyBin: byBin, purposeKey: key, ...data } });
  }
}
