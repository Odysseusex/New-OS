import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import {
  BALANCE_LINE_LABELS_RU,
  BALANCE_LINE_SIDE,
  BalanceControlLineDto,
  BalanceLine,
  BalanceLineDto,
  BalanceSheetDto,
  BalanceSource,
  BalanceStatus,
  COSTING_METHOD_LABEL_RU,
  FinancialEventType,
  InventoryRollForwardDto,
  InventoryRollForwardLineDto,
  MonthlyReportDto,
  STOCK_MOVEMENT_TYPE_LABELS_RU,
  StockMovementType,
} from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { CostingService } from "../../costing/costing.service";
import { round2, round3 } from "../../common/money";
import { monthRange, previousMonth } from "../../common/reporting-period";
import { cashEffectOf, stockEffectOf } from "../../common/ledger-effects";
import { FinanceService } from "../finance.service";
import { FinancialEventProjector } from "../events/projector";
import { FinancialPeriodsService } from "../periods/periods.service";

// One tenge: below this the two sides are considered to agree (a statement
// built from thousands of two-decimal lines can carry a rounding remainder).
export const BALANCE_TOLERANCE = 1;

// "Live" means: as of now, where the documents themselves are the ledger.
const NEAR_NOW_MS = 60_000;

@Injectable()
export class BalanceService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
    private events: FinancialEventProjector = new FinancialEventProjector(prisma),
    private costing: CostingService = new CostingService(prisma),
    @Optional() private periods?: FinancialPeriodsService,
  ) {}

  // Closing a period stores the balance and the inventory roll-forward with it.
  onModuleInit() {
    this.registerWithPeriods();
  }

  registerWithPeriods(periods: FinancialPeriodsService | undefined = this.periods) {
    periods?.registerSection({ key: "balance", build: (org, _from, to) => this.getBalanceSheet(org, to) });
    periods?.registerSection({ key: "inventory", build: (org, from, to) => this.getInventoryRollForward(org, from, to) });
  }

  // ── the balance sheet ──────────────────────────────────────────────────

  async getBalanceSheet(organizationId: string, asOf: Date = new Date()): Promise<BalanceSheetDto> {
    const [org, allEvents] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { financeInitializedAt: true } }),
      this.events.project(organizationId, { upTo: asOf }),
    ]);
    const goLive = org.financeInitializedAt;
    const live = Math.abs(Date.now() - asOf.getTime()) <= NEAR_NOW_MS || asOf.getTime() > Date.now();

    // What the events say, from the declared opening on. Events before it are
    // already inside the declared figures — except each account's own
    // opening balance, which is how cash is declared.
    const counted = goLive
      ? allEvents.filter((e) => e.type === FinancialEventType.OPENING_BALANCE || e.occurredAt >= goLive.toISOString())
      : [];
    const projected = new Map<BalanceLine, number>();
    let accumulatedResult = 0;
    for (const e of counted) {
      for (const leg of e.balance) projected.set(leg.line, (projected.get(leg.line) ?? 0) + leg.delta);
      accumulatedResult += e.pnl.reduce((s, p) => s + p.amount, 0);
    }
    const proj = (line: BalanceLine) => round2(projected.get(line) ?? 0);

    // What the ledgers, registers and documents actually hold.
    const [cashParts, inventoryParts, fixedAssets, payables, receivablesDoc, advances] = await Promise.all([
      this.cashByAccountAt(organizationId, asOf),
      this.inventoryAt(organizationId, asOf),
      this.fixedAssetsAt(organizationId, asOf),
      live ? this.finance.getPayablesBreakdown(organizationId) : Promise.resolve(null),
      live ? this.finance.getAccountsReceivable(organizationId) : Promise.resolve(null),
      // Shown gross only from today's documents; on a past date the events
      // hold them net inside receivables / payables.
      live ? this.finance.getAdvances(organizationId) : Promise.resolve({ paid: 0, received: 0 }),
    ]);

    const inventory = inventoryParts.total;
    const cash = cashParts.total;
    const line = (l: BalanceLine, amount: number, source: BalanceSource): BalanceLineDto => ({
      line: l,
      label: BALANCE_LINE_LABELS_RU[l],
      amount: round2(amount),
      source,
    });
    const assetLines = [
      { ...line(BalanceLine.CASH_AND_BANK, cash, "LEDGER"), breakdown: cashParts.breakdown },
      { ...line(BalanceLine.INVENTORY, inventory, "LEDGER"), breakdown: inventoryParts.breakdown.map(({ label, amount }) => ({ label, amount })) },
      line(BalanceLine.RECEIVABLES, receivablesDoc ?? proj(BalanceLine.RECEIVABLES), receivablesDoc === null ? "EVENTS" : "DOCUMENTS"),
      line(BalanceLine.FIXED_ASSETS, fixedAssets, "REGISTER"),
      ...(advances.paid > 0 ? [line(BalanceLine.ADVANCES_PAID, advances.paid, "DOCUMENTS")] : []),
    ];
    const liabilityLines = [
      line(BalanceLine.SUPPLIER_PAYABLES, payables?.suppliers ?? proj(BalanceLine.SUPPLIER_PAYABLES), payables ? "DOCUMENTS" : "EVENTS"),
      {
        ...line(BalanceLine.EXPENSE_PAYABLES, payables?.expenses ?? proj(BalanceLine.EXPENSE_PAYABLES), payables ? "DOCUMENTS" : "EVENTS"),
        ...(payables && payables.expensesByArticle.length > 0 ? { breakdown: payables.expensesByArticle } : {}),
      },
      line(BalanceLine.CONSIGNMENT_PAYABLES, payables?.consignment ?? proj(BalanceLine.CONSIGNMENT_PAYABLES), payables ? "DOCUMENTS" : "EVENTS"),
      // No register of loans exists: the figure IS the events'.
      line(BalanceLine.LOANS, proj(BalanceLine.LOANS), "EVENTS"),
      ...(advances.received > 0 ? [line(BalanceLine.ADVANCES_RECEIVED, advances.received, "DOCUMENTS")] : []),
    ];
    const equityLines = [
      line(BalanceLine.OPENING_EQUITY, proj(BalanceLine.OPENING_EQUITY), "EVENTS"),
      line(BalanceLine.OWNER_CONTRIBUTIONS, proj(BalanceLine.OWNER_CONTRIBUTIONS), "EVENTS"),
      line(BalanceLine.OWNER_WITHDRAWALS, proj(BalanceLine.OWNER_WITHDRAWALS), "EVENTS"),
    ];
    const assetsTotal = round2(assetLines.reduce((s, l) => s + l.amount, 0));
    const liabilitiesTotal = round2(liabilityLines.reduce((s, l) => s + l.amount, 0));
    const result = round2(accumulatedResult);
    // Equity is built from its OWN history. It is not Assets − Liabilities.
    const equityTotal = round2(equityLines.reduce((s, l) => s + l.amount, 0) + result);
    const difference = round2(assetsTotal - liabilitiesTotal - equityTotal);

    const status = !goLive
      ? BalanceStatus.NOT_AVAILABLE
      : Math.abs(difference) <= BALANCE_TOLERANCE
        ? BalanceStatus.BALANCED
        : BalanceStatus.NOT_BALANCED;

    // ── CONTROL: a separate list of real comparisons, never part of a total ─
    const control: BalanceControlLineDto[] = [];
    const compare = (label: string, actual: number, projectedValue: number, sign: 1 | -1) => {
      const effect = round2(sign * (actual - projectedValue));
      if (effect !== 0) control.push({ label, actual: round2(actual), projected: round2(projectedValue), effect });
    };
    if (goLive) {
      compare("Денежные средства: журнал и события", cash, proj(BalanceLine.CASH_AND_BANK), 1);
      compare("Запасы: оценка складских остатков и события", inventory, proj(BalanceLine.INVENTORY), 1);
      // Advances are inside receivables / payables in the events (net).
      compare("Дебиторская задолженность: документы и события", assetLines[2].amount - advances.received, proj(BalanceLine.RECEIVABLES), 1);
      compare("Основные средства: реестр и события", fixedAssets, proj(BalanceLine.FIXED_ASSETS), 1);
      compare(
        "Кредиторская задолженность: документы и события",
        liabilityLines.slice(0, 3).reduce((s, l) => s + l.amount, 0) - advances.paid,
        proj(BalanceLine.SUPPLIER_PAYABLES) + proj(BalanceLine.EXPENSE_PAYABLES) + proj(BalanceLine.CONSIGNMENT_PAYABLES),
        -1,
      );
      // Events that only know one side of what happened.
      const oneSided = new Map<string, { amount: number; count: number }>();
      for (const e of counted) {
        if (!e.unclassified) continue;
        let a = 0;
        let l = 0;
        let q = 0;
        for (const leg of e.balance) {
          const side = BALANCE_LINE_SIDE[leg.line];
          if (side === "ASSET") a += leg.delta;
          else if (side === "LIABILITY") l += leg.delta;
          else q += leg.delta;
        }
        const imbalance = round2(a - l - q - e.pnl.reduce((s, p) => s + p.amount, 0));
        if (imbalance === 0) continue;
        const entry = oneSided.get(e.description) ?? { amount: 0, count: 0 };
        entry.amount += imbalance;
        entry.count += 1;
        oneSided.set(e.description, entry);
      }
      for (const [label, v] of oneSided) {
        control.push({ label: `${label} (${v.count})`, actual: null, projected: null, effect: round2(v.amount) });
      }
    }

    const notes: string[] = [];
    if (!goLive) notes.push("Начальное финансовое состояние не заявлено — капитал построить не из чего");
    if (goLive) {
      const preCash = allEvents.filter((e) => e.occurredAt < goLive.toISOString() && e.type !== FinancialEventType.OPENING_BALANCE && e.cash.length > 0).length;
      if (preCash > 0) notes.push(`Денежных движений до запуска финансового учёта: ${preCash} — в заявленный остаток они не входят`);
    }
    const incomplete = counted.filter((e) => e.unclassified).length;
    if (incomplete > 0) notes.push(`Событий без известной второй стороны: ${incomplete}`);

    return {
      asOf: asOf.toISOString(),
      status,
      assets: { lines: assetLines, total: assetsTotal },
      liabilities: { lines: liabilityLines, total: liabilitiesTotal },
      equity: { lines: equityLines, total: equityTotal, accumulatedResult: result },
      control: { difference, lines: control, notes },
      costingMethod: COSTING_METHOD_LABEL_RU,
    };
  }

  // ── inventory roll-forward ─────────────────────────────────────────────

  async getInventoryRollForward(organizationId: string, from: Date, to: Date): Promise<InventoryRollForwardDto> {
    const [movements, levels, costs] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { organizationId, product: { trackInventory: true } },
        select: { type: true, quantity: true, saleReturnId: true, productId: true, unitCost: true, createdAt: true, locationId: true },
      }),
      this.prisma.stockLevel.findMany({ where: { organizationId, product: { trackInventory: true } }, select: { productId: true, locationId: true, quantity: true } }),
      this.costing.currentUnitCosts(organizationId),
    ]);

    let unvalued = 0;
    const valueOf = (productId: string, stamped: { toNumber: () => number } | null, quantity: number): number => {
      const unit = stamped?.toNumber() ?? costs.get(productId)?.unitCost ?? null;
      if (unit === null) {
        unvalued += quantity === 0 ? 0 : 1;
        return 0;
      }
      return quantity * unit;
    };

    // Opening: everything the ledger recorded before the period. In-period:
    // each movement at its own stamped cost. Both from the ledger alone.
    let openingQty = 0;
    let openingValue = 0;
    const buckets = new Map<string, { quantity: number; value: number }>();
    let afterQty = 0;
    const perProductAfter = new Map<string, number>();
    for (const m of movements) {
      const effect = stockEffectOf({ type: m.type, quantity: m.quantity.toNumber(), saleReturnId: m.saleReturnId });
      if (effect === 0) continue;
      if (m.createdAt < from) {
        openingQty += effect;
        openingValue += valueOf(m.productId, m.unitCost, effect);
      } else if (m.createdAt <= to) {
        const b = buckets.get(m.type) ?? { quantity: 0, value: 0 };
        b.quantity += effect;
        b.value += valueOf(m.productId, m.unitCost, effect);
        buckets.set(m.type, b);
      } else {
        afterQty += effect;
        perProductAfter.set(m.productId, (perProductAfter.get(m.productId) ?? 0) + effect);
      }
    }
    const rows: InventoryRollForwardLineDto[] = [...buckets.entries()]
      .map(([type, b]) => ({
        key: type,
        label: STOCK_MOVEMENT_TYPE_LABELS_RU[type as StockMovementType] ?? type,
        quantity: round3(b.quantity),
        value: round2(b.value),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const netQty = rows.reduce((s, r) => s + r.quantity, 0);
    const netValue = rows.reduce((s, r) => s + r.value, 0);
    const closingComputed = { quantity: round3(openingQty + netQty), value: round2(openingValue + netValue) };

    // What the stock levels held at the end of the period: today's levels with
    // everything recorded after `to` taken back out.
    const totalLevel = levels.reduce((s, l) => s + l.quantity.toNumber(), 0);
    const actualQty = round3(totalLevel - afterQty);
    let actualValue = 0;
    const levelByProduct = new Map<string, number>();
    for (const l of levels) levelByProduct.set(l.productId, (levelByProduct.get(l.productId) ?? 0) + l.quantity.toNumber());
    for (const [productId, qty] of levelByProduct) {
      const atEnd = qty - (perProductAfter.get(productId) ?? 0);
      const unit = costs.get(productId)?.unitCost;
      if (atEnd > 0 && unit !== undefined) actualValue += atEnd * unit;
    }
    const closingActual = { quantity: actualQty, value: round2(actualValue) };
    const difference = {
      quantity: round3(closingActual.quantity - closingComputed.quantity),
      value: round2(closingActual.value - closingComputed.value),
    };
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      opening: { quantity: round3(openingQty), value: round2(openingValue) },
      movements: rows,
      closingComputed,
      closingActual,
      difference,
      // Quantities must agree with the ledger; the value can differ by
      // valuation alone (stamped cost vs today's cost) and is shown, not absorbed.
      reconciles: difference.quantity === 0,
      unvaluedMovements: unvalued,
      costingMethod: COSTING_METHOD_LABEL_RU,
    };
  }

  // ── the monthly report ─────────────────────────────────────────────────

  async getMonthlyReport(organizationId: string, year: number, month: number): Promise<MonthlyReportDto> {
    const range = monthRange(year, month);
    const prev = previousMonth(year, month);
    const prevRange = monthRange(prev.year, prev.month);
    const asOf = range.end.getTime() > Date.now() ? new Date() : range.end;
    const frozen = this.periods ? await this.periods.frozenSection<unknown>(organizationId, year, month, "pnl") : null;
    const [pnl, previousPnl, cashFlow, balance, inventory, accountsReceivable, accountsPayable] = await Promise.all([
      frozen ? Promise.resolve(frozen.data as MonthlyReportDto["pnl"]) : this.finance.getProfitAndLoss(organizationId, range.start, range.end),
      this.finance.getProfitAndLoss(organizationId, prevRange.start, prevRange.end),
      this.finance.getCashFlow(organizationId, range.start, range.end),
      this.getBalanceSheet(organizationId, asOf),
      this.getInventoryRollForward(organizationId, range.start, asOf),
      this.finance.getAccountsReceivable(organizationId),
      this.finance.getAccountsPayable(organizationId),
    ]);
    return {
      year,
      month,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      pnl,
      previousPnl,
      cashFlow,
      balance,
      inventory,
      accountsReceivable,
      accountsPayable,
    };
  }

  // ── ledger-side figures ────────────────────────────────────────────────

  // Money in the accounts at a moment: the cash ledger summed up to it.
  async cashAt(organizationId: string, asOf: Date): Promise<number> {
    return (await this.cashByAccountAt(organizationId, asOf)).total;
  }

  // Money on `asOf`, and per account (ТЗ §8.3 «Денежные средства (по счетам)»).
  async cashByAccountAt(organizationId: string, asOf: Date): Promise<{ total: number; breakdown: { label: string; amount: number }[] }> {
    const rows = await this.prisma.cashMovement.findMany({
      where: { organizationId, occurredAt: { lte: asOf } },
      select: { type: true, amount: true, account: { select: { name: true } } },
    });
    const byAccount = new Map<string, number>();
    let total = 0;
    for (const m of rows) {
      const v = cashEffectOf({ type: m.type, amount: m.amount.toNumber() });
      total += v;
      byAccount.set(m.account.name, (byAccount.get(m.account.name) ?? 0) + v);
    }
    return {
      total: round2(total),
      breakdown: [...byAccount].map(([label, amount]) => ({ label, amount: round2(amount) })).filter((l) => l.amount !== 0).sort((a, b) => b.amount - a.amount),
    };
  }

  // Stock on hand at a moment × the costing service's cost. Anchored at today's
  // stock levels, with everything recorded after the moment taken back out —
  // so it holds the physical count where the ledger has drifted from it.
  async inventoryValueAt(organizationId: string, asOf: Date): Promise<number> {
    return (await this.inventoryAt(organizationId, asOf)).total;
  }

  // Stock at cost on `asOf`, and the same figure split for the balance sheet (ТЗ §8.3):
  // raw materials in store, raw materials in the workshop (незавершённое
  // производство) and finished goods. Each product is valued exactly as before
  // (network quantity × its unit cost, rounded once), then shared between the
  // parts by where its quantity lies — so the parts always add up to the total.
  async inventoryAt(organizationId: string, asOf: Date): Promise<{ total: number; breakdown: { key: string; label: string; amount: number }[] }> {
    const [levels, after, costs, products, locations] = await Promise.all([
      this.prisma.stockLevel.findMany({ where: { organizationId, product: { trackInventory: true } }, select: { productId: true, locationId: true, quantity: true } }),
      asOf.getTime() >= Date.now() - NEAR_NOW_MS
        ? Promise.resolve([])
        : this.prisma.stockMovement.findMany({
            where: { organizationId, createdAt: { gt: asOf }, product: { trackInventory: true } },
            select: { productId: true, locationId: true, type: true, quantity: true, saleReturnId: true },
          }),
      this.costing.currentUnitCosts(organizationId),
      this.prisma.product.findMany({ where: { organizationId, trackInventory: true }, select: { id: true, type: true } }),
      this.prisma.location.findMany({ where: { organizationId }, select: { id: true, type: true } }),
    ]);
    const at = new Map<string, number>(); // `${locationId}:${productId}`
    for (const l of levels) at.set(`${l.locationId}:${l.productId}`, (at.get(`${l.locationId}:${l.productId}`) ?? 0) + l.quantity.toNumber());
    for (const m of after) {
      const k = `${m.locationId}:${m.productId}`;
      at.set(k, (at.get(k) ?? 0) - stockEffectOf({ type: m.type, quantity: m.quantity.toNumber(), saleReturnId: m.saleReturnId }));
    }
    const typeOf = new Map(products.map((p) => [p.id, p.type]));
    const workshop = new Set(locations.filter((l) => l.type === "BAKERY_PRODUCTION").map((l) => l.id));
    const partOf = (locationId: string, productId: string) =>
      typeOf.get(productId) === "FINISHED_GOOD" ? "FINISHED" : workshop.has(locationId) ? "WORKSHOP" : "STORE";

    const perProduct = new Map<string, { q: number; parts: Map<string, number> }>();
    for (const [k, q] of at) {
      const [locationId, productId] = k.split(":");
      const entry = perProduct.get(productId) ?? { q: 0, parts: new Map<string, number>() };
      entry.q += q;
      const part = partOf(locationId, productId);
      entry.parts.set(part, (entry.parts.get(part) ?? 0) + q);
      perProduct.set(productId, entry);
    }
    let total = 0;
    const parts = new Map<string, number>([["STORE", 0], ["WORKSHOP", 0], ["FINISHED", 0]]);
    for (const [productId, { q, parts: where }] of perProduct) {
      const unit = costs.get(productId)?.unitCost;
      if (!(q > 0) || unit === undefined) continue;
      const value = round2(q * unit);
      total += value;
      // Shared by positive quantities only; the last part takes the remainder.
      const positive = [...where].filter(([, x]) => x > 0);
      const base = positive.reduce((s, [, x]) => s + x, 0);
      let left = value;
      positive.forEach(([part, x], i) => {
        const share = i === positive.length - 1 ? left : round2((value * x) / base);
        left = round2(left - share);
        parts.set(part, round2((parts.get(part) ?? 0) + share));
      });
    }
    return {
      total: round2(total),
      breakdown: [
        { key: "STORE", label: "Сырьё и материалы на складе", amount: parts.get("STORE")! },
        { key: "WORKSHOP", label: "Незавершённое производство (сырьё в цехе)", amount: parts.get("WORKSHOP")! },
        { key: "FINISHED", label: "Готовая продукция", amount: parts.get("FINISHED")! },
      ],
    };
  }

  // Cost less depreciation, from the register, for assets that had not left yet.
  async fixedAssetsAt(organizationId: string, asOf: Date): Promise<number> {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId },
      include: { depreciation: true },
    });
    let total = 0;
    for (const a of assets) {
      const acquired = a.isOpening || a.acquiredAt <= asOf;
      const gone = a.disposedAt !== null && a.disposedAt <= asOf;
      if (!acquired || gone) continue;
      const accumulated = a.depreciation
        .filter((e) => monthRange(e.year, e.month).end <= asOf)
        .reduce((s, e) => s + e.amount.toNumber(), 0);
      total += a.acquisitionCost.toNumber() - accumulated;
    }
    return round2(total);
  }
}
