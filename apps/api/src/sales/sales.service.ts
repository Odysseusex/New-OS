import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CashAccountType,
  CashMovementDto,
  CashMovementType,
  PaymentMethod,
  PaymentStatus,
  SaleDetailDto,
  SaleDto,
  SalesDemandAnalysisDto,
  SalesDemandByCustomerRowDto,
  SalesDemandByProductRowDto,
  SalesDemandSummaryDto,
  SalesCustomerTrendDto,
  SalesCustomerTrendPointDto,
  SalesReportDto,
  SalesSummaryDto,
  Unit,
  FiscalReceiptStatus as FiscalReceiptStatusDto,
} from "@bakery-os/shared";
import { FiscalReceipt, FiscalReceiptStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { deltaPct, previousRangeOf } from "../common/period-range";
import { CashMovementsService } from "../finance/cash-movements.service";
import { buildFiscalSaleRequest, FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { CreateSaleDto } from "./dto/create-sale.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";

// Calendar days in reports are the owner's days, not the server's. Render runs
// in UTC, so without this an early-morning delivery in Almaty (UTC+5) would be
// charted on the previous day. Invisible in a monthly total, obvious the moment
// the same data is plotted per day.
const REPORTING_TIME_ZONE = "Asia/Almaty";

const SALE_INCLUDE = { location: true, customer: true, createdBy: true, items: true };
const SALE_DETAIL_INCLUDE = {
  location: true,
  customer: true,
  createdBy: true,
  items: { include: { product: true } },
  // So a receipt number stays findable later, not just in the seconds after
  // payment — the buyer may come back with a question about it.
  fiscalReceipt: true,
};

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private cashMovementsService: CashMovementsService,
    private fiscalService: FiscalService,
    private fiscalSettings: FiscalSettings,
  ) {}

  // CASH sales land in the selling location's own till, auto-created the
  // first time it's needed so a cashier never has to set up accounting
  // before ringing up a sale. CARD/TRANSFER land in the organization's
  // default bank account; if none is configured yet, the sale still
  // succeeds — the cash ledger is additive, never a gate on selling — it
  // just doesn't gain a CashMovement for that receipt.
  private async resolveSaleAccountId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    locationId: string,
    paymentMethod: PaymentMethod,
  ): Promise<string | null> {
    if (paymentMethod === PaymentMethod.CASH) {
      const existing = await tx.cashAccount.findFirst({
        where: { organizationId, locationId, type: CashAccountType.CASH },
      });
      if (existing) return existing.id;

      const location = await tx.location.findUnique({ where: { id: locationId } });
      const created = await tx.cashAccount.create({
        data: {
          organizationId,
          name: `Касса «${location?.name ?? "точка"}»`,
          type: CashAccountType.CASH,
          locationId,
        },
      });
      return created.id;
    }

    const bank = await tx.cashAccount.findFirst({
      where: { organizationId, type: CashAccountType.BANK, isDefault: true, isActive: true },
    });
    return bank?.id ?? null;
  }

  async findAll(
    user: AuthenticatedUser,
    requestedLocationId?: string,
    limit = 50,
    offset = 0,
  ): Promise<SaleDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: SALE_INCLUDE,
      orderBy: { soldAt: "desc" },
      skip: offset,
      take: limit,
    });

    return sales.map(this.toSaleDto);
  }

  async summary(user: AuthenticatedUser, requestedLocationId?: string): Promise<SalesSummaryDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const baseWhere = {
      organizationId: user.organizationId,
      ...(locationId ? { locationId } : {}),
    };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [todaySales, last7DaysSales] = await Promise.all([
      this.prisma.sale.findMany({ where: { ...baseWhere, soldAt: { gte: startOfToday } } }),
      this.prisma.sale.findMany({ where: { ...baseWhere, soldAt: { gte: sevenDaysAgo } } }),
    ]);

    const todayRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    const last7DaysRevenue = last7DaysSales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    const averageTicket = last7DaysSales.length > 0 ? last7DaysRevenue / last7DaysSales.length : 0;

    return {
      todayRevenue,
      todaySalesCount: todaySales.length,
      last7DaysRevenue,
      averageTicket,
    };
  }

  async report(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<SalesReportDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        soldAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, items: { include: { product: true } } },
    });

    const byLocationMap = new Map<string, { locationName: string; revenue: number; count: number }>();
    const byProductMap = new Map<string, { productName: string; quantity: number; revenue: number }>();
    let totalRevenue = 0;

    for (const sale of sales) {
      const revenue = sale.totalAmount.toNumber();
      totalRevenue += revenue;

      const locationEntry = byLocationMap.get(sale.locationId) ?? {
        locationName: sale.location.name,
        revenue: 0,
        count: 0,
      };
      locationEntry.revenue += revenue;
      locationEntry.count += 1;
      byLocationMap.set(sale.locationId, locationEntry);

      for (const item of sale.items) {
        const productEntry = byProductMap.get(item.productId) ?? {
          productName: item.product.name,
          quantity: 0,
          revenue: 0,
        };
        productEntry.quantity += item.quantity.toNumber();
        productEntry.revenue += item.subtotal.toNumber();
        byProductMap.set(item.productId, productEntry);
      }
    }

    const byLocation = Array.from(byLocationMap.entries())
      .map(([locationId, v]) => ({ locationId, locationName: v.locationName, revenue: v.revenue, count: v.count }))
      .sort((a, b) => b.revenue - a.revenue);

    const byProduct = Array.from(byProductMap.entries())
      .map(([productId, v]) => ({ productId, productName: v.productName, quantity: v.quantity, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalRevenue,
      totalCount: sales.length,
      byLocation,
      byProduct,
    };
  }

  // Average sales volume by product and by customer — "how much of this do
  // we sell, and to whom" for production/demand planning. Deliberately
  // reuses the same Sale/SaleItem rows report() reads (a Sale row IS a
  // completed transaction regardless of amountPaid — see the schema
  // comment on Sale.amountPaid), so payment status never moves this number.
  async demandAnalysis(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    opts: { locationId?: string; customerId?: string; categoryId?: string; productId?: string },
  ): Promise<SalesDemandAnalysisDto> {
    const locationId = resolveLocationScope(user, opts.locationId);

    if (opts.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: opts.customerId, organizationId: user.organizationId },
      });
      if (!customer) {
        throw new NotFoundException("Клиент не найден");
      }
    }
    if (opts.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: opts.productId, organizationId: user.organizationId },
      });
      if (!product) {
        throw new NotFoundException("Товар не найден");
      }
    }
    if (opts.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: opts.categoryId, organizationId: user.organizationId },
      });
      if (!category) {
        throw new NotFoundException("Категория не найдена");
      }
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        soldAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
      },
      include: { customer: true, items: { include: { product: true } } },
    });

    type Agg = { quantity: number; revenue: number; saleIds: Set<string> };
    const byProductAgg = new Map<string, Agg & { productName: string }>();
    // Keyed by customerId, or RETAIL_KEY for walk-in sales with no linked
    // Customer — kept in the same breakdown so summary.quantity always
    // reconciles with the sum of byCustomer rows.
    const RETAIL_KEY = "__retail__";
    const byCustomerAgg = new Map<string, Agg & { customerName: string }>();
    let totalQuantity = 0;
    let totalRevenue = 0;
    // Distinct sales with at least one item matching the product/category
    // filter — never a sum of per-product sale counts, which would count a
    // multi-item order more than once.
    const overallSaleIds = new Set<string>();

    for (const sale of sales) {
      const customerKey = sale.customerId ?? RETAIL_KEY;
      const customerName = sale.customer?.name ?? "Розница";

      for (const item of sale.items) {
        if (opts.productId && item.productId !== opts.productId) continue;
        if (opts.categoryId && item.product.categoryId !== opts.categoryId) continue;

        const quantity = item.quantity.toNumber();
        const revenue = item.subtotal.toNumber();

        totalQuantity += quantity;
        totalRevenue += revenue;
        overallSaleIds.add(sale.id);

        const productEntry = byProductAgg.get(item.productId) ?? {
          quantity: 0,
          revenue: 0,
          saleIds: new Set<string>(),
          productName: item.product.name,
        };
        productEntry.quantity += quantity;
        productEntry.revenue += revenue;
        productEntry.saleIds.add(sale.id);
        byProductAgg.set(item.productId, productEntry);

        const customerEntry = byCustomerAgg.get(customerKey) ?? {
          quantity: 0,
          revenue: 0,
          saleIds: new Set<string>(),
          customerName,
        };
        customerEntry.quantity += quantity;
        customerEntry.revenue += revenue;
        customerEntry.saleIds.add(sale.id);
        byCustomerAgg.set(customerKey, customerEntry);
      }
    }

    const completedDays = this.completedDaysInPeriod(from, to);
    const avgPerDay = (quantity: number) => (completedDays > 0 ? quantity / completedDays : null);
    const avgPerSale = (quantity: number, count: number) => (count > 0 ? quantity / count : null);

    const byProduct: SalesDemandByProductRowDto[] = Array.from(byProductAgg.entries())
      .map(([productId, v]) => ({
        productId,
        productName: v.productName,
        quantity: v.quantity,
        salesCount: v.saleIds.size,
        avgPerDay: avgPerDay(v.quantity),
        avgPerSale: avgPerSale(v.quantity, v.saleIds.size),
        revenue: v.revenue,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    const byCustomer: SalesDemandByCustomerRowDto[] = Array.from(byCustomerAgg.entries())
      .map(([key, v]) => ({
        customerId: key === RETAIL_KEY ? null : key,
        customerName: v.customerName,
        quantity: v.quantity,
        salesCount: v.saleIds.size,
        avgPerDay: avgPerDay(v.quantity),
        avgPerSale: avgPerSale(v.quantity, v.saleIds.size),
        revenue: v.revenue,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    const overallSalesCount = overallSaleIds.size;
    const summary: SalesDemandSummaryDto = {
      quantity: totalQuantity,
      salesCount: overallSalesCount,
      revenue: totalRevenue,
      avgPerDay: avgPerDay(totalQuantity),
      avgPerSale: avgPerSale(totalQuantity, overallSalesCount),
      avgRevenuePerDay: avgPerDay(totalRevenue),
    };

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      completedDays,
      summary,
      byProduct,
      byCustomer,
    };
  }

  // A day counts toward the average only once it's fully over. If the
  // period's last calendar day is today, it's excluded from the
  // denominator (its quantity still counts in the totals above) so an
  // in-progress day never silently drags the average down. A period that
  // doesn't reach today is unaffected — no exclusion applied.
  private completedDaysInPeriod(from: Date, to: Date): number {
    const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const fromDate = dateOnly(from);
    const toDate = dateOnly(to);
    const totalDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    const includesToday = toDate.getTime() === dateOnly(new Date()).getTime();
    return Math.max(0, includesToday ? totalDays - 1 : totalDays);
  }

  // Day-by-day volume shipped to ONE customer, for the sales-dynamics chart.
  //
  // This answers "сколько нашей продукции мы отгрузили клиенту" — it is not,
  // and cannot be, what that customer then resold to their own end buyers:
  // ArAmir OS has no visibility into a customer's own till. A Sale carries
  // both `locationId` (our point that shipped it) and `customerId` (who
  // received it), and only the latter is filtered on here.
  //
  // Money figures are shipped value (Σ SaleItem.subtotal, the same basis
  // demandAnalysis uses), NOT cash collected — an unpaid order still counts
  // the day it left us. Cash actually received lives in CashMovement.
  async customerTrend(
    user: AuthenticatedUser,
    customerId: string,
    from: Date,
    to: Date,
    opts: { locationId?: string } = {},
  ): Promise<SalesCustomerTrendDto> {
    const locationId = resolveLocationScope(user, opts.locationId);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
    });
    if (!customer) {
      throw new NotFoundException("Клиент не найден");
    }

    const previous = previousRangeOf({ from, to });

    // Both windows in one round trip — they're aggregated separately below.
    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        customerId,
        soldAt: { gte: previous.from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      include: { items: { include: { product: true } } },
    });

    const units = new Set<Unit>();
    let previousQuantity = 0;
    let previousRevenue = 0;

    // Keyed by Almaty calendar date, so a 01:00 delivery belongs to the day
    // the owner would call it — not to the previous UTC day the server is in.
    const byDate = new Map<string, { quantity: number; revenue: number; saleIds: Set<string> }>();

    for (const sale of sales) {
      const isCurrent = sale.soldAt >= from;
      const dateKey = isCurrent ? this.zonedDateKey(sale.soldAt) : null;

      for (const item of sale.items) {
        const quantity = item.quantity.toNumber();
        const revenue = item.subtotal.toNumber();

        if (!isCurrent) {
          previousQuantity += quantity;
          previousRevenue += revenue;
          continue;
        }

        units.add(item.product.unit as Unit);
        const entry = byDate.get(dateKey!) ?? { quantity: 0, revenue: 0, saleIds: new Set<string>() };
        entry.quantity += quantity;
        entry.revenue += revenue;
        entry.saleIds.add(sale.id);
        byDate.set(dateKey!, entry);
      }
    }

    // Every day in the range gets a point, including the empty ones: a gap in
    // the line would read as "нет данных" when it means "не отгружали".
    const points: SalesCustomerTrendPointDto[] = this.zonedDateKeysBetween(from, to).map((date) => {
      const entry = byDate.get(date);
      return {
        date,
        quantity: entry?.quantity ?? 0,
        revenue: entry?.revenue ?? 0,
        salesCount: entry?.saleIds.size ?? 0,
      };
    });

    const totalQuantity = points.reduce((sum, p) => sum + p.quantity, 0);
    const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
    const salesCount = points.reduce((sum, p) => sum + p.salesCount, 0);

    // Only days that actually had a shipment compete for best/worst — with
    // the zero-filled days in the running, "худший день" would almost always
    // be some idle day at 0, which the chart already shows anyway.
    const activeDays = points.filter((p) => p.salesCount > 0);
    const sortedByQuantity = [...activeDays].sort((a, b) => a.quantity - b.quantity);
    const extreme = (p?: SalesCustomerTrendPointDto) =>
      p ? { date: p.date, quantity: p.quantity, revenue: p.revenue } : null;

    // Same "today doesn't count yet" rule as demandAnalysis, so the two cards
    // on this tab can't disagree about what an average day is.
    const todayKey = this.zonedDateKey(new Date());
    const completedDays = points.filter((p) => p.date !== todayKey).length;
    const perDay = (total: number) => (completedDays > 0 ? total / completedDays : null);

    return {
      customerId,
      customerName: customer.name,
      from: from.toISOString(),
      to: to.toISOString(),
      timeZone: REPORTING_TIME_ZONE,
      points,
      totalQuantity,
      totalRevenue,
      salesCount,
      completedDays,
      avgQuantityPerDay: perDay(totalQuantity),
      avgRevenuePerDay: perDay(totalRevenue),
      bestDay: extreme(sortedByQuantity[sortedByQuantity.length - 1]),
      worstDay: extreme(sortedByQuantity[0]),
      units: Array.from(units),
      previous: {
        from: previous.from.toISOString(),
        to: previous.to.toISOString(),
        quantity: previousQuantity,
        revenue: previousRevenue,
        quantityDeltaPct: deltaPct(totalQuantity, previousQuantity),
        revenueDeltaPct: deltaPct(totalRevenue, previousRevenue),
      },
    };
  }

  // "YYYY-MM-DD" as it reads on a wall clock in REPORTING_TIME_ZONE. en-CA
  // formats as ISO, and Intl resolves the zone's real offset rather than
  // hardcoding +5, so this stays correct if the rules ever change.
  private zonedDateKey(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORTING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  // Inclusive list of calendar dates between two instants. Stepping happens in
  // UTC on plain calendar dates (never on the zoned instants), so a day can be
  // neither skipped nor repeated around an offset change.
  private zonedDateKeysBetween(from: Date, to: Date): string[] {
    const parse = (key: string) => {
      const [y, m, d] = key.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    const endMs = parse(this.zonedDateKey(to));
    const keys: string[] = [];
    for (let ms = parse(this.zonedDateKey(from)); ms <= endMs; ms += 86_400_000) {
      keys.push(new Date(ms).toISOString().slice(0, 10));
    }
    return keys;
  }

  async findOne(user: AuthenticatedUser, saleId: string): Promise<SaleDetailDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
      include: SALE_DETAIL_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException("Продажа не найдена");
    }
    resolveLocationScope(user, sale.locationId);
    return this.toSaleDetailDto(sale);
  }

  async create(user: AuthenticatedUser, dto: CreateSaleDto): Promise<SaleDetailDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId: user.organizationId },
      });
      if (!customer) {
        throw new NotFoundException("Клиент не найден");
      }
    }

    const productIds = dto.items.map((i) => i.productId);
    const items = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
    }));
    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

    // Walk-in retail sales are always settled immediately. Only a sale tied
    // to a customer account can be placed on credit (partially or fully).
    const amountPaid = dto.customerId ? Math.min(dto.amountPaid ?? 0, totalAmount) : totalAmount;
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    // --- Fiscalisation, when switched on ---------------------------------
    //
    // The receipt is punched BEFORE anything is written. The alternative —
    // record the sale, then fiscalise — would mean a Sale row can exist that
    // isn't a real sale yet, and every revenue query in the app would have to
    // learn to exclude it. This way the rule stays simple: a Sale in the
    // database is a completed sale, always.
    //
    // The cost is a narrow window where a receipt is punched but the sale
    // then fails to record. That leaves a registered receipt with no saleId,
    // which needsAttention() surfaces on purpose rather than hiding.
    const soldAt = new Date();
    const receipt = this.fiscalSettings.isEnabled()
      ? await this.fiscalizeBeforeSale(user, locationId, items, totalAmount, paymentMethod, soldAt)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId: user.organizationId },
      });
      if (products.length !== new Set(productIds).size) {
        throw new BadRequestException("Один или несколько товаров не найдены");
      }

      const stockLevels = await tx.stockLevel.findMany({
        where: { locationId, productId: { in: productIds } },
      });
      const stockByProduct = new Map(stockLevels.map((s) => [s.productId, s.quantity.toNumber()]));
      const trackedById = new Map(products.map((p) => [p.id, p.trackInventory]));
      // A product opted out of stock tracking has no StockLevel row to check
      // or decrement — selling one must not look like selling out of stock.
      // This is what lets the till's «Произвольная сумма» line work at all.
      const stockedItems = items.filter((item) => trackedById.get(item.productId));

      for (const item of stockedItems) {
        const available = stockByProduct.get(item.productId) ?? 0;
        if (available < item.quantity) {
          const product = products.find((p) => p.id === item.productId);
          throw new BadRequestException(
            `Недостаточно товара «${product?.name ?? item.productId}» на складе точки`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          organizationId: user.organizationId,
          locationId,
          customerId: dto.customerId,
          totalAmount,
          amountPaid,
          paymentMethod,
          createdById: user.id,
          items: { create: items },
          // Stamped explicitly only when a receipt was punched, so the sale
          // and the fiscal document carry the same moment. Otherwise the
          // column default stands, exactly as before.
          ...(receipt ? { soldAt } : {}),
        },
        include: SALE_DETAIL_INCLUDE,
      });

      if (receipt) {
        await this.fiscalService.linkSale(tx, receipt.id, sale.id);
      }

      if (amountPaid > 0) {
        const accountId = await this.resolveSaleAccountId(tx, user.organizationId, locationId, paymentMethod);
        if (accountId) {
          await this.cashMovementsService.recordMovement(tx, {
            organizationId: user.organizationId,
            accountId,
            type: CashMovementType.SALE_RECEIPT,
            amount: amountPaid,
            customerId: dto.customerId,
            saleId: sale.id,
            reason: "Продажа",
            createdById: user.id,
          });
        }
      }

      for (const item of stockedItems) {
        await tx.stockLevel.update({
          where: { locationId_productId: { locationId, productId: item.productId } },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      await tx.stockMovement.createMany({
        data: stockedItems.map((item) => ({
          organizationId: user.organizationId,
          locationId,
          productId: item.productId,
          type: StockMovementType.SALE,
          quantity: item.quantity,
          reason: "Продажа",
          saleId: sale.id,
          createdById: user.id,
        })),
      });

      // The receipt is attached by hand rather than read back: it was linked
      // to this sale a moment ago, after `sale` was loaded, so the included
      // relation on that object is still null.
      return this.toSaleDetailDto({ ...sale, fiscalReceipt: receipt });
    });
  }

  // Punches the fiscal receipt for a cart that has not been sold yet, and
  // returns it only if the operator registered it. Every other outcome throws
  // in Russian, before a single row of the sale is written.
  private async fiscalizeBeforeSale(
    user: AuthenticatedUser,
    locationId: string,
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number }[],
    totalAmount: number,
    paymentMethod: PaymentMethod,
    soldAt: Date,
  ): Promise<FiscalReceipt> {
    const productIds = items.map((i) => i.productId);
    const [products, location, stockLevels] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, organizationId: user.organizationId },
      }),
      this.prisma.location.findUnique({ where: { id: locationId } }),
      this.prisma.stockLevel.findMany({ where: { locationId, productId: { in: productIds } } }),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    if (productById.size !== new Set(productIds).size) {
      throw new BadRequestException("Один или несколько товаров не найдены");
    }
    if (!location) {
      throw new NotFoundException("Точка продаж не найдена");
    }

    // The transaction below checks stock again; this earlier check exists so
    // we never punch a legally binding receipt for goods the system says we
    // do not have. Products opted out of stock tracking are skipped — there
    // is no stock to be short of.
    const stockByProduct = new Map(stockLevels.map((s) => [s.productId, s.quantity.toNumber()]));
    for (const item of items) {
      if (!productById.get(item.productId)?.trackInventory) continue;
      if ((stockByProduct.get(item.productId) ?? 0) < item.quantity) {
        const name = productById.get(item.productId)?.name ?? item.productId;
        throw new BadRequestException(`Недостаточно товара «${name}» на складе точки`);
      }
    }

    const draft = buildFiscalSaleRequest({
      occurredAt: soldAt,
      paymentMethod,
      location: { name: location.name, lat: location.lat, lng: location.lng },
      total: totalAmount,
      lines: items.map((item) => {
        const product = productById.get(item.productId)!;
        return {
          product: { name: product.name, unit: product.unit, ntin: product.ntin },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        };
      }),
    });

    const prepared = await this.fiscalService.prepare(user.organizationId, draft);
    const receipt = await this.fiscalService.attempt(prepared.id);

    if (receipt.status === FiscalReceiptStatus.REGISTERED) {
      return receipt;
    }

    if (receipt.status === FiscalReceiptStatus.UNKNOWN) {
      // We genuinely do not know whether a receipt exists. Ringing the same
      // cart up again could punch a second one, so the cashier is told to
      // check rather than simply invited to retry.
      throw new BadRequestException(
        "Связь с кассой прервана — не удалось подтвердить чек. Продажа не проведена. " +
          "Не пробивайте заново: сначала проверьте раздел «Требует внимания».",
      );
    }

    throw new BadRequestException(
      `Чек не пробит: ${receipt.errorMessage ?? "касса отклонила чек"}. Продажа не проведена.`,
    );
  }

  async recordPayment(user: AuthenticatedUser, saleId: string, dto: RecordPaymentDto): Promise<SaleDetailDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
    });
    if (!sale) {
      throw new NotFoundException("Продажа не найдена");
    }
    resolveLocationScope(user, sale.locationId);

    const balanceDue = sale.totalAmount.toNumber() - sale.amountPaid.toNumber();
    if (dto.amount > balanceDue) {
      throw new BadRequestException("Сумма оплаты превышает остаток задолженности");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const accountId =
        dto.accountId ??
        (await this.resolveSaleAccountId(
          tx,
          user.organizationId,
          sale.locationId,
          sale.paymentMethod as PaymentMethod,
        ));
      if (accountId) {
        await this.cashMovementsService.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId,
          type: CashMovementType.CUSTOMER_PAYMENT,
          amount: dto.amount,
          customerId: sale.customerId ?? undefined,
          saleId: sale.id,
          reason: dto.reason || "Погашение долга по продаже",
          createdById: user.id,
        });
      }
      return tx.sale.update({
        where: { id: saleId },
        data: { amountPaid: { increment: dto.amount } },
        include: SALE_DETAIL_INCLUDE,
      });
    });

    return this.toSaleDetailDto(updated);
  }

  // Payment history for one sale — every CashMovement tagged with this
  // saleId, i.e. the receipt taken at sale time (SALE_RECEIPT, if any) plus
  // every later CUSTOMER_PAYMENT against it. Open to any authenticated role
  // that can see the sale itself (see findOne) rather than gated behind
  // FINANCE_VIEW_ROLES, since this is sale-scoped data, not the org ledger.
  async paymentsForSale(user: AuthenticatedUser, saleId: string): Promise<CashMovementDto[]> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
    });
    if (!sale) {
      throw new NotFoundException("Продажа не найдена");
    }
    resolveLocationScope(user, sale.locationId);
    return this.cashMovementsService.findAll(user.organizationId, { saleId });
  }

  private toSaleDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    customerId: string | null;
    customer: { name: string } | null;
    soldAt: Date;
    totalAmount: { toNumber: () => number };
    amountPaid: { toNumber: () => number };
    paymentMethod: string;
    createdBy: { fullName: string };
    items: unknown[];
  }): SaleDto => {
    const totalAmount = sale.totalAmount.toNumber();
    const amountPaid = sale.amountPaid.toNumber();
    const balanceDue = totalAmount - amountPaid;

    return {
      id: sale.id,
      locationId: sale.locationId,
      locationName: sale.location.name,
      customerId: sale.customerId,
      customerName: sale.customer?.name ?? null,
      soldAt: sale.soldAt.toISOString(),
      totalAmount,
      amountPaid,
      balanceDue,
      paymentStatus:
        balanceDue <= 0 ? PaymentStatus.PAID : amountPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID,
      paymentMethod: sale.paymentMethod as PaymentMethod,
      itemsCount: sale.items.length,
      createdByName: sale.createdBy.fullName,
    };
  };

  private toSaleDetailDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    customerId: string | null;
    customer: { name: string } | null;
    soldAt: Date;
    totalAmount: { toNumber: () => number };
    amountPaid: { toNumber: () => number };
    paymentMethod: string;
    createdBy: { fullName: string };
    items: {
      id: string;
      productId: string;
      product: { name: string };
      quantity: { toNumber: () => number };
      unitPrice: { toNumber: () => number };
      subtotal: { toNumber: () => number };
    }[];
    fiscalReceipt?: {
      status: string;
      ticketNumber: string | null;
      offlineTicketNumber: string | null;
      qrCode: string | null;
      isOffline: boolean;
    } | null;
  }): SaleDetailDto => ({
    ...this.toSaleDto(sale),
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity.toNumber(),
      unitPrice: item.unitPrice.toNumber(),
      subtotal: item.subtotal.toNumber(),
    })),
    fiscalReceipt: sale.fiscalReceipt
      ? {
          status: sale.fiscalReceipt.status as FiscalReceiptStatusDto,
          // An offline receipt has no fiscal number yet — its own offline
          // number is what identifies it until it syncs, so show that
          // rather than nothing.
          ticketNumber: sale.fiscalReceipt.ticketNumber ?? sale.fiscalReceipt.offlineTicketNumber,
          qrCode: sale.fiscalReceipt.qrCode,
          isOffline: sale.fiscalReceipt.isOffline,
        }
      : null,
  });
}
