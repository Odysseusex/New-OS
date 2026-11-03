import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CashMovementType, ExpenseStatus, InvoiceStatus } from "@prisma/client";
import {
  addDaysToKey,
  buildDebtReport,
  buildStatementLines,
  CounterpartyStatementDto,
  DebtCounterpartyKind,
  debtDateKey,
  DebtDocumentKind,
  debtDueKey,
  DebtGroupInput,
  DebtItemInput,
  DebtReportDto,
  normalizeBin,
  OrganizationRequisitesDto,
  settleOldestFirst,
  StatementEventInput,
  StatementLineKind,
  UpdateOrganizationRequisitesRequestDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { audited } from "../audit/audit";
import { instantOfKey } from "./due-date";

// Who owes us and whom we owe, document by document, on any day — and one
// counterparty's history with a running balance (the card and the акт сверки).
//
// It reads the same documents the balances already come from and writes
// nothing: a sale's debt is its total less what was paid, a delivery's is its
// received total less payments not reversed, a confirmed supplier invoice's and
// a confirmed expense's likewise, and goods sold «под реализацию» are owed to
// their owner less returns and payouts. On a past day, payments made after it
// are put back. Today's figures therefore equal what Финансы already shows.

const SALE_PAYMENT_TYPES = [CashMovementType.SALE_RECEIPT, CashMovementType.CUSTOMER_PAYMENT];
const NONE_GROUP_NAME = "Начисленные расходы (без контрагента)";

const keyLabel = (key: string) => key.split("-").reverse().join(".");
const num = (d: { toNumber: () => number } | null | undefined) => (d ? d.toNumber() : 0);

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  // The last instant of an Almaty day: "on 05.11" means at its close.
  private endOfKey(key: string): Date {
    return new Date(instantOfKey(addDaysToKey(key, 1)).getTime() - 1);
  }

  private parseKey(raw: string | undefined, fallback: string): string {
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      throw new BadRequestException("Дата — в формате ГГГГ-ММ-ДД");
    }
    return raw;
  }

  // ── Дебиторская задолженность ────────────────────────────────────────

  async receivables(organizationId: string, asOfRaw?: string): Promise<DebtReportDto> {
    const asOfKey = this.parseKey(asOfRaw, debtDateKey(new Date()));
    const end = this.endOfKey(asOfKey);
    const [sales, later] = await Promise.all([
      this.prisma.sale.findMany({
        where: { organizationId, customerId: { not: null }, soldAt: { lte: end } },
        select: {
          id: true,
          customerId: true,
          soldAt: true,
          totalAmount: true,
          amountPaid: true,
          paymentDueAt: true,
          location: { select: { name: true } },
        },
      }),
      // Payments taken after the report day are not yet paid on it.
      this.prisma.cashMovement.groupBy({
        by: ["saleId"],
        where: { organizationId, saleId: { not: null }, type: { in: SALE_PAYMENT_TYPES }, occurredAt: { gt: end } },
        _sum: { amount: true },
      }),
    ]);
    const paidLater = new Map(later.map((g) => [g.saleId as string, num(g._sum.amount)]));
    const open = sales.filter((s) => num(s.totalAmount) - (num(s.amountPaid) - (paidLater.get(s.id) ?? 0)) > 0.004);
    const customers = await this.prisma.customer.findMany({
      where: { organizationId, id: { in: [...new Set(open.map((s) => s.customerId as string))] } },
      select: { id: true, name: true, bin: true, paymentTermDays: true },
    });
    const groups = new Map<string, DebtGroupInput>(
      customers.map((c) => [
        c.id,
        { kind: DebtCounterpartyKind.CUSTOMER, counterpartyId: c.id, name: c.name, bin: c.bin, paymentTermDays: c.paymentTermDays, items: [] },
      ]),
    );
    for (const s of open) {
      const group = groups.get(s.customerId as string);
      if (!group) continue;
      const dateKey = debtDateKey(s.soldAt);
      const total = num(s.totalAmount);
      group.items.push({
        kind: DebtDocumentKind.SALE,
        documentId: s.id,
        label: `Реализация от ${keyLabel(dateKey)}, ${s.location.name}`,
        dateKey,
        dueDateKey: debtDueKey(dateKey, group.paymentTermDays, s.paymentDueAt ? debtDateKey(s.paymentDueAt) : null),
        amount: total,
        outstanding: total - (num(s.amountPaid) - (paidLater.get(s.id) ?? 0)),
      });
    }
    return buildDebtReport(asOfKey, [...groups.values()]);
  }

  // ── Кредиторская задолженность ───────────────────────────────────────

  async payables(organizationId: string, asOfRaw?: string): Promise<DebtReportDto> {
    const asOfKey = this.parseKey(asOfRaw, debtDateKey(new Date()));
    const end = this.endOfKey(asOfKey);
    const [orders, invoices, expenses, consignment] = await Promise.all([
      this.openPurchaseOrders(organizationId, end),
      this.openInvoices(organizationId, end),
      this.openExpenses(organizationId, end),
      this.consignmentLots(organizationId, end),
    ]);

    const supplierIds = new Set<string>([...orders.keys(), ...invoices.keys(), ...consignment.keys()]);
    const suppliers = await this.prisma.supplier.findMany({
      where: { organizationId, id: { in: [...supplierIds] } },
      select: { id: true, name: true, bin: true, paymentTermDays: true },
    });
    const groups: DebtGroupInput[] = suppliers.map((sup) => {
      const due = (dateKey: string) => debtDueKey(dateKey, sup.paymentTermDays);
      const items: DebtItemInput[] = [
        ...(orders.get(sup.id) ?? []),
        ...(invoices.get(sup.id) ?? []),
        ...(consignment.get(sup.id) ?? []),
      ].map((i) => ({ ...i, dueDateKey: due(i.dateKey) }));
      return { kind: DebtCounterpartyKind.SUPPLIER, counterpartyId: sup.id, name: sup.name, bin: sup.bin, paymentTermDays: sup.paymentTermDays, items };
    });
    if (expenses.length > 0) {
      groups.push({ kind: DebtCounterpartyKind.NONE, counterpartyId: null, name: NONE_GROUP_NAME, bin: null, paymentTermDays: null, items: expenses });
    }
    return buildDebtReport(asOfKey, groups);
  }

  // Deliveries owed from the purchasing cutover on (earlier ones were settled
  // outside the system — the same rule as the balance sheet's payables).
  private async openPurchaseOrders(organizationId: string, end: Date): Promise<Map<string, Omit<DebtItemInput, "dueDateKey">[]>> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { purchaseCutoverAt: true } });
    const out = new Map<string, Omit<DebtItemInput, "dueDateKey">[]>();
    if (!org?.purchaseCutoverAt) return out;
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { organizationId, status: "RECEIVED", receivedAt: { gte: org.purchaseCutoverAt, lte: end } },
      select: {
        id: true,
        supplierId: true,
        receivedAt: true,
        totalCost: true,
        receivedTotal: true,
        location: { select: { name: true } },
        payments: { select: { amount: true, paidAt: true, reversedAt: true } },
        supplierReturns: { where: { createdAt: { lte: end } }, select: { creditedAmount: true, refundedAmount: true } },
      },
    });
    for (const o of orders) {
      const amount = num(o.receivedTotal ?? o.totalCost);
      const paid = o.payments
        .filter((p) => p.paidAt <= end && (p.reversedAt === null || p.reversedAt > end))
        .reduce((sum, p) => sum + num(p.amount), 0);
      // Goods handed back reduce what is owed; money the supplier gave back for them restores it.
      const returned = o.supplierReturns.reduce((sum, r) => sum + num(r.creditedAmount) - num(r.refundedAmount), 0);
      const dateKey = debtDateKey(o.receivedAt as Date);
      const list = out.get(o.supplierId) ?? [];
      list.push({
        kind: DebtDocumentKind.PURCHASE_ORDER,
        documentId: o.id,
        label: `Приход по заказу от ${keyLabel(dateKey)}, ${o.location.name}`,
        dateKey,
        amount,
        outstanding: amount - returned - paid,
      });
      out.set(o.supplierId, list);
    }
    return out;
  }

  private async openInvoices(organizationId: string, end: Date): Promise<Map<string, Omit<DebtItemInput, "dueDateKey">[]>> {
    const [invoices, later] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { organizationId, status: InvoiceStatus.CONFIRMED, issuedAt: { lte: end } },
        select: { id: true, supplierId: true, number: true, issuedAt: true, totalCost: true, amountPaid: true },
      }),
      this.prisma.cashMovement.groupBy({
        by: ["invoiceId"],
        where: { organizationId, invoiceId: { not: null }, type: CashMovementType.SUPPLIER_PAYMENT, occurredAt: { gt: end } },
        _sum: { amount: true },
      }),
    ]);
    const paidLater = new Map(later.map((g) => [g.invoiceId as string, num(g._sum.amount)]));
    const out = new Map<string, Omit<DebtItemInput, "dueDateKey">[]>();
    for (const i of invoices) {
      const amount = num(i.totalCost);
      const dateKey = debtDateKey(i.issuedAt);
      const list = out.get(i.supplierId) ?? [];
      list.push({
        kind: DebtDocumentKind.INVOICE,
        documentId: i.id,
        label: `Накладная №${i.number} от ${keyLabel(dateKey)}`,
        dateKey,
        amount,
        outstanding: amount - (num(i.amountPaid) - (paidLater.get(i.id) ?? 0)),
      });
      out.set(i.supplierId, list);
    }
    return out;
  }

  private async openExpenses(organizationId: string, end: Date): Promise<DebtItemInput[]> {
    const [expenses, later] = await Promise.all([
      this.prisma.expense.findMany({
        where: { organizationId, status: ExpenseStatus.CONFIRMED, incurredOn: { lte: end } },
        select: { id: true, description: true, incurredOn: true, amount: true, amountPaid: true, categoryRef: { select: { name: true } } },
      }),
      this.prisma.cashMovement.groupBy({
        by: ["expenseId"],
        where: { organizationId, expenseId: { not: null }, type: CashMovementType.EXPENSE_PAYMENT, occurredAt: { gt: end } },
        _sum: { amount: true },
      }),
    ]);
    const paidLater = new Map(later.map((g) => [g.expenseId as string, num(g._sum.amount)]));
    return expenses.map((e) => {
      const dateKey = debtDateKey(e.incurredOn);
      const amount = num(e.amount);
      return {
        kind: DebtDocumentKind.EXPENSE,
        documentId: e.id,
        label: e.description || e.categoryRef?.name || "Расход",
        dateKey,
        dueDateKey: dateKey,
        amount,
        outstanding: amount - (num(e.amountPaid) - (paidLater.get(e.id) ?? 0)),
      };
    });
  }

  // Goods «под реализацию»: each day's takings of a supplier's goods are owed
  // to them; returns and payouts settle the oldest days first.
  private async consignmentLots(organizationId: string, end: Date): Promise<Map<string, Omit<DebtItemInput, "dueDateKey">[]>> {
    const events = await this.consignmentEvents(organizationId, null, end);
    const out = new Map<string, Omit<DebtItemInput, "dueDateKey">[]>();
    for (const [supplierId, e] of events) {
      const lots = [...e.soldByDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([dateKey, amount]) => ({ dateKey, amount }));
      const settled = e.returns.reduce((s, r) => s + r.amount, 0) + e.payments.reduce((s, p) => s + p.amount, 0);
      out.set(
        supplierId,
        settleOldestFirst(lots, settled).map((lot) => ({
          kind: DebtDocumentKind.CONSIGNMENT,
          documentId: null,
          label: `Продано под реализацию за ${keyLabel(lot.dateKey)}`,
          dateKey: lot.dateKey,
          amount: lot.amount,
          outstanding: lot.outstanding,
        })),
      );
    }
    return out;
  }

  private async consignmentEvents(
    organizationId: string,
    supplierId: string | null,
    end: Date,
  ): Promise<Map<string, { soldByDay: Map<string, number>; returns: { at: Date; amount: number }[]; payments: { at: Date; amount: number; note: string | null }[] }>> {
    const bySupplier = supplierId ? { consignmentSupplierId: supplierId } : { consignmentSupplierId: { not: null } };
    const [sold, returned, paid] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { ...bySupplier, sale: { organizationId, soldAt: { lte: end } } },
        select: { consignmentSupplierId: true, subtotal: true, sale: { select: { soldAt: true } } },
      }),
      this.prisma.saleReturnItem.findMany({
        where: { ...bySupplier, saleReturn: { organizationId, returnedAt: { lte: end } } },
        select: { consignmentSupplierId: true, subtotal: true, saleReturn: { select: { returnedAt: true } } },
      }),
      this.prisma.consignmentPayment.findMany({
        where: { organizationId, ...(supplierId ? { supplierId } : {}), paidAt: { lte: end } },
        select: { supplierId: true, amount: true, paidAt: true, note: true },
      }),
    ]);
    const out = new Map<string, { soldByDay: Map<string, number>; returns: { at: Date; amount: number }[]; payments: { at: Date; amount: number; note: string | null }[] }>();
    const of = (id: string) => {
      let e = out.get(id);
      if (!e) out.set(id, (e = { soldByDay: new Map(), returns: [], payments: [] }));
      return e;
    };
    for (const i of sold) {
      const e = of(i.consignmentSupplierId as string);
      const key = debtDateKey(i.sale.soldAt);
      e.soldByDay.set(key, (e.soldByDay.get(key) ?? 0) + num(i.subtotal));
    }
    for (const r of returned) of(r.consignmentSupplierId as string).returns.push({ at: r.saleReturn.returnedAt, amount: num(r.subtotal) });
    for (const p of paid) of(p.supplierId).payments.push({ at: p.paidAt, amount: num(p.amount), note: p.note });
    return out;
  }

  // ── Карточка контрагента и акт сверки ────────────────────────────────

  async statement(
    organizationId: string,
    kind: DebtCounterpartyKind,
    counterpartyId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<CounterpartyStatementDto> {
    const toKey = this.parseKey(toRaw, debtDateKey(new Date()));
    const fromKey = this.parseKey(fromRaw, `${toKey.slice(0, 8)}01`);
    if (fromKey > toKey) throw new BadRequestException("Начало периода позже его конца");
    const end = this.endOfKey(toKey);

    let counterparty: { id: string; name: string; bin: string | null };
    let events: StatementEventInput[];
    if (kind === DebtCounterpartyKind.CUSTOMER) {
      const customer = await this.prisma.customer.findFirst({ where: { id: counterpartyId, organizationId }, select: { id: true, name: true, bin: true } });
      if (!customer) throw new NotFoundException("Клиент не найден");
      counterparty = customer;
      events = await this.customerEvents(organizationId, customer.id, end);
    } else if (kind === DebtCounterpartyKind.SUPPLIER) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: counterpartyId, organizationId }, select: { id: true, name: true, bin: true } });
      if (!supplier) throw new NotFoundException("Поставщик не найден");
      counterparty = supplier;
      events = await this.supplierEvents(organizationId, supplier.id, end);
    } else {
      throw new BadRequestException("Карточка строится только по покупателю или поставщику");
    }

    const organization = await this.requisites(organizationId);
    return { kind, counterparty, organization, fromKey, toKey, ...buildStatementLines(events, fromKey, toKey) };
  }

  // Our side of a customer's account: what we shipped (debit), what they paid
  // and what they brought back (credit), the money we handed back on a return
  // (debit). A payment recorded on the sale with no money movement behind it
  // (no account to land in) still counts, on the day of the sale — so the
  // balance always equals what the sales say is unpaid.
  private async customerEvents(organizationId: string, customerId: string, end: Date): Promise<StatementEventInput[]> {
    const sales = await this.prisma.sale.findMany({
      where: { organizationId, customerId, soldAt: { lte: end } },
      select: {
        id: true,
        soldAt: true,
        totalAmount: true,
        amountPaid: true,
        location: { select: { name: true } },
        cashMovements: { where: { type: { in: SALE_PAYMENT_TYPES } }, select: { amount: true, occurredAt: true, type: true } },
        returns: { where: { returnedAt: { lte: end } }, select: { returnedAt: true, totalAmount: true } },
      },
      orderBy: { soldAt: "asc" },
    });
    const events: StatementEventInput[] = [];
    for (const s of sales) {
      const doc = `Реализация от ${keyLabel(debtDateKey(s.soldAt))}, ${s.location.name}`;
      events.push({ at: s.soldAt.toISOString(), kind: StatementLineKind.SALE, document: doc, debit: num(s.totalAmount), credit: 0 });
      const recorded = s.cashMovements.reduce((sum, m) => sum + num(m.amount), 0);
      const unrecorded = num(s.amountPaid) - recorded;
      if (unrecorded > 0.004) {
        events.push({ at: s.soldAt.toISOString(), kind: StatementLineKind.PAYMENT_RECEIVED, document: `Оплата при продаже: ${doc}`, debit: 0, credit: unrecorded });
      }
      for (const m of s.cashMovements) {
        if (m.occurredAt > end) continue;
        events.push({ at: m.occurredAt.toISOString(), kind: StatementLineKind.PAYMENT_RECEIVED, document: `Оплата: ${doc}`, debit: 0, credit: num(m.amount) });
      }
      for (const r of s.returns) {
        const amount = num(r.totalAmount);
        const at = r.returnedAt.toISOString();
        events.push({ at, kind: StatementLineKind.SALE_RETURN, document: `Возврат по реализации от ${keyLabel(debtDateKey(s.soldAt))}`, debit: 0, credit: amount });
        events.push({ at, kind: StatementLineKind.REFUND_PAID, document: `Возврат денег по реализации от ${keyLabel(debtDateKey(s.soldAt))}`, debit: amount, credit: 0 });
      }
    }
    return events;
  }

  // Our side of a supplier's account: deliveries and goods of theirs we sold
  // (credit), our payments and goods of theirs a buyer brought back (debit), a
  // reversed payment (credit again).
  private async supplierEvents(organizationId: string, supplierId: string, end: Date): Promise<StatementEventInput[]> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { purchaseCutoverAt: true } });
    const [orders, invoices, consignment] = await Promise.all([
      org?.purchaseCutoverAt
        ? this.prisma.purchaseOrder.findMany({
            where: { organizationId, supplierId, status: "RECEIVED", receivedAt: { gte: org.purchaseCutoverAt, lte: end } },
            select: {
              receivedAt: true,
              totalCost: true,
              receivedTotal: true,
              location: { select: { name: true } },
              payments: { select: { amount: true, paidAt: true, reversedAt: true } },
              supplierReturns: { where: { createdAt: { lte: end } }, select: { createdAt: true, creditedAmount: true, refundedAmount: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.invoice.findMany({
        where: { organizationId, supplierId, status: InvoiceStatus.CONFIRMED, issuedAt: { lte: end } },
        select: {
          number: true,
          issuedAt: true,
          totalCost: true,
          amountPaid: true,
          cashMovements: { where: { type: CashMovementType.SUPPLIER_PAYMENT }, select: { amount: true, occurredAt: true } },
        },
      }),
      this.consignmentEvents(organizationId, supplierId, end),
    ]);
    const events: StatementEventInput[] = [];
    for (const o of orders) {
      const doc = `Приход по заказу от ${keyLabel(debtDateKey(o.receivedAt as Date))}, ${o.location.name}`;
      events.push({ at: (o.receivedAt as Date).toISOString(), kind: StatementLineKind.DELIVERY, document: doc, debit: 0, credit: num(o.receivedTotal ?? o.totalCost) });
      for (const p of o.payments) {
        if (p.paidAt > end) continue;
        events.push({ at: p.paidAt.toISOString(), kind: StatementLineKind.PAYMENT_MADE, document: `Оплата: ${doc}`, debit: num(p.amount), credit: 0 });
        if (p.reversedAt && p.reversedAt <= end) {
          events.push({ at: p.reversedAt.toISOString(), kind: StatementLineKind.PAYMENT_REVERSED, document: `Сторно оплаты: ${doc}`, debit: 0, credit: num(p.amount) });
        }
      }
      for (const r of o.supplierReturns) {
        events.push({ at: r.createdAt.toISOString(), kind: StatementLineKind.SUPPLIER_RETURN, document: `Возврат товара: ${doc}`, debit: num(r.creditedAmount), credit: 0 });
        if (num(r.refundedAmount) > 0) {
          events.push({ at: r.createdAt.toISOString(), kind: StatementLineKind.SUPPLIER_REFUND, document: `Возврат денег: ${doc}`, debit: 0, credit: num(r.refundedAmount) });
        }
      }
    }
    for (const i of invoices) {
      const doc = `Накладная №${i.number} от ${keyLabel(debtDateKey(i.issuedAt))}`;
      events.push({ at: i.issuedAt.toISOString(), kind: StatementLineKind.DELIVERY, document: doc, debit: 0, credit: num(i.totalCost) });
      const recorded = i.cashMovements.reduce((sum, m) => sum + num(m.amount), 0);
      const unrecorded = num(i.amountPaid) - recorded;
      if (unrecorded > 0.004) {
        events.push({ at: i.issuedAt.toISOString(), kind: StatementLineKind.PAYMENT_MADE, document: `Оплата: ${doc}`, debit: unrecorded, credit: 0 });
      }
      for (const m of i.cashMovements) {
        if (m.occurredAt > end) continue;
        events.push({ at: m.occurredAt.toISOString(), kind: StatementLineKind.PAYMENT_MADE, document: `Оплата: ${doc}`, debit: num(m.amount), credit: 0 });
      }
    }
    const c = consignment.get(supplierId);
    if (c) {
      for (const [key, amount] of c.soldByDay) {
        // A day's takings, dated at the close of that day.
        events.push({ at: this.endOfKey(key).toISOString(), kind: StatementLineKind.CONSIGNMENT_SOLD, document: `Продано под реализацию за ${keyLabel(key)}`, debit: 0, credit: amount });
      }
      for (const r of c.returns) {
        events.push({ at: r.at.toISOString(), kind: StatementLineKind.CONSIGNMENT_RETURNED, document: "Возврат товара покупателем", debit: amount2(r.amount), credit: 0 });
      }
      for (const p of c.payments) {
        events.push({ at: p.at.toISOString(), kind: StatementLineKind.PAYMENT_MADE, document: p.note ? `Выплата за реализацию: ${p.note}` : "Выплата за реализацию", debit: p.amount, credit: 0 });
      }
    }
    return events;
  }

  // ── Реквизиты организации ────────────────────────────────────────────

  async requisites(organizationId: string): Promise<OrganizationRequisitesDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, legalName: true, bin: true } });
    return org;
  }

  async updateRequisites(organizationId: string, dto: UpdateOrganizationRequisitesRequestDto, actorId: string): Promise<OrganizationRequisitesDto> {
    const before = await this.requisites(organizationId);
    const data = {
      ...(dto.legalName !== undefined ? { legalName: dto.legalName?.trim() || null } : {}),
      ...(dto.bin !== undefined ? { bin: normalizeBin(dto.bin) } : {}),
    };
    return audited(
      this.prisma,
      { organizationId, actorId, action: "organization.requisites", entityType: "Organization", entityId: organizationId, before },
      async (tx) => {
        const saved = await tx.organization.update({ where: { id: organizationId }, data, select: { name: true, legalName: true, bin: true } });
        return { result: saved, after: saved };
      },
    );
  }
}

const amount2 = (n: number) => Math.round(n * 100) / 100;
