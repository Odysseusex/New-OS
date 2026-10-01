import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AccountingEventStatus,
  CreateLedgerAccountInput,
  DEFAULT_NORMAL_BALANCE,
  EnableLedgerInput,
  GeneralLedgerDto,
  JournalEntryDto,
  JournalEntryKind,
  JournalListQuery,
  LedgerAccountDto,
  LedgerAccountType,
  LedgerFilterQuery,
  LedgerStatusDto,
  ManualJournalEntryInput,
  NormalBalance,
  OpeningBalanceInput,
  OpeningBalanceProposalDto,
  PostPendingResultDto,
  SYSTEM_ACCOUNT_DEFS,
  SYSTEM_ACCOUNT_KEYS,
  SystemAccountKey,
  TrialBalanceDto,
  TrialBalanceRowDto,
  UpdateLedgerAccountInput,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { CostingService } from "../costing/costing.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { Dec, exactAmount, LedgerRejectedError, num, onNormalSide, sum, ZERO } from "./journal-math";
import { PostLine, postJournalEntry, reverseJournalEntry } from "./journal-core";
import { loadPostingContext, postEvents } from "./event-posting";

const ENTRY_INCLUDE = {
  lines: { include: { account: true }, orderBy: { lineNo: "asc" as const } },
  accountingPeriod: { select: { year: true, month: true } },
  postedBy: { select: { fullName: true } },
  accountingEvent: { select: { id: true, eventKey: true, eventType: true, sourceType: true, sourceId: true } },
  reversedBy: { select: { id: true } },
} satisfies Prisma.JournalEntryInclude;

type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

const dec = (v: Prisma.Decimal | null | undefined): Dec => v ?? ZERO;

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  // ── chart of accounts ───────────────────────────────────────────────────

  async listAccounts(organizationId: string): Promise<LedgerAccountDto[]> {
    const [accounts, used] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { organizationId }, orderBy: { code: "asc" } }),
      this.prisma.journalLine.groupBy({ by: ["accountId"], where: { organizationId } }),
    ]);
    const hasPostings = new Set(used.map((u) => u.accountId));
    return accounts.map((a) => this.toAccountDto(a, hasPostings.has(a.id)));
  }

  async createAccount(user: AuthenticatedUser, input: CreateLedgerAccountInput): Promise<LedgerAccountDto> {
    const organizationId = user.organizationId;
    const code = input.code?.trim();
    const name = input.name?.trim();
    if (!code || !name) throw new BadRequestException("Укажите код и название счёта");
    if (!Object.values(LedgerAccountType).includes(input.type)) throw new BadRequestException("Неизвестный тип счёта");
    const normalBalance = input.normalBalance ?? DEFAULT_NORMAL_BALANCE[input.type];
    if (!Object.values(NormalBalance).includes(normalBalance)) throw new BadRequestException("Неизвестная сторона остатка");
    if (input.parentId) await this.assertValidParent(organizationId, input.parentId, input.type, null);

    return this.prisma.$transaction(async (tx) => {
      const clash = await tx.ledgerAccount.findUnique({ where: { organizationId_code: { organizationId, code } } });
      if (clash) throw new ConflictException(`Счёт с кодом «${code}» уже есть`);
      const created = await tx.ledgerAccount.create({
        data: { organizationId, code, name, type: input.type, normalBalance, parentId: input.parentId ?? null },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.account.create",
        entityType: "LedgerAccount",
        entityId: created.id,
        after: { code, name, type: created.type, normalBalance, parentId: created.parentId },
      });
      return this.toAccountDto(created, false);
    });
  }

  async updateAccount(user: AuthenticatedUser, id: string, input: UpdateLedgerAccountInput): Promise<LedgerAccountDto> {
    const organizationId = user.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.findFirst({ where: { id, organizationId } });
      if (!account) throw new NotFoundException("Счёт не найден");
      const posted = (await tx.journalLine.count({ where: { organizationId, accountId: id } })) > 0;

      const data: Prisma.LedgerAccountUncheckedUpdateInput = {};
      if (input.name !== undefined) {
        if (!input.name.trim()) throw new BadRequestException("Название не может быть пустым");
        data.name = input.name.trim();
      }
      if (input.code !== undefined) {
        const code = input.code.trim();
        if (!code) throw new BadRequestException("Код не может быть пустым");
        const clash = await tx.ledgerAccount.findFirst({ where: { organizationId, code, NOT: { id } } });
        if (clash) throw new ConflictException(`Счёт с кодом «${code}» уже есть`);
        data.code = code;
      }
      if (input.parentId !== undefined) {
        if (input.parentId) await this.assertValidParent(organizationId, input.parentId, (input.type ?? account.type) as LedgerAccountType, id, tx);
        data.parentId = input.parentId;
      }
      if (input.type !== undefined || input.normalBalance !== undefined) {
        if (posted) throw new BadRequestException("Тип и сторона остатка меняются только у счёта без проводок");
        if (account.systemAccountKey) throw new BadRequestException("У системного счёта тип и сторона остатка не меняются");
        if (input.type !== undefined) {
          if (!Object.values(LedgerAccountType).includes(input.type)) throw new BadRequestException("Неизвестный тип счёта");
          data.type = input.type;
          data.normalBalance = input.normalBalance ?? DEFAULT_NORMAL_BALANCE[input.type];
        } else if (input.normalBalance !== undefined) {
          data.normalBalance = input.normalBalance;
        }
      }
      if (input.isActive !== undefined) {
        if (!input.isActive && account.systemAccountKey) {
          throw new BadRequestException("Системный счёт нельзя отключить: приложение проводит в него операции");
        }
        data.isActive = input.isActive;
      }
      const updated = await tx.ledgerAccount.update({ where: { id }, data });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.account.update",
        entityType: "LedgerAccount",
        entityId: id,
        before: { code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance, parentId: account.parentId, isActive: account.isActive },
        after: { code: updated.code, name: updated.name, type: updated.type, normalBalance: updated.normalBalance, parentId: updated.parentId, isActive: updated.isActive },
      });
      return this.toAccountDto(updated, posted);
    });
  }

  // Creates the accounts the application posts to, once and on request. They are
  // ordinary accounts afterwards: rename them, re-code them, put them under
  // headings of your own. The KEY is what the posting rules look for.
  async initializeSystemAccounts(user: AuthenticatedUser): Promise<{ created: SystemAccountKey[] }> {
    const organizationId = user.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerAccount.findMany({
        where: { organizationId },
        select: { code: true, systemAccountKey: true },
      });
      const haveKeys = new Set(existing.map((e) => e.systemAccountKey));
      const codes = new Set(existing.map((e) => e.code));
      const created: SystemAccountKey[] = [];
      for (const key of SYSTEM_ACCOUNT_KEYS) {
        if (haveKeys.has(key)) continue;
        const def = SYSTEM_ACCOUNT_DEFS[key];
        // The technical code is the key itself; a clash with an account of the
        // organization's own is resolved by suffixing, never by overwriting.
        let code: string = key;
        for (let n = 2; codes.has(code); n += 1) code = `${key}_${n}`;
        codes.add(code);
        await tx.ledgerAccount.create({
          data: { organizationId, code, name: def.name, type: def.type, normalBalance: def.normalBalance, systemAccountKey: key },
        });
        created.push(key);
      }
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.systemAccounts.init",
        entityType: "Organization",
        entityId: organizationId,
        after: { created },
      });
      return { created };
    });
  }

  private async assertValidParent(
    organizationId: string,
    parentId: string,
    type: LedgerAccountType,
    selfId: string | null,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const parent = await client.ledgerAccount.findFirst({ where: { id: parentId, organizationId } });
    if (!parent) throw new BadRequestException("Родительский счёт не найден");
    if (parent.type !== type) throw new BadRequestException("Родительский счёт должен быть того же типа");
    if (selfId) {
      // No cycles: walk up from the parent; reaching the account itself is a loop.
      let cursor: string | null = parent.id;
      for (let hops = 0; cursor && hops < 50; hops += 1) {
        if (cursor === selfId) throw new BadRequestException("Счёт не может быть вложен в самого себя");
        const next: { parentId: string | null } | null = await client.ledgerAccount.findUnique({ where: { id: cursor }, select: { parentId: true } });
        cursor = next?.parentId ?? null;
      }
    }
  }

  // ── status & switching the ledger on ────────────────────────────────────

  async getStatus(organizationId: string): Promise<LedgerStatusDto> {
    const [org, accounts, counts, opening] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } }),
      this.prisma.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { not: null }, isActive: true }, select: { systemAccountKey: true } }),
      this.prisma.accountingEvent.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
      this.prisma.journalEntry.findFirst({
        where: { organizationId, kind: JournalEntryKind.OPENING_BALANCE, reversedBy: null },
        select: { id: true },
      }),
    ]);
    const have = new Set(accounts.map((a) => a.systemAccountKey));
    const missing = SYSTEM_ACCOUNT_KEYS.filter((k) => !have.has(k));
    const eventCounts = Object.fromEntries(Object.values(AccountingEventStatus).map((s) => [s, 0])) as Record<AccountingEventStatus, number>;
    for (const c of counts) eventCounts[c.status as AccountingEventStatus] = c._count;
    return {
      enabled: org.ledgerStartsAt !== null,
      startsAt: org.ledgerStartsAt?.toISOString() ?? null,
      systemAccountsReady: missing.length === 0,
      missingSystemAccounts: [...missing],
      openingEntryPosted: opening !== null,
      eventCounts,
      pendingEvents: null,
    };
  }

  // One-way, once. The start date is the line between "history the ledger does
  // not claim to know" and "everything from here on is journalised".
  async enable(user: AuthenticatedUser, input: EnableLedgerInput): Promise<LedgerStatusDto> {
    const organizationId = user.organizationId;
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException("Неверная дата запуска");
    if (startsAt.getTime() > Date.now() + 24 * 3600_000) throw new BadRequestException("Дата запуска не может быть в будущем");

    await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
      if (org.ledgerStartsAt) throw new ConflictException("Главная книга уже запущена");
      const system = await tx.ledgerAccount.findMany({
        where: { organizationId, systemAccountKey: { not: null }, isActive: true },
        select: { systemAccountKey: true },
      });
      const have = new Set(system.map((a) => a.systemAccountKey));
      const missing = SYSTEM_ACCOUNT_KEYS.filter((k) => !have.has(k));
      if (missing.length > 0) {
        throw new BadRequestException("Сначала создайте системные счета: без них операции некуда проводить");
      }
      // The start must lie in an open month, and no later month may already be closed.
      const closed = await tx.financialPeriod.findFirst({
        where: { organizationId, status: { not: "OPEN" }, periodEnd: { gte: startsAt } },
        select: { year: true, month: true },
      });
      if (closed) {
        throw new BadRequestException(`Период ${String(closed.month).padStart(2, "0")}.${closed.year} закрыт — запуск с этой даты невозможен`);
      }
      await tx.organization.update({ where: { id: organizationId }, data: { ledgerStartsAt: startsAt } });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.enable",
        entityType: "Organization",
        entityId: organizationId,
        before: { ledgerStartsAt: null },
        after: { ledgerStartsAt: startsAt },
      });
    });
    return this.getStatus(organizationId);
  }

  // ── journal ─────────────────────────────────────────────────────────────

  async listEntries(organizationId: string, q: JournalListQuery): Promise<JournalEntryDto[]> {
    const where: Prisma.JournalEntryWhereInput = {
      organizationId,
      ...(q.from || q.to
        ? { entryDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.accountId ? { lines: { some: { accountId: q.accountId } } } : {}),
      ...(q.sourceType ? { accountingEvent: { sourceType: q.sourceType } } : {}),
    };
    const rows = await this.prisma.journalEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ entryDate: "desc" }, { number: "desc" }],
      take: Math.min(q.limit ?? 100, 500),
      skip: q.offset ?? 0,
    });
    return rows.map((r) => this.toEntryDto(r));
  }

  async getEntry(organizationId: string, id: string): Promise<JournalEntryDto> {
    const row = await this.prisma.journalEntry.findFirst({ where: { id, organizationId }, include: ENTRY_INCLUDE });
    if (!row) throw new NotFoundException("Проводка не найдена");
    return this.toEntryDto(row);
  }

  // The whole trail for a source document: its accounting events and entries.
  async tracesForSource(organizationId: string, sourceType: string, sourceId: string): Promise<JournalEntryDto[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: { organizationId, accountingEvent: { sourceType, sourceId } },
      include: ENTRY_INCLUDE,
      orderBy: { number: "asc" },
    });
    return rows.map((r) => this.toEntryDto(r));
  }

  async postManual(user: AuthenticatedUser, input: ManualJournalEntryInput): Promise<JournalEntryDto> {
    const organizationId = user.organizationId;
    const description = input.description?.trim();
    if (!description) throw new BadRequestException("Укажите описание проводки");
    const entryDate = new Date(input.entryDate);
    if (Number.isNaN(entryDate.getTime())) throw new BadRequestException("Неверная дата проводки");
    if (!Array.isArray(input.lines) || input.lines.length < 2) throw new BadRequestException("Проводка должна содержать не менее двух строк");

    const id = await this.prisma.$transaction(async (tx) => {
      const lines = await this.resolveLines(tx, organizationId, input.lines);
      const posted = await postJournalEntry(tx, {
        organizationId,
        entryDate,
        description,
        kind: "MANUAL",
        reference: input.reference ?? null,
        actorId: user.id,
        lines,
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.entry.manual",
        entityType: "JournalEntry",
        entityId: posted.id,
        after: { number: posted.number, entryDate, description, reference: input.reference ?? null, lines: input.lines.length },
      });
      return posted.id;
    });
    return this.getEntry(organizationId, id);
  }

  private async resolveLines(
    tx: Prisma.TransactionClient,
    organizationId: string,
    inputs: ManualJournalEntryInput["lines"],
  ): Promise<PostLine[]> {
    const keys = inputs.map((l) => l.systemAccountKey).filter((k): k is SystemAccountKey => !!k);
    const byKey = new Map(
      (await tx.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { in: keys } }, select: { id: true, systemAccountKey: true } })).map((a) => [a.systemAccountKey, a.id]),
    );
    return inputs.map((l, i) => {
      const accountId = l.accountId ?? (l.systemAccountKey ? byKey.get(l.systemAccountKey) : undefined);
      if (!accountId) throw new LedgerRejectedError("ACCOUNT_NOT_FOUND", `Строка ${i + 1}: не указан счёт`);
      return {
        accountId,
        debit: exactAmount(l.debit, `Строка ${i + 1}: дебет`),
        credit: exactAmount(l.credit, `Строка ${i + 1}: кредит`),
        description: l.description ?? null,
        cashSection: l.cashSection ?? null,
        cashAccountId: l.cashAccountId ?? null,
        locationId: l.locationId ?? null,
        productId: l.productId ?? null,
        categoryId: l.categoryId ?? null,
        customerId: l.customerId ?? null,
        supplierId: l.supplierId ?? null,
        employeeId: l.employeeId ?? null,
        financeCategoryId: l.financeCategoryId ?? null,
      };
    });
  }

  async reverse(user: AuthenticatedUser, entryId: string, reason: string): Promise<JournalEntryDto> {
    const organizationId = user.organizationId;
    if (!reason?.trim()) throw new BadRequestException("Укажите причину сторно");
    const reversalId = await this.prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findFirst({
        where: { id: entryId, organizationId },
        select: { id: true, number: true, accountingEventId: true, kind: true },
      });
      const reversal = await reverseJournalEntry(tx, { organizationId, entryId, reason: reason.trim(), actorId: user.id });
      if (original?.accountingEventId) {
        await tx.accountingEvent.update({
          where: { id: original.accountingEventId },
          data: { status: AccountingEventStatus.REVERSED, statusReason: "Сторнировано вручную" },
        });
      }
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.entry.reverse",
        entityType: "JournalEntry",
        entityId: entryId,
        before: { number: original?.number, kind: original?.kind },
        after: { reversalEntryId: reversal.id, reversalNumber: reversal.number },
        reason: reason.trim(),
      });
      return reversal.id;
    });
    return this.getEntry(organizationId, reversalId);
  }

  // ── opening balance (D3 — not approved: explicit, reviewed, never automatic) ─

  // What the owner already declared, laid out as an opening entry for review.
  // Read-only. Nothing about it is final until a person submits it.
  async proposeOpening(organizationId: string): Promise<OpeningBalanceProposalDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        ledgerStartsAt: true,
        financeInitializedAt: true,
        openingInventoryValue: true,
        openingReceivablesValue: true,
        openingPayablesValue: true,
      },
    });
    const notes: string[] = [];
    if (!org.financeInitializedAt) {
      notes.push("Начальное финансовое состояние не заявлено: предложить нечего. Остатки можно ввести вручную.");
      return { startsAt: org.ledgerStartsAt?.toISOString() ?? null, lines: [], notes };
    }
    const [cashRows, assets] = await Promise.all([
      this.prisma.cashMovement.findMany({
        where: { organizationId, type: "OPENING_BALANCE" },
        select: { amount: true, account: { select: { type: true } } },
      }),
      this.prisma.fixedAsset.findMany({ where: { organizationId, isOpening: true }, select: { acquisitionCost: true } }),
    ]);
    const cash = sum(cashRows.filter((r) => r.account.type === "CASH").map((r) => r.amount));
    const bank = sum(cashRows.filter((r) => r.account.type === "BANK").map((r) => r.amount));
    const inventory = dec(org.openingInventoryValue);
    const receivables = dec(org.openingReceivablesValue);
    const payables = dec(org.openingPayablesValue);
    const fixed = sum(assets.map((a) => a.acquisitionCost));
    const lines: OpeningBalanceProposalDto["lines"] = [];
    const add = (key: SystemAccountKey, amount: Dec, source: string) => {
      if (!amount.isZero()) lines.push({ systemAccountKey: key, accountName: SYSTEM_ACCOUNT_DEFS[key].name, amount: num(amount), source });
    };
    add(SystemAccountKey.CASH_ON_HAND, cash, "Начальные остатки касс");
    add(SystemAccountKey.BANK, bank, "Начальные остатки банковских счетов");
    add(SystemAccountKey.INVENTORY, inventory, "Заявленная стоимость запасов");
    add(SystemAccountKey.RECEIVABLES, receivables, "Заявленная дебиторская задолженность");
    add(SystemAccountKey.FIXED_ASSETS, fixed, "Основные средства, внесённые как начальные");
    add(SystemAccountKey.SUPPLIER_PAYABLES, payables, "Заявленная кредиторская задолженность");
    const equity = cash.plus(bank).plus(inventory).plus(receivables).plus(fixed).minus(payables);
    add(SystemAccountKey.OPENING_EQUITY, equity, "Активы за вычетом обязательств, как заявлено");
    notes.push("Полнота заявленного остатка не подтверждена (решение D3): проверьте цифры до проведения.");
    return { startsAt: org.ledgerStartsAt?.toISOString() ?? null, lines, notes };
  }

  async postOpening(user: AuthenticatedUser, input: OpeningBalanceInput): Promise<JournalEntryDto> {
    const organizationId = user.organizationId;
    if (!Array.isArray(input.lines) || input.lines.length < 2) throw new BadRequestException("Начальный остаток должен содержать не менее двух строк");
    const id = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
      if (!org.ledgerStartsAt) throw new LedgerRejectedError("LEDGER_DISABLED", "Главная книга не запущена");
      const existing = await tx.journalEntry.findFirst({
        where: { organizationId, kind: JournalEntryKind.OPENING_BALANCE, reversedBy: null },
        select: { number: true },
      });
      if (existing) {
        throw new ConflictException(`Начальный остаток уже проведён (проводка №${existing.number}). Исправление — сторно и новая проводка`);
      }
      const keys = input.lines.map((l) => l.systemAccountKey).filter((k): k is SystemAccountKey => !!k);
      const byKey = new Map(
        (await tx.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { in: keys } }, select: { id: true, systemAccountKey: true } })).map((a) => [a.systemAccountKey, a.id]),
      );
      const ids = input.lines.map((l) => l.accountId).filter((v): v is string => !!v);
      const accounts = new Map(
        (await tx.ledgerAccount.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, normalBalance: true } })).map((a) => [a.id, a.normalBalance]),
      );
      const keyAccounts = new Map(
        (await tx.ledgerAccount.findMany({ where: { organizationId, systemAccountKey: { in: keys } }, select: { id: true, normalBalance: true, systemAccountKey: true } })).map((a) => [a.systemAccountKey, a]),
      );
      const lines: PostLine[] = input.lines.map((l, i) => {
        const accountId = l.accountId ?? (l.systemAccountKey ? byKey.get(l.systemAccountKey) : undefined);
        if (!accountId) throw new LedgerRejectedError("ACCOUNT_NOT_FOUND", `Строка ${i + 1}: не указан счёт`);
        const normal = l.accountId ? accounts.get(accountId) : keyAccounts.get(l.systemAccountKey as SystemAccountKey)?.normalBalance;
        if (!normal) throw new LedgerRejectedError("ACCOUNT_NOT_FOUND", `Строка ${i + 1}: счёт не найден`);
        const amount = exactAmount(l.amount, `Строка ${i + 1}: сумма`);
        if (amount.isZero()) throw new LedgerRejectedError("BAD_LINE", `Строка ${i + 1}: нулевая сумма`);
        // A negative amount is the opposite of the account's normal side.
        const onNormal = amount.isPositive();
        const abs = amount.abs();
        const debit = (normal === NormalBalance.DEBIT) === onNormal;
        return { accountId, debit: debit ? abs : ZERO, credit: debit ? ZERO : abs, description: "Начальный остаток" };
      });
      const posted = await postJournalEntry(tx, {
        organizationId,
        entryDate: org.ledgerStartsAt,
        description: input.note?.trim() || "Начальный остаток",
        kind: "OPENING_BALANCE",
        reference: "OPENING",
        actorId: user.id,
        lines,
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.entry.opening",
        entityType: "JournalEntry",
        entityId: posted.id,
        after: { number: posted.number, lines: lines.length },
      });
      return posted.id;
    });
    return this.getEntry(organizationId, id);
  }

  // ── posting what was never looked at (history from the start date) ─────────

  // The back door for events the hooks have not seen: operations recorded while
  // the ledger was still off but dated after its start, and events that were
  // NOT_POSTED and may be postable now (a classification was set, an account
  // created). Each batch is its own transaction; nothing dated before the
  // start is touched.
  async postPending(user: AuthenticatedUser): Promise<PostPendingResultDto> {
    const organizationId = user.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
    if (!org.ledgerStartsAt) throw new LedgerRejectedError("LEDGER_DISABLED", "Главная книга не запущена");
    const startsAt = org.ledgerStartsAt;

    const projector = new FinancialEventProjector(this.prisma, new CostingService(this.prisma));
    const all = (await projector.project(organizationId)).filter((e) => new Date(e.occurredAt) >= startsAt);
    const done = new Set(
      (
        await this.prisma.accountingEvent.findMany({
          where: { organizationId, status: { in: [AccountingEventStatus.POSTED, AccountingEventStatus.REVERSED, AccountingEventStatus.NO_GL_EFFECT] } },
          select: { eventKey: true },
        })
      ).map((e) => e.eventKey),
    );
    const todo = all.filter((e) => !done.has(e.key));
    const result: PostPendingResultDto = { considered: all.length, posted: 0, notPosted: 0, alreadyDone: all.length - todo.length };
    for (let i = 0; i < todo.length; i += 25) {
      const batch = todo.slice(i, i + 25);
      const summary = await this.prisma.$transaction(async (tx) => {
        const ctx = await loadPostingContext(tx, organizationId, user.id);
        if (!ctx) throw new LedgerRejectedError("LEDGER_DISABLED", "Главная книга не запущена");
        return postEvents(tx, ctx, batch);
      });
      result.posted += summary.posted;
      result.notPosted += summary.notPosted + summary.unapproved + summary.exceptions;
      result.alreadyDone += summary.alreadyDone;
    }
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "ledger.postPending",
        entityType: "Organization",
        entityId: organizationId,
        after: { ...result },
      }),
    );
    return result;
  }

  // ── reading the ledger ───────────────────────────────────────────────────

  private lineWhere(organizationId: string, q: LedgerFilterQuery, range: { gte?: Date; lt?: Date; lte?: Date }, accountId?: string): Prisma.JournalLineWhereInput {
    return {
      organizationId,
      ...(accountId ? { accountId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.accountType ? { account: { type: q.accountType } } : {}),
      journalEntry: { entryDate: range },
    };
  }

  async getAccountLedger(organizationId: string, accountId: string, q: LedgerFilterQuery): Promise<GeneralLedgerDto> {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException("Счёт не найден");
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const normal = account.normalBalance as NormalBalance;

    const opening = from
      ? await this.prisma.journalLine.aggregate({ where: this.lineWhere(organizationId, q, { lt: from }, accountId), _sum: { debit: true, credit: true } })
      : null;
    const openingBalance = opening ? onNormalSide(normal, dec(opening._sum.debit), dec(opening._sum.credit)) : ZERO;

    const rows = await this.prisma.journalLine.findMany({
      where: this.lineWhere(organizationId, q, { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }, accountId),
      include: { journalEntry: { include: { accountingEvent: { select: { sourceType: true, sourceId: true } } } } },
      orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { number: "asc" } }, { lineNo: "asc" }],
    });
    let running = openingBalance;
    let periodDebit: Dec = ZERO;
    let periodCredit: Dec = ZERO;
    const out = rows.map((r) => {
      periodDebit = periodDebit.plus(r.debit);
      periodCredit = periodCredit.plus(r.credit);
      running = running.plus(onNormalSide(normal, r.debit, r.credit));
      return {
        date: r.journalEntry.entryDate.toISOString(),
        entryId: r.journalEntryId,
        entryNumber: r.journalEntry.number,
        reference: r.journalEntry.reference,
        description: r.description ?? r.journalEntry.description,
        debit: num(r.debit),
        credit: num(r.credit),
        runningBalance: num(running),
        sourceType: r.journalEntry.accountingEvent?.sourceType ?? null,
        sourceId: r.journalEntry.accountingEvent?.sourceId ?? null,
      };
    });
    const hasPostings = (await this.prisma.journalLine.count({ where: { organizationId, accountId } })) > 0;
    return {
      account: this.toAccountDto(account, hasPostings),
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      openingBalance: num(openingBalance),
      periodDebit: num(periodDebit),
      periodCredit: num(periodCredit),
      closingBalance: num(running),
      rows: out,
    };
  }

  async getTrialBalance(organizationId: string, q: LedgerFilterQuery): Promise<TrialBalanceDto> {
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const [accounts, before, within] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { organizationId, ...(q.accountType ? { type: q.accountType } : {}) }, orderBy: { code: "asc" } }),
      from
        ? this.prisma.journalLine.groupBy({ by: ["accountId"], where: this.lineWhere(organizationId, q, { lt: from }), _sum: { debit: true, credit: true } })
        : Promise.resolve([]),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: this.lineWhere(organizationId, q, { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }),
        _sum: { debit: true, credit: true },
      }),
    ]);
    const beforeBy = new Map(before.map((b) => [b.accountId, b._sum]));
    const withinBy = new Map(within.map((w) => [w.accountId, w._sum]));

    const rows: TrialBalanceRowDto[] = [];
    let periodDebit: Dec = ZERO;
    let periodCredit: Dec = ZERO;
    let closingDebit: Dec = ZERO;
    let closingCredit: Dec = ZERO;
    for (const a of accounts) {
      const b = beforeBy.get(a.id);
      const w = withinBy.get(a.id);
      if (!b && !w) continue;
      const normal = a.normalBalance as NormalBalance;
      const openDebit = dec(b?.debit);
      const openCredit = dec(b?.credit);
      const pd = dec(w?.debit);
      const pc = dec(w?.credit);
      const net = openDebit.plus(pd).minus(openCredit.plus(pc)); // debit − credit, cumulative
      const cd = net.isPositive() ? net : ZERO;
      const cc = net.isNegative() ? net.abs() : ZERO;
      periodDebit = periodDebit.plus(pd);
      periodCredit = periodCredit.plus(pc);
      closingDebit = closingDebit.plus(cd);
      closingCredit = closingCredit.plus(cc);
      rows.push({
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type as LedgerAccountType,
        normalBalance: normal,
        openingBalance: num(onNormalSide(normal, openDebit, openCredit)),
        periodDebit: num(pd),
        periodCredit: num(pc),
        closingDebit: num(cd),
        closingCredit: num(cc),
        closingBalance: num(normal === NormalBalance.DEBIT ? net : net.neg()),
      });
    }
    const difference = closingDebit.minus(closingCredit);
    return {
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      rows,
      totals: {
        periodDebit: num(periodDebit),
        periodCredit: num(periodCredit),
        closingDebit: num(closingDebit),
        closingCredit: num(closingCredit),
        balanced: difference.isZero(),
        difference: num(difference),
      },
    };
  }

  // ── mapping ──────────────────────────────────────────────────────────────

  private toAccountDto(
    a: { id: string; code: string; name: string; type: string; normalBalance: string; parentId: string | null; isActive: boolean; systemAccountKey: string | null },
    hasPostings: boolean,
  ): LedgerAccountDto {
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type as LedgerAccountType,
      normalBalance: a.normalBalance as NormalBalance,
      parentId: a.parentId,
      isActive: a.isActive,
      systemAccountKey: (a.systemAccountKey as SystemAccountKey | null) ?? null,
      hasPostings,
    };
  }

  private toEntryDto(r: EntryRow): JournalEntryDto {
    const totalDebit = sum(r.lines.map((l) => l.debit));
    const totalCredit = sum(r.lines.map((l) => l.credit));
    return {
      id: r.id,
      number: r.number,
      entryDate: r.entryDate.toISOString(),
      description: r.description,
      kind: r.kind as JournalEntryKind,
      reference: r.reference,
      periodYear: r.accountingPeriod.year,
      periodMonth: r.accountingPeriod.month,
      postedAt: r.postedAt.toISOString(),
      postedByName: r.postedBy?.fullName ?? null,
      source: r.accountingEvent
        ? {
            accountingEventId: r.accountingEvent.id,
            eventKey: r.accountingEvent.eventKey,
            eventType: r.accountingEvent.eventType,
            sourceType: r.accountingEvent.sourceType,
            sourceId: r.accountingEvent.sourceId,
          }
        : null,
      reversalOfEntryId: r.reversalOfEntryId,
      reversedByEntryId: r.reversedBy?.id ?? null,
      reversalReason: r.reversalReason,
      totalDebit: num(totalDebit),
      totalCredit: num(totalCredit),
      lines: r.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: num(l.debit),
        credit: num(l.credit),
        description: l.description,
        cashSection: l.cashSection,
        cashAccountId: l.cashAccountId,
        locationId: l.locationId,
        productId: l.productId,
        categoryId: l.categoryId,
        customerId: l.customerId,
        supplierId: l.supplierId,
        employeeId: l.employeeId,
        financeCategoryId: l.financeCategoryId,
      })),
    };
  }
}
