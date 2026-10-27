import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import {
  BalanceTreatment,
  CashActivity,
  CashAccountType,
  CostBehavior,
  DemoCompanyCredentialsDto,
  DemoCompanyStatusDto,
  DepreciationMethod,
  FinanceCategoryKind,
  markdownPrice,
  PaymentMethod,
  PnlTreatment,
  ProductType,
  Role,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { destroyOrganization } from "../common/destroy-organization";
import { startOfZonedDay } from "../common/zoned-day";
import { CashMovementsService } from "../finance/cash-movements.service";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { FinanceService } from "../finance/finance.service";
import { FinanceSetupService } from "../finance/finance-setup.service";
import { CostingService } from "../costing/costing.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { PromotionsService } from "../promotions/promotions.service";
import { SalesService } from "../sales/sales.service";
import { SaleReturnsService } from "../sales/sale-returns.service";
import { InventoryService } from "../inventory/inventory.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ProductionService } from "../production/production.service";
import { ConsignmentService } from "../consignment/consignment.service";
import { FixedAssetsService } from "../fixed-assets/fixed-assets.service";
import {
  DEMO_CONSIGNMENT,
  DEMO_CONSIGNMENT_SUPPLIER,
  DEMO_CUSTOMERS,
  DEMO_EMPLOYEES,
  DEMO_FINISHED,
  DEMO_INTERNET,
  DEMO_MARKETING,
  DEMO_MIXER_COST,
  DEMO_OPENING_BANK,
  DEMO_OPENING_TILL,
  DEMO_OVEN_COST,
  DEMO_RAW,
  DEMO_RENT,
  DEMO_STORES,
  DEMO_SUPPLIERS,
  DEMO_UTILITIES,
  ProductKey,
  RawKey,
  SupplierKey,
} from "./demo-catalog";

// «Песочница»: a separate demo company with ~two months of invented history,
// for someone to explore the platform without seeing the real books.
//
// Everything is written through the ordinary services — purchase orders,
// production batches, sales, returns, expenses, payments — so the P&L, ДДС,
// balance, break-even and every report agree exactly as they do for a real
// company. Those services stamp "now"; after each simulated day the SQL
// function demo_shift_since (migration 20261027120000) moves that day's rows
// back to the date they stand for, and sales are then spread over the shop's
// opening hours.
//
// Safety: the sandbox is its own organization (demoParentId = the owner's), so
// nothing in it can read or touch the real one. Its login is a «Бухгалтер»
// (never OWNER — the owner can download the WHOLE database). Fiscalisation is
// switched off for it regardless of the environment. Deleting only ever
// touches an organization whose demoParentId is the caller's own organization.

const DEMO_NAME = "Пекарня «Демо»";
// Shop hours for spreading the day's checks: 08:00–20:00 Almaty.
const ANCHOR_HOUR = 7;

interface Progress {
  done: number;
  total: number;
  error: string | null;
  periodFrom: string;
  periodTo: string;
}

class SandboxFiscalSettings extends FiscalSettings {
  isEnabled(): boolean {
    return false;
  }
}

// A seeded generator so two sandboxes made on the same day look alike.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATE_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" });
const dateKeyOf = (at: Date) => DATE_KEY.format(at);
const addDays = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
// Midnight in Almaty of a "YYYY-MM-DD".
const midnightOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return startOfZonedDay(new Date(Date.UTC(y, m - 1, d, 12)));
};
const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const lastDayOfMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newPassword = () => Array.from({ length: 10 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");

@Injectable()
export class DemoCompanyService {
  private readonly logger = new Logger(DemoCompanyService.name);
  // One sandbox is generated at a time, whoever asks — it is a heavy job on the
  // same database the shops are selling through.
  private static running: { parentId: string; progress: Progress } | null = null;
  private static failures = new Map<string, Progress>();
  // The generation in flight, for whoever must wait for it (the specs).
  static finished: Promise<void> = Promise.resolve();

  constructor(private prisma: PrismaService) {}

  private async demoOf(parentId: string) {
    return this.prisma.organization.findUnique({ where: { demoParentId: parentId } });
  }

  private async assertRealOrganization(user: AuthenticatedUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.demoParentId) throw new BadRequestException("Песочницу нельзя создать внутри песочницы");
  }

  async status(user: AuthenticatedUser): Promise<DemoCompanyStatusDto> {
    const demo = await this.demoOf(user.organizationId);
    const running = DemoCompanyService.running?.parentId === user.organizationId ? DemoCompanyService.running.progress : null;
    const failed = DemoCompanyService.failures.get(user.organizationId) ?? null;
    if (!demo) {
      return { state: "NONE", name: null, email: null, progress: null, periodFrom: null, periodTo: null, error: failed?.error ?? null };
    }
    const login = await this.prisma.user.findFirst({ where: { organizationId: demo.id, role: Role.ACCOUNTANT }, orderBy: { createdAt: "asc" } });
    const progress = running ?? failed;
    // Once ready, the period is read from the sales themselves (the progress
    // is gone after a restart).
    const span = demo.demoReadyAt
      ? await this.prisma.sale.aggregate({ where: { organizationId: demo.id }, _min: { soldAt: true }, _max: { soldAt: true } })
      : null;
    return {
      state: demo.demoReadyAt ? "READY" : running ? "GENERATING" : failed ? "FAILED" : "INTERRUPTED",
      name: demo.name,
      email: login?.email ?? null,
      progress: progress ? { done: progress.done, total: progress.total } : null,
      periodFrom: span?._min.soldAt ? dateKeyOf(span._min.soldAt) : (progress?.periodFrom ?? null),
      periodTo: span?._max.soldAt ? dateKeyOf(span._max.soldAt) : (progress?.periodTo ?? null),
      error: failed?.error ?? null,
    };
  }

  // Creates the company and its login straight away, then fills in the history
  // in the background (the screen polls status()). The login stays switched off
  // until the history is complete.
  async create(user: AuthenticatedUser): Promise<DemoCompanyCredentialsDto> {
    // From the first day of last month to yesterday: one whole month to close
    // and compare, and the current one so far.
    const today = dateKeyOf(new Date());
    const [y, m] = today.split("-").map(Number);
    const periodFrom = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    return this.start(user, periodFrom, addDays(today, -1));
  }

  // The generation itself, for a stated period (the specs use a few days).
  // Resolves once the company and its login exist; the history follows.
  async start(user: AuthenticatedUser, periodFrom: string, periodTo: string): Promise<DemoCompanyCredentialsDto> {
    await this.assertRealOrganization(user);
    if (await this.demoOf(user.organizationId)) throw new ConflictException("Песочница уже есть — удалите её, чтобы создать новую");
    if (DemoCompanyService.running) throw new ConflictException("Песочница уже создаётся — подождите несколько минут");

    const days: string[] = [];
    for (let d = periodFrom; d <= periodTo; d = addDays(d, 1)) days.push(d);

    const progress: Progress = { done: 0, total: days.length + 1, error: null, periodFrom, periodTo };
    DemoCompanyService.running = { parentId: user.organizationId, progress };
    DemoCompanyService.failures.delete(user.organizationId);

    const since = await this.since();
    const password = newPassword();
    const suffix = Array.from({ length: 5 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
    const email = `finance-demo-${suffix}@aramir.demo`;
    let organizationId: string;
    try {
      const org = await this.prisma.organization.create({ data: { name: DEMO_NAME, demoParentId: user.organizationId } });
      organizationId = org.id;
      await this.prisma.user.create({
        data: {
          organizationId,
          fullName: "Финансист (демо)",
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: Role.ACCOUNTANT,
          isActive: false,
        },
      });
    } catch (err) {
      DemoCompanyService.running = null;
      throw err;
    }

    DemoCompanyService.finished = this.generate(user.organizationId, organizationId, since, days, progress).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sandbox generation failed: ${message}`, err instanceof Error ? err.stack : undefined);
      progress.error = message;
      DemoCompanyService.failures.set(user.organizationId, progress);
      DemoCompanyService.running = null;
    });

    return { email, password };
  }

  async resetPassword(user: AuthenticatedUser): Promise<DemoCompanyCredentialsDto> {
    const demo = await this.demoOf(user.organizationId);
    if (!demo) throw new NotFoundException("Песочницы нет");
    const login = await this.prisma.user.findFirst({ where: { organizationId: demo.id, role: Role.ACCOUNTANT }, orderBy: { createdAt: "asc" } });
    if (!login) throw new NotFoundException("Вход в песочницу не найден");
    const password = newPassword();
    await this.prisma.user.update({ where: { id: login.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    return { email: login.email, password };
  }

  async remove(user: AuthenticatedUser): Promise<{ deleted: true }> {
    const demo = await this.demoOf(user.organizationId);
    if (!demo) throw new NotFoundException("Песочницы нет");
    if (DemoCompanyService.running?.parentId === user.organizationId) {
      throw new ConflictException("Песочница ещё создаётся — удалить её можно после окончания");
    }
    // The one place an organization is deleted outside the specs: only ever the
    // sandbox belonging to the caller's own organization, re-checked here.
    if (demo.demoParentId !== user.organizationId || demo.id === user.organizationId) {
      throw new BadRequestException("Это не песочница");
    }
    const leftovers = await destroyOrganization(this.prisma, demo.id);
    DemoCompanyService.failures.delete(user.organizationId);
    if (leftovers.length > 0) {
      this.logger.error(`Sandbox ${demo.id} not fully deleted: ${leftovers.join(", ")}`);
      throw new ConflictException("Песочница удалена не полностью — попробуйте ещё раз");
    }
    return { deleted: true };
  }

  // The earliest instant a row written from now on can carry. Services stamp
  // with both the database clock and the server clock; take the earlier, with
  // a margin — everything older in the sandbox has already been moved months back.
  private async since(): Promise<Date> {
    const [{ now }] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp()::timestamp(3) AS now`;
    return new Date(Math.min(now.getTime(), Date.now()) - 2000);
  }

  private async shiftTo(organizationId: string, since: Date, target: Date) {
    const deltaMs = since.getTime() - target.getTime();
    await this.prisma.$executeRaw`SELECT demo_shift_since(${organizationId}, ${since}::timestamp(3), make_interval(secs => ${deltaMs / 1000}::double precision))`;
  }

  // Moves each sale (and its payments, stock and cash rows) later into the day.
  private async spreadSales(minutesBySale: Map<string, number>) {
    if (minutesBySale.size === 0) return;
    const ids = [...minutesBySale.keys()];
    const mins = ids.map((id) => minutesBySale.get(id)!);
    await this.prisma.$executeRaw`UPDATE "sales" s SET "soldAt" = s."soldAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE s."id" = o.id`;
    await this.prisma.$executeRaw`UPDATE "sale_payments" p SET "createdAt" = p."createdAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE p."saleId" = o.id`;
    await this.prisma.$executeRaw`UPDATE "stock_movements" sm SET "createdAt" = sm."createdAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE sm."saleId" = o.id`;
    await this.prisma.$executeRaw`UPDATE "cash_movements" cm SET "createdAt" = cm."createdAt" + make_interval(mins => o.m), "occurredAt" = cm."occurredAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE cm."saleId" = o.id`;
  }

  private async spreadReturns(minutesByReturn: Map<string, number>) {
    if (minutesByReturn.size === 0) return;
    const ids = [...minutesByReturn.keys()];
    const mins = ids.map((id) => minutesByReturn.get(id)!);
    await this.prisma.$executeRaw`UPDATE "sale_returns" r SET "returnedAt" = r."returnedAt" + make_interval(mins => o.m), "createdAt" = r."createdAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE r."id" = o.id`;
    await this.prisma.$executeRaw`UPDATE "stock_movements" sm SET "createdAt" = sm."createdAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE sm."saleReturnId" = o.id`;
    await this.prisma.$executeRaw`UPDATE "cash_movements" cm SET "createdAt" = cm."createdAt" + make_interval(mins => o.m), "occurredAt" = cm."occurredAt" + make_interval(mins => o.m)
      FROM unnest(${ids}::text[], ${mins}::int[]) AS o(id, m) WHERE cm."saleReturnId" = o.id`;
  }

  private async generate(parentId: string, organizationId: string, setupSince: Date, days: string[], progress: Progress) {
    const started = Date.now();
    const prisma = this.prisma;
    const settings = new SandboxFiscalSettings();
    const cash = new CashMovementsService(prisma);
    const costing = new CostingService(prisma);
    const fiscal = new FiscalService(prisma, new FakeFiscalProvider(), settings);
    const finance = new FinanceService(prisma, cash, costing);
    const svc = {
      cash,
      cashAccounts: new CashAccountsService(prisma),
      finance,
      setup: new FinanceSetupService(prisma, finance),
      sales: new SalesService(prisma, cash, fiscal, settings, new PromotionsService(prisma), costing),
      returns: new SaleReturnsService(prisma, cash, fiscal, settings),
      inventory: new InventoryService(prisma, costing),
      procurement: new ProcurementService(prisma, cash),
      production: new ProductionService(prisma),
      consignment: new ConsignmentService(prisma, cash),
      fixedAssets: new FixedAssetsService(prisma, cash),
    };
    const rand = mulberry32(Number(days[0].replace(/-/g, "")));
    const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
    const chance = (p: number) => rand() < p;

    // ── Setup: the company as it stood the evening before the first day ──────
    const region = await prisma.region.create({ data: { organizationId, name: "Алматы" } });
    const stores = [];
    for (const s of DEMO_STORES) {
      const location = await prisma.location.create({
        data: { organizationId, regionId: region.id, name: s.name, type: "STORE", city: "Алматы", address: s.address, lat: s.lat, lng: s.lng },
      });
      stores.push({ ...s, id: location.id });
    }
    const passwordHash = await bcrypt.hash(newPassword(), 10);
    const director = await prisma.user.create({
      data: { organizationId, fullName: "Ерлан Касымов", email: `director-${organizationId}@aramir.demo`, passwordHash, role: Role.OWNER, title: "Управляющий", isActive: false },
    });
    const directorUser: AuthenticatedUser = {
      id: director.id,
      email: director.email,
      fullName: director.fullName,
      role: Role.OWNER,
      title: director.title,
      organizationId,
      regionId: null,
      locationId: null,
    };
    const cashiers = new Map<string, AuthenticatedUser>();
    for (const [i, s] of stores.entries()) {
      const employee = DEMO_EMPLOYEES.find((e) => e.store === s.key && e.position === "Продавец-кассир")!;
      const u = await prisma.user.create({
        data: { organizationId, locationId: s.id, fullName: employee.name, email: `cashier${i + 1}-${organizationId}@aramir.demo`, passwordHash, role: Role.CASHIER, isActive: false },
      });
      cashiers.set(s.id, { id: u.id, email: u.email, fullName: u.fullName, role: Role.CASHIER, title: null, organizationId, regionId: null, locationId: s.id });
    }

    const category = async (name: string, kind: FinanceCategoryKind, costBehavior: CostBehavior, pnlTreatment: PnlTreatment, cashActivity = CashActivity.OPERATING, balanceTreatment = BalanceTreatment.NONE) =>
      (await prisma.financeCategory.create({ data: { organizationId, name, kind, costBehavior, pnlTreatment, cashActivity, balanceTreatment } })).id;
    const E = FinanceCategoryKind.EXPENSE;
    const cat = {
      rent: await category("Аренда", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE),
      utilities: await category("Коммунальные услуги", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE),
      salary: await category("Зарплата", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE),
      marketing: await category("Маркетинг", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE),
      internet: await category("Связь и интернет", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE),
      packaging: await category("Упаковка", E, CostBehavior.VARIABLE, PnlTreatment.OPERATING_EXPENSE),
      fuel: await category("Логистика", E, CostBehavior.VARIABLE, PnlTreatment.OPERATING_EXPENSE),
      bank: await category("Банковская комиссия", E, CostBehavior.VARIABLE, PnlTreatment.OPERATING_EXPENSE),
      equipment: await category("Оборудование", E, CostBehavior.UNCLASSIFIED, PnlTreatment.NOT_IN_PNL, CashActivity.INVESTING, BalanceTreatment.FIXED_ASSET),
    };
    await category("Прочие расходы", E, CostBehavior.FIXED, PnlTreatment.OPERATING_EXPENSE);
    await category("Прочий доход", FinanceCategoryKind.INCOME, CostBehavior.UNCLASSIFIED, PnlTreatment.OTHER_INCOME);

    const productCategory = async (name: string, type: ProductType) => (await prisma.category.create({ data: { organizationId, name, type } })).id;
    const rawCategory = await productCategory("Сырьё", ProductType.RAW_MATERIAL);
    const finishedCategories = new Map<string, string>();
    for (const name of ["Хлеб", "Выпечка", "Торты", "Фермерские продукты"]) finishedCategories.set(name, await productCategory(name, ProductType.FINISHED_GOOD));

    const suppliers = new Map<SupplierKey, string>();
    for (const s of DEMO_SUPPLIERS) suppliers.set(s.key, (await prisma.supplier.create({ data: { organizationId, name: s.name, phone: s.phone } })).id);
    const consignmentSupplierId = (await prisma.supplier.create({ data: { organizationId, name: DEMO_CONSIGNMENT_SUPPLIER.name, phone: DEMO_CONSIGNMENT_SUPPLIER.phone } })).id;

    let sku = 0;
    const raw = new Map<RawKey, { id: string; price: number; supplier: SupplierKey }>();
    for (const r of DEMO_RAW) {
      const p = await prisma.product.create({
        data: { organizationId, name: r.name, sku: `ING-${String(++sku).padStart(4, "0")}`, unit: r.unit as Unit, type: ProductType.RAW_MATERIAL, categoryId: rawCategory, price: r.price },
      });
      raw.set(r.key, { id: p.id, price: r.price, supplier: r.supplier });
    }
    const finished = new Map<ProductKey, { id: string; recipeId: string; price: number; keepsDays: number; demand: number; yieldQty: number; items: Partial<Record<RawKey, number>> }>();
    for (const f of DEMO_FINISHED) {
      const p = await prisma.product.create({
        data: { organizationId, name: f.name, sku: `PRD-${String(++sku).padStart(4, "0")}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, categoryId: finishedCategories.get(f.category), price: f.price, isPosQuickItem: true },
      });
      const recipe = await prisma.recipe.create({
        data: {
          organizationId,
          productId: p.id,
          yieldQuantity: f.recipe.yield,
          shelfLifeDays: f.keepsDays,
          items: { create: Object.entries(f.recipe.items).map(([k, q]) => ({ ingredientProductId: raw.get(k as RawKey)!.id, quantity: q })) },
        },
      });
      finished.set(f.key, { id: p.id, recipeId: recipe.id, price: f.price, keepsDays: f.keepsDays, demand: f.demand, yieldQty: f.recipe.yield, items: f.recipe.items });
    }
    const consignment = [];
    for (const c of DEMO_CONSIGNMENT) {
      const p = await prisma.product.create({
        data: { organizationId, name: c.name, sku: `PRD-${String(++sku).padStart(4, "0")}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, categoryId: finishedCategories.get("Фермерские продукты"), price: c.price, consignmentSupplierId },
      });
      consignment.push({ id: p.id, price: c.price });
    }

    const customers = new Map<string, { id: string; def: (typeof DEMO_CUSTOMERS)[number] }>();
    for (const c of DEMO_CUSTOMERS) {
      const created = await prisma.customer.create({ data: { organizationId, name: c.name, phone: c.phone, creditLimit: c.creditLimit } });
      customers.set(c.key, { id: created.id, def: c });
    }

    const firstDay = days[0];
    const payroll = DEMO_EMPLOYEES.reduce((sum, e) => sum + e.salary, 0);
    for (const e of DEMO_EMPLOYEES) {
      const locationId = e.store ? stores.find((s) => s.key === e.store)!.id : null;
      const employee = await prisma.employee.create({
        data: { organizationId, locationId, fullName: e.name, position: e.position, hiredAt: midnightOf(addDays(firstDay, -400)), userId: e.position === "Управляющий" ? director.id : undefined },
      });
      await prisma.employeeCompensation.create({
        data: { organizationId, employeeId: employee.id, amount: e.salary, paymentType: "MONTHLY", effectiveFrom: midnightOf(firstDay), createdById: director.id },
      });
    }
    for (const s of stores) {
      await prisma.plannedFixedCost.create({ data: { organizationId, categoryId: cat.rent, locationId: s.id, amount: DEMO_RENT, effectiveFrom: midnightOf(firstDay), createdById: director.id } });
      await prisma.plannedFixedCost.create({ data: { organizationId, categoryId: cat.utilities, locationId: s.id, amount: DEMO_UTILITIES, effectiveFrom: midnightOf(firstDay), createdById: director.id } });
    }
    await prisma.plannedFixedCost.create({ data: { organizationId, categoryId: cat.internet, amount: DEMO_INTERNET, effectiveFrom: midnightOf(firstDay), createdById: director.id } });
    await prisma.plannedFixedCost.create({ data: { organizationId, categoryId: cat.marketing, amount: DEMO_MARKETING, effectiveFrom: midnightOf(firstDay), createdById: director.id } });

    const bank = await svc.cashAccounts.create(directorUser, { name: "Kaspi Business", type: CashAccountType.BANK, isDefault: true, openingBalance: DEMO_OPENING_BANK });
    const tills = new Map<string, string>();
    for (const s of stores) {
      const till = await svc.cashAccounts.create(directorUser, { name: `Касса ${s.name.replace("Пекарня ", "")}`, type: CashAccountType.CASH, locationId: s.id, openingBalance: DEMO_OPENING_TILL });
      tills.set(s.id, till.id);
    }

    // What one store uses of each ingredient on an ordinary day.
    const dailyUse = (storeFactor: number) => {
      const use = new Map<RawKey, number>();
      for (const f of finished.values()) {
        const batches = (f.demand * storeFactor * 1.15) / f.yieldQty;
        for (const [k, q] of Object.entries(f.items)) use.set(k as RawKey, (use.get(k as RawKey) ?? 0) + q! * batches);
      }
      // The first shop also bakes for the wholesale buyers.
      return use;
    };
    const wholesaleUse = (() => {
      const use = new Map<RawKey, number>();
      for (const c of DEMO_CUSTOMERS) {
        for (const [key, qty] of Object.entries(c.lines)) {
          const f = finished.get(key as ProductKey)!;
          const perDay = (qty! * c.days.length) / 7;
          for (const [k, q] of Object.entries(f.items)) use.set(k as RawKey, (use.get(k as RawKey) ?? 0) + (q! * perDay) / f.yieldQty);
        }
      }
      return use;
    })();
    const useOf = (store: (typeof stores)[number]) => {
      const use = dailyUse(store.demandFactor);
      if (store.key === "center") for (const [k, q] of wholesaleUse) use.set(k, (use.get(k) ?? 0) + q);
      return use;
    };

    // Buys enough of every ingredient to last `cover` days; one order per supplier.
    const unpaidOrders: { id: string; amount: number; payOn: string }[] = [];
    const restock = async (store: (typeof stores)[number], cover: number, payOn: string | null) => {
      const use = useOf(store);
      const levels = await prisma.stockLevel.findMany({ where: { organizationId, locationId: store.id } });
      const have = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));
      const bySupplier = new Map<SupplierKey, { productId: string; quantity: number; unitCost: number }[]>();
      for (const [k, perDay] of use) {
        const r = raw.get(k)!;
        const need = perDay * cover - (have.get(r.id) ?? 0);
        if (need <= perDay * 0.5) continue;
        const quantity = r.price < 200 || k === "eggs" ? Math.ceil(need / 10) * 10 : Math.ceil(need);
        const lines = bySupplier.get(r.supplier) ?? [];
        // At the catalogue price: ingredients are costed into production from it,
        // so any other purchase price would leave the balance sheet NOT_BALANCED.
        lines.push({ productId: r.id, quantity, unitCost: r.price });
        bySupplier.set(r.supplier, lines);
      }
      for (const [supplier, items] of bySupplier) {
        const order = await svc.procurement.create(directorUser, { supplierId: suppliers.get(supplier)!, locationId: store.id, items });
        await svc.procurement.receive(directorUser, order.id);
        if (payOn) unpaidOrders.push({ id: order.id, amount: order.totalCost, payOn });
      }
    };

    for (const store of stores) await restock(store, 7, null);
    const center = stores.find((s) => s.key === "center")!;
    for (const c of consignment) await svc.inventory.receive(directorUser, { locationId: center.id, productId: c.id, quantity: 12, reason: "Под реализацию" });

    await svc.setup.complete(directorUser);
    await svc.procurement.activateCutover(directorUser);

    const oven = await svc.fixedAssets.register(directorUser, {
      name: "Печь ротационная",
      locationId: center.id,
      opening: { acquisitionCost: DEMO_OVEN_COST, acquiredAt: midnightOf(addDays(firstDay, -1)).toISOString(), reason: "Куплена до начала учёта" },
    });
    const [fy, fm] = firstDay.split("-").map(Number);
    await svc.fixedAssets.setTerms(directorUser, oven.id, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 84, salvageValue: 200000, startYear: fy, startMonth: fm });

    await this.shiftTo(organizationId, setupSince, new Date(midnightOf(addDays(firstDay, -1)).getTime() + 18 * 3600_000));
    progress.done = 1;

    // ── Day by day ───────────────────────────────────────────────────────────
    const unpaidSales: { id: string; customer: "cafe" | "canteen"; amount: number; day: string }[] = [];
    let cardTurnoverOfMonth = 0;
    const cashierFor = (storeId: string) => cashiers.get(storeId)!;

    for (const [index, day] of days.entries()) {
      const since = await this.since();
      const weekday = weekdayOf(day);
      const dom = Number(day.slice(8, 10));
      const month = MONTHS_RU[Number(day.slice(5, 7)) - 1];
      const saleMinutes = new Map<string, number>();
      const returnMinutes = new Map<string, number>();

      // Morning: last night's leftovers go out, the drawer goes to the bank.
      for (const store of stores) {
        const levels = await prisma.stockLevel.findMany({ where: { organizationId, locationId: store.id, quantity: { gt: 0 } } });
        const lines = [];
        for (const f of finished.values()) {
          const qty = levels.find((l) => l.productId === f.id)?.quantity.toNumber() ?? 0;
          const stale = f.keepsDays > 1 ? Math.max(0, qty - 2) : qty;
          if (stale > 0) lines.push({ productId: f.id, quantity: stale });
        }
        if (lines.length > 0) {
          await svc.inventory.applyBatch(directorUser, "write-off", { locationId: store.id, writeOffReason: WriteOffReason.EXPIRED, reason: "Не продано, вышел срок", lines });
        }
        if (weekday === 1 || weekday === 4) {
          const account = (await svc.cashAccounts.findAll(organizationId)).find((a) => a.id === tills.get(store.id))!;
          const amount = Math.floor((account.currentBalance - DEMO_OPENING_TILL) / 1000) * 1000;
          if (amount > 20000) await svc.cash.transfer(directorUser, { fromAccountId: account.id, toAccountId: bank.id, amount, reason: "Инкассация" });
        }
      }

      // Supplies: every four days per shop, paid a week later.
      for (const [i, store] of stores.entries()) {
        if ((index + i * 2) % 4 === 0) await restock(store, 6, addDays(day, 7));
      }
      for (const order of unpaidOrders.filter((o) => o.payOn === day)) {
        await svc.procurement.recordPayment(directorUser, order.id, { accountId: bank.id, amount: order.amount });
      }
      if (dom === 3) {
        const owed = (await svc.consignment.balances(organizationId)).find((b) => b.supplierId === consignmentSupplierId)?.balance ?? 0;
        if (owed > 0) await svc.consignment.pay(directorUser, { supplierId: consignmentSupplierId, amount: Math.round(owed * 100) / 100, accountId: bank.id, note: "Расчёт за проданное" });
      }
      for (const c of consignment) {
        const level = await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: center.id, productId: c.id } } });
        if ((level?.quantity.toNumber() ?? 0) < 4) await svc.inventory.receive(directorUser, { locationId: center.id, productId: c.id, quantity: 12, reason: "Под реализацию" });
      }

      // Expenses as they fall due.
      const expense = async (categoryId: string, amount: number, description: string, locationId?: string, accountId = bank.id) =>
        svc.finance.createExpense(directorUser, { categoryId, amount: Math.round(amount), description, locationId, paidImmediately: true, accountId });
      if (dom === 1) for (const s of stores) await expense(cat.rent, DEMO_RENT, `Аренда за ${month}`, s.id);
      if (dom === 2 && index > 0 && cardTurnoverOfMonth > 0) {
        await expense(cat.bank, cardTurnoverOfMonth * 0.0095, "Комиссия за эквайринг");
        cardTurnoverOfMonth = 0;
      }
      if (dom === 5) await expense(cat.internet, DEMO_INTERNET, `Интернет и связь, ${month}`);
      if (dom === 7) await expense(cat.marketing, DEMO_MARKETING, "Таргетированная реклама Instagram");
      if (dom === 10) for (const s of stores) await expense(cat.utilities, DEMO_UTILITIES * between(0.85, 1.12), `Коммунальные услуги, ${month}`, s.id);
      if (dom === 15) await expense(cat.salary, payroll * 0.4, `Аванс за ${month}`);
      if (dom === lastDayOfMonth(day)) await expense(cat.salary, payroll * 0.6, `Зарплата за ${month}`);
      if (weekday === 1) {
        await expense(cat.packaging, between(11000, 14000), "Пакеты, коробки для тортов");
        await expense(cat.fuel, between(6000, 8500), "Бензин, доставка оптовикам", center.id, tills.get(center.id));
      }
      if (index === 19) {
        const mixer = await expense(cat.equipment, DEMO_MIXER_COST, "Тестомес спиральный 60 л", center.id);
        const asset = await svc.fixedAssets.register(directorUser, { name: "Тестомес спиральный 60 л", sourceExpenseId: mixer.id, locationId: center.id });
        const [ny, nm] = addDays(day, 31 - dom + 1).split("-").map(Number);
        await svc.fixedAssets.setTerms(directorUser, asset.id, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 60, salvageValue: 30000, startYear: ny, startMonth: nm });
      }

      // Wholesale buyers: paid on Fridays — the canteen stops paying in the last weeks.
      if (weekday === 5) {
        for (const s of [...unpaidSales]) {
          const age = (midnightOf(day).getTime() - midnightOf(s.day).getTime()) / 86400_000;
          const pays = s.customer === "cafe" ? age >= 6 : age >= 13 && index < days.length - 21;
          if (!pays) continue;
          await svc.sales.recordPayment(directorUser, s.id, { amount: s.amount, accountId: bank.id, reason: "Оплата по счёту" });
          unpaidSales.splice(unpaidSales.indexOf(s), 1);
        }
      }

      // Baking and selling — both shops at once (nothing they write is shared
      // but the bank account, which every payment locks on its own).
      const weekdayFactor = weekday === 6 ? 1.25 : weekday === 0 ? 1.15 : weekday === 1 ? 0.9 : 1;
      await Promise.all(stores.map(async (store) => {
        const wholesale = store.key === "center" ? DEMO_CUSTOMERS.filter((c) => c.days.includes(weekday)) : [];
        const demand = new Map<ProductKey, number>();
        for (const [key, f] of finished) demand.set(key, f.demand * store.demandFactor * weekdayFactor * between(0.85, 1.15));

        for (const [key, f] of finished) {
          const forWholesale = wholesale.reduce((sum, c) => sum + (c.lines[key] ?? 0), 0);
          let planned = Math.round(demand.get(key)! * 1.1) + forWholesale;
          if (f.keepsDays > 1) {
            const level = await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: store.id, productId: f.id } } });
            planned = (level?.quantity.toNumber() ?? 0) >= 2 ? 0 : chance(0.6) ? 2 : 1;
          }
          if (planned <= 0) continue;
          const batch = await svc.production.create(directorUser, { locationId: store.id, recipeId: f.recipeId, plannedQuantity: planned });
          await svc.production.start(directorUser, batch.id);
          // Exactly as planned: a yield variance would value the shelf at the
          // recipe cost while the books carry the actual one (NOT_BALANCED).
          const actual = planned;
          try {
            await svc.production.complete(directorUser, batch.id, { actualQuantity: actual });
          } catch {
            // A busier run of days than the order was sized for: an urgent
            // delivery, then bake.
            await restock(store, 4, addDays(day, 7));
            await svc.production.complete(directorUser, batch.id, { actualQuantity: actual });
          }
        }

        const levels = await prisma.stockLevel.findMany({ where: { organizationId, locationId: store.id } });
        const onShelf = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));

        for (const c of wholesale) {
          const customer = customers.get(c.key)!;
          const items = Object.entries(c.lines).map(([key, qty]) => {
            const f = finished.get(key as ProductKey)!;
            onShelf.set(f.id, (onShelf.get(f.id) ?? 0) - qty!);
            return { productId: f.id, quantity: qty!, unitPrice: Math.round(f.price * (1 - c.discount)) };
          });
          const sale = await svc.sales.create(directorUser, { locationId: store.id, customerId: customer.id, amountPaid: 0, paymentMethod: PaymentMethod.TRANSFER, items });
          saleMinutes.set(sale.id, 90);
          unpaidSales.push({ id: sale.id, customer: c.key, amount: sale.totalAmount, day });
        }

        // The day's buyers, until the demand (or the shelf) runs out.
        const pool = new Map<ProductKey, number>();
        for (const [key, f] of finished) {
          const want = f.keepsDays > 1 ? (chance(f.demand * store.demandFactor * weekdayFactor) ? 1 : 0) : Math.round(demand.get(key)!);
          pool.set(key, Math.max(0, Math.min(want, onShelf.get(f.id) ?? 0)));
        }
        const checks: { productId: string; quantity: number; unitPrice: number }[][] = [];
        while ([...pool.values()].some((q) => q > 0)) {
          const lineCount = 1 + Math.floor(rand() * 3);
          const lines: { productId: string; quantity: number; unitPrice: number }[] = [];
          for (let l = 0; l < lineCount; l += 1) {
            const open = [...pool.entries()].filter(([key, q]) => q > 0 && !lines.some((x) => x.productId === finished.get(key)!.id));
            if (open.length === 0) break;
            const total = open.reduce((sum, [, q]) => sum + q, 0);
            let pick = rand() * total;
            const [key, left] = open.find(([, q]) => (pick -= q) < 0) ?? open[open.length - 1];
            const f = finished.get(key)!;
            const quantity = f.keepsDays > 1 ? 1 : Math.min(left, 1 + (chance(0.4) ? 1 : 0) + (chance(0.12) ? 2 : 0));
            pool.set(key, left - quantity);
            lines.push({ productId: f.id, quantity, unitPrice: f.price });
          }
          if (store.key === "center" && chance(0.08)) {
            const c = consignment[Math.floor(rand() * consignment.length)];
            if ((onShelf.get(c.id) ?? 0) > 0) {
              onShelf.set(c.id, onShelf.get(c.id)! - 1);
              lines.push({ productId: c.id, quantity: 1, unitPrice: c.price });
            }
          }
          if (lines.length > 0) checks.push(lines);
        }
        const minutes = checks.map(() => 60 + Math.floor(rand() * 660)).sort((a, b) => a - b);
        const sold: { id: string; method: PaymentMethod; items: { productId: string; quantity: number }[] }[] = [];
        for (const [i, items] of checks.entries()) {
          const method = chance(0.62) ? PaymentMethod.CARD : PaymentMethod.CASH;
          const sale = await svc.sales.create(cashierFor(store.id), { locationId: store.id, paymentMethod: method, items });
          if (method === PaymentMethod.CARD) cardTurnoverOfMonth += sale.totalAmount;
          saleMinutes.set(sale.id, minutes[i]);
          sold.push({ id: sale.id, method, items });
          for (const line of items) onShelf.set(line.productId, (onShelf.get(line.productId) ?? 0) - line.quantity);
        }

        // Evening: half of what is left of the fresh bakes goes at the markdown.
        const markdownLines = [];
        for (const f of finished.values()) {
          if (f.keepsDays > 1) continue;
          const left = onShelf.get(f.id) ?? 0;
          const quantity = Math.floor(left * between(0.3, 0.6));
          if (quantity > 0) markdownLines.push({ productId: f.id, quantity, unitPrice: markdownPrice(f.price), fullUnitPrice: f.price });
        }
        if (markdownLines.length > 0) {
          const sale = await svc.sales.create(cashierFor(store.id), { locationId: store.id, paymentMethod: PaymentMethod.CASH, items: markdownLines });
          saleMinutes.set(sale.id, 735 + Math.floor(rand() * 40));
        }

        // Now and then a buyer brings something back.
        if (weekday === 3 && store.key === "center") {
          const cashSale = sold.find((s) => s.method === PaymentMethod.CASH);
          if (cashSale) {
            const line = cashSale.items[0];
            const ret = await svc.returns.create(directorUser, cashSale.id, { items: [{ productId: line.productId, quantity: 1 }], reason: "Покупатель вернул: подгорел", restocked: false });
            returnMinutes.set(ret.id, Math.min(780, (saleMinutes.get(cashSale.id) ?? 600) + 45));
          }
        }
      }));

      await this.shiftTo(organizationId, since, new Date(midnightOf(day).getTime() + ANCHOR_HOUR * 3600_000));
      await this.spreadSales(saleMinutes);
      await this.spreadReturns(returnMinutes);
      progress.done = index + 2;
    }

    // Depreciation for every month already over.
    const months = new Set(days.map((d) => d.slice(0, 7)));
    for (const ym of months) {
      const [y, m] = ym.split("-").map(Number);
      if (new Date(Date.UTC(y, m, 1)).getTime() > Date.now()) continue;
      try {
        await svc.fixedAssets.runDepreciation(directorUser, y, m);
      } catch (err) {
        this.logger.warn(`Sandbox depreciation ${ym} skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await prisma.user.updateMany({ where: { organizationId, role: Role.ACCOUNTANT }, data: { isActive: true } });
    await prisma.organization.update({ where: { id: organizationId }, data: { demoReadyAt: new Date() } });
    DemoCompanyService.running = null;
    this.logger.log(`Sandbox ${organizationId} for ${parentId} ready in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}
