import * as bcrypt from "bcryptjs";
import { Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { FinanceService } from "../finance/finance.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { DemoCompanyService } from "./demo-company.service";

// «Песочница»: a separate demo company filled through the ordinary services,
// its days moved back to the dates they stand for — and nothing of it leaking
// into, or touching, any other organization.

jest.setTimeout(300_000);

const DATE_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" });
const HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "2-digit", hourCycle: "h23" });

describe("sandbox company", () => {
  const prisma = new PrismaService();
  const service = new DemoCompanyService(prisma);
  let parent: IsolatedOrg;
  let stranger: IsolatedOrg;
  // The last day of last month and the first two of this one: salaries, rent
  // and the acquiring fee all fall due in these three days.
  const now = new Date();
  const [y, m] = DATE_KEY.format(now).split("-").map(Number);
  const lastOfPrevious = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const secondOfThis = new Date(Date.UTC(y, m - 1, 2)).toISOString().slice(0, 10);
  let realCounts: { sales: number; movements: number };

  const countReal = async () => {
    const [{ sales, movements }] = await prisma.$queryRaw<{ sales: bigint; movements: bigint }[]>`
      SELECT
        (SELECT count(*) FROM "sales" s JOIN "organizations" o ON o."id" = s."organizationId" WHERE o."demoParentId" IS NULL) AS sales,
        (SELECT count(*) FROM "stock_movements" s JOIN "organizations" o ON o."id" = s."organizationId" WHERE o."demoParentId" IS NULL) AS movements`;
    return { sales: Number(sales), movements: Number(movements) };
  };

  beforeAll(async () => {
    await prisma.$connect();
    parent = await createIsolatedOrg(prisma, "sandbox-parent");
    stranger = await createIsolatedOrg(prisma, "sandbox-stranger");
    realCounts = await countReal();
  });
  afterAll(async () => {
    await DemoCompanyService.finished;
    const demo = await prisma.organization.findUnique({ where: { demoParentId: parent.organizationId } });
    if (demo) await destroyOrg(prisma, demo.id);
    await destroyOrg(prisma, parent.organizationId);
    await destroyOrg(prisma, stranger.organizationId);
    await prisma.$disconnect();
  });

  it("is generated day by day, dated where it belongs, with a working «Бухгалтер» login", async () => {
    const credentials = await service.start(parent.user, lastOfPrevious, secondOfThis);
    const login = await prisma.user.findFirstOrThrow({ where: { email: credentials.email } });
    expect(login.role).toBe(Role.ACCOUNTANT);
    expect(login.isActive).toBe(false);
    expect(await bcrypt.compare(credentials.password, login.passwordHash)).toBe(true);

    await DemoCompanyService.finished;
    const status = await service.status(parent.user);
    expect(status.state).toBe("READY");
    expect(status.periodFrom).toBe(lastOfPrevious);
    expect(status.periodTo).toBe(secondOfThis);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: login.id } })).isActive).toBe(true);

    const demo = await prisma.organization.findUniqueOrThrow({ where: { demoParentId: parent.organizationId } });
    expect(login.organizationId).toBe(demo.id);
    const sales = await prisma.sale.findMany({ where: { organizationId: demo.id } });
    expect(sales.length).toBeGreaterThan(30);
    for (const sale of sales) {
      const day = DATE_KEY.format(sale.soldAt);
      expect(day >= lastOfPrevious && day <= secondOfThis).toBe(true);
      const hour = Number(HOUR.format(sale.soldAt));
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThanOrEqual(20);
    }
    // Nothing of the sandbox is left at "now".
    const recent = await prisma.stockMovement.count({ where: { organizationId: demo.id, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    expect(recent).toBe(0);

    const pnl = await new FinanceService(prisma, new CashMovementsService(prisma)).getProfitAndLoss(
      demo.id,
      new Date(`${lastOfPrevious}T00:00:00+05:00`),
      new Date(`${secondOfThis}T23:59:59+05:00`),
    );
    expect(pnl.revenue).toBeGreaterThan(50_000);
    expect(pnl.cogs).toBeGreaterThan(0);
    const expenses = await prisma.expense.findMany({ where: { organizationId: demo.id }, include: { categoryRef: true } });
    expect(expenses.map((e) => e.categoryRef?.name)).toEqual(expect.arrayContaining(["Зарплата", "Аренда"]));
  });

  it("never touches a real organization", async () => {
    expect(await countReal()).toEqual(realCounts);
    await expect(
      prisma.$executeRaw`SELECT demo_shift_since(${parent.organizationId}, now()::timestamp(3), interval '1 day')`,
    ).rejects.toThrow(/not a demo organization/);
  });

  it("can be seen and removed only by its own owner, and leaves nothing behind", async () => {
    expect((await service.status(stranger.user)).state).toBe("NONE");
    await expect(service.remove(stranger.user)).rejects.toThrow("Песочницы нет");

    const demo = await prisma.organization.findUniqueOrThrow({ where: { demoParentId: parent.organizationId } });
    await expect(service.start(parent.user, lastOfPrevious, lastOfPrevious)).rejects.toThrow("уже есть");
    await service.remove(parent.user);
    expect(await prisma.organization.findUnique({ where: { id: demo.id } })).toBeNull();
    expect(await prisma.sale.count({ where: { organizationId: demo.id } })).toBe(0);
    expect((await service.status(parent.user)).state).toBe("NONE");
    expect(await prisma.organization.findUnique({ where: { id: parent.organizationId } })).not.toBeNull();
  });
});
