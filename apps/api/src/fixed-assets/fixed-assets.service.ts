import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, DepreciationMethod as PrismaMethod } from "@prisma/client";
import {
  CashMovementType,
  DepreciationEntryDto,
  DepreciationMethod,
  DepreciationRunResultDto,
  DepreciationStatus,
  DisposeFixedAssetRequestDto,
  FixedAssetDto,
  FixedAssetStatus,
  HARD_DELETE_ROLES,
  PnlTreatment,
  BalanceTreatment,
  RegisterFixedAssetRequestDto,
  SetDepreciationTermsRequestDto,
  UnregisteredCapitalExpenseDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { round2 } from "../common/money";
import { monthOf, monthRange } from "../common/reporting-period";
import { CashMovementsService } from "../finance/cash-movements.service";
import { AccountingPolicyService } from "../finance/accounting-policy.service";
import { PeriodGuard } from "../finance/periods/period-guard";
import { depreciationCalculators, isExplicitlyNotDepreciated, resolveDepreciableTerms } from "./depreciation-calculators";
import { postLedgerSources } from "../ledger/event-posting";

type AssetRow = Prisma.FixedAssetGetPayload<{ include: { location: true; depreciation: true } }>;

@Injectable()
export class FixedAssetsService {
  constructor(
    private prisma: PrismaService,
    private cash: CashMovementsService = new CashMovementsService(prisma),
    private policy: AccountingPolicyService = new AccountingPolicyService(prisma),
    private guard: PeriodGuard = new PeriodGuard(prisma),
  ) {}

  // ── reading ────────────────────────────────────────────────────────────

  async list(organizationId: string): Promise<FixedAssetDto[]> {
    const [rows, policy] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where: { organizationId },
        include: { location: true, depreciation: true },
        orderBy: [{ status: "asc" }, { acquiredAt: "desc" }],
      }),
      this.policy.get(organizationId),
    ]);
    return rows.map((r) => this.toDto(r, policy.depreciationMethod.source === "APPROVED" ? (policy.depreciationMethod.value as DepreciationMethod) : null, policy.depreciationUsefulLifeMonths.source === "APPROVED" ? policy.depreciationUsefulLifeMonths.value : null));
  }

  async depreciationEntries(organizationId: string, year?: number, month?: number): Promise<DepreciationEntryDto[]> {
    const rows = await this.prisma.depreciationEntry.findMany({
      where: { organizationId, ...(year ? { year } : {}), ...(month ? { month } : {}) },
      include: { asset: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 500,
    });
    return rows.map((e) => ({
      id: e.id,
      assetId: e.assetId,
      assetName: e.asset.name,
      year: e.year,
      month: e.month,
      amount: e.amount.toNumber(),
      method: e.method as DepreciationMethod,
    }));
  }

  // Confirmed capital purchases nobody has registered as an asset yet. They are
  // NOT expenses (the category says so) and NOT assets (nothing registered) —
  // so they are listed here until someone decides.
  async unregisteredCapitalExpenses(organizationId: string): Promise<UnregisteredCapitalExpenseDto[]> {
    const [expenses, policy] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          organizationId,
          status: "CONFIRMED",
          fixedAsset: null,
          categoryRef: { pnlTreatment: PnlTreatment.NOT_IN_PNL, balanceTreatment: BalanceTreatment.FIXED_ASSET },
        },
        include: { categoryRef: true },
        orderBy: { incurredOn: "desc" },
      }),
      this.policy.get(organizationId),
    ]);
    const threshold = policy.capitalizationThreshold.source === "APPROVED" ? policy.capitalizationThreshold.value : null;
    return expenses.map((e) => ({
      expenseId: e.id,
      description: e.description,
      categoryName: e.categoryRef?.name ?? null,
      amount: e.amount.toNumber(),
      incurredOn: e.incurredOn.toISOString(),
      belowThreshold: threshold !== null && e.amount.toNumber() < threshold,
    }));
  }

  // ── registering ────────────────────────────────────────────────────────

  async register(user: AuthenticatedUser, dto: RegisterFixedAssetRequestDto): Promise<FixedAssetDto> {
    if (!!dto.sourceExpenseId === !!dto.opening) {
      throw new BadRequestException("Укажите либо расход, из которого создано основное средство, либо данные начального остатка");
    }
    const organizationId = user.organizationId;
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId } });
      if (!location) throw new NotFoundException("Точка не найдена");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let cost: number;
      let acquiredAt: Date;
      let isOpening = false;
      let sourceExpenseId: string | undefined;

      if (dto.sourceExpenseId) {
        const expense = await tx.expense.findFirst({
          where: { id: dto.sourceExpenseId, organizationId },
          include: { categoryRef: true },
        });
        if (!expense) throw new NotFoundException("Расход не найден");
        if (expense.status !== "CONFIRMED") throw new BadRequestException("Основное средство создаётся из подтверждённого расхода");
        const c = expense.categoryRef;
        if (!c || c.pnlTreatment !== PnlTreatment.NOT_IN_PNL || c.balanceTreatment !== BalanceTreatment.FIXED_ASSET) {
          throw new BadRequestException("Категория расхода не отмечена как «Основное средство» — сначала классифицируйте её");
        }
        cost = expense.amount.toNumber();
        acquiredAt = expense.incurredOn;
        sourceExpenseId = expense.id;
      } else {
        const opening = dto.opening!;
        if (!(opening.acquisitionCost > 0)) throw new BadRequestException("Стоимость должна быть больше нуля");
        const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { financeInitializedAt: true } });
        // Before go-live the opening position is still being declared. After it,
        // adding to it is a correction of a frozen declaration: owner/admin
        // only, with a reason, on the record.
        if (org.financeInitializedAt) {
          if (!HARD_DELETE_ROLES.includes(user.role)) throw new BadRequestException("После запуска финансового учёта начальные основные средства добавляют владелец или администратор");
          if (!opening.reason || opening.reason.trim().length < 3) throw new BadRequestException("Укажите причину добавления основного средства в начальный остаток");
        }
        cost = round2(opening.acquisitionCost);
        acquiredAt = new Date(opening.acquiredAt);
        isOpening = true;
      }

      await this.guard.assertOpen(organizationId, acquiredAt, tx);
      try {
        const asset = await tx.fixedAsset.create({
          data: {
            organizationId,
            name: dto.name.trim(),
            note: dto.note,
            locationId: dto.locationId,
            acquisitionCost: cost,
            acquiredAt,
            sourceExpenseId,
            isOpening,
            createdById: user.id,
          },
          include: { location: true, depreciation: true },
        });
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "fixedAsset.register",
          entityType: "FixedAsset",
          entityId: asset.id,
          after: { name: asset.name, acquisitionCost: cost, isOpening, sourceExpenseId: sourceExpenseId ?? null },
          reason: dto.opening?.reason,
        });
        return asset;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("Этот расход уже зарегистрирован как основное средство");
        }
        throw err;
      }
    });
    return this.toDto(created, null, null);
  }

  // ── terms ──────────────────────────────────────────────────────────────

  async setTerms(user: AuthenticatedUser, assetId: string, dto: SetDepreciationTermsRequestDto): Promise<FixedAssetDto> {
    const organizationId = user.organizationId;
    const updated = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, organizationId }, include: { location: true, depreciation: true } });
      if (!asset) throw new NotFoundException("Основное средство не найдено");
      if (asset.status !== "ACTIVE") throw new BadRequestException("Выбывшее основное средство изменить нельзя");

      const data: Prisma.FixedAssetUpdateInput = {};
      if (dto.method === null) {
        if (asset.depreciation.length > 0) throw new BadRequestException("Условия нельзя сбросить: амортизация уже начислялась");
        Object.assign(data, { depreciationMethod: null, usefulLifeMonths: null, salvageValue: null, depreciationStartYear: null, depreciationStartMonth: null });
      } else if (dto.method === DepreciationMethod.NOT_DEPRECIATED) {
        if (asset.depreciation.length > 0) throw new BadRequestException("Амортизация уже начислялась — отключить её нельзя");
        Object.assign(data, { depreciationMethod: PrismaMethod.NOT_DEPRECIATED, usefulLifeMonths: null, salvageValue: null, depreciationStartYear: null, depreciationStartMonth: null });
      } else {
        const cost = asset.acquisitionCost.toNumber();
        // Every term is stated by a person; none is defaulted.
        if (!dto.usefulLifeMonths || dto.usefulLifeMonths < 1 || !Number.isInteger(dto.usefulLifeMonths)) throw new BadRequestException("Укажите срок полезного использования в месяцах");
        if (dto.salvageValue === undefined || dto.salvageValue < 0 || dto.salvageValue > cost) throw new BadRequestException("Укажите остаточную стоимость (от 0 до стоимости приобретения)");
        if (!dto.startYear || !dto.startMonth || dto.startMonth < 1 || dto.startMonth > 12) throw new BadRequestException("Укажите месяц начала амортизации");
        if (asset.depreciation.length > 0 && asset.depreciationMethod !== (dto.method as PrismaMethod)) {
          throw new BadRequestException("Амортизация уже начислялась — метод менять нельзя");
        }
        if (!depreciationCalculators.get(dto.method)) throw new BadRequestException("Этот метод амортизации не поддерживается");
        Object.assign(data, {
          depreciationMethod: dto.method as PrismaMethod,
          usefulLifeMonths: dto.usefulLifeMonths,
          salvageValue: round2(dto.salvageValue),
          depreciationStartYear: dto.startYear,
          depreciationStartMonth: dto.startMonth,
        });
      }
      const saved = await tx.fixedAsset.update({ where: { id: assetId }, data, include: { location: true, depreciation: true } });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "fixedAsset.terms",
        entityType: "FixedAsset",
        entityId: assetId,
        before: { method: asset.depreciationMethod, usefulLifeMonths: asset.usefulLifeMonths, salvageValue: asset.salvageValue },
        after: { method: saved.depreciationMethod, usefulLifeMonths: saved.usefulLifeMonths, salvageValue: saved.salvageValue },
      });
      return saved;
    });
    return this.toDto(updated, null, null);
  }

  // ── depreciation ───────────────────────────────────────────────────────

  // Posts every missing month up to and including (year, month), oldest first.
  // Idempotent: a month already posted for an asset is never charged again
  // (a unique row per asset and month, inserted with skipDuplicates), so two
  // runs — even simultaneous — post each entry once.
  async runDepreciation(user: AuthenticatedUser, year: number, month: number): Promise<DepreciationRunResultDto> {
    const organizationId = user.organizationId;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException("Неверный период");
    if (monthRange(year, month).end.getTime() >= Date.now()) {
      throw new BadRequestException("Амортизация начисляется за полностью прошедшие месяцы");
    }

    const [assets, policy] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where: { organizationId }, include: { location: true, depreciation: true } }),
      this.policy.get(organizationId),
    ]);
    const policyMethod = policy.depreciationMethod.source === "APPROVED" ? (policy.depreciationMethod.value as DepreciationMethod) : null;
    const policyLife = policy.depreciationUsefulLifeMonths.source === "APPROVED" ? policy.depreciationUsefulLifeMonths.value : null;

    const result: DepreciationRunResultDto = { created: 0, alreadyPosted: 0, notConfigured: 0, months: [] };
    const byMonth = new Map<string, number>();
    const rows: Prisma.DepreciationEntryCreateManyInput[] = [];

    for (const asset of assets) {
      const terms = this.effectiveTerms(asset, policyMethod, policyLife);
      if (!terms) {
        if (asset.status === "ACTIVE" && !this.isExplicitlyNotDepreciated(asset, policyMethod)) result.notConfigured += 1;
        continue;
      }
      const calculator = depreciationCalculators.get(terms.method)!;
      const posted = new Map(asset.depreciation.map((e) => [`${e.year}-${e.month}`, e.amount.toNumber()]));
      let accumulated = round2([...posted.values()].reduce((s, v) => s + v, 0));
      const end = asset.disposedAt ? monthOf(asset.disposedAt) : null;

      for (let y = terms.startYear, m = terms.startMonth; y * 12 + m <= year * 12 + month; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
        // Nothing is charged for or after the month the asset left.
        if (end && y * 12 + m >= end.year * 12 + end.month) break;
        const key = `${y}-${m}`;
        if (posted.has(key)) {
          result.alreadyPosted += 1;
          continue;
        }
        const amount = calculator.monthlyCharge(terms, { year: y, month: m, accumulated });
        if (amount <= 0) continue;
        rows.push({ organizationId, assetId: asset.id, year: y, month: m, amount, method: terms.method as PrismaMethod, createdById: user.id });
        accumulated = round2(accumulated + amount);
        byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
      }
    }

    if (rows.length > 0) {
      // Every month posted must still be open: depreciation cannot be added to a
      // month whose report is frozen.
      const months = new Set(rows.map((r) => `${r.year}-${r.month}`));
      for (const key of months) {
        const [y, m] = key.split("-").map(Number);
        await this.guard.assertOpen(organizationId, monthRange(y, m).start);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const inserted = rows.length > 0 ? await tx.depreciationEntry.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
      result.created = inserted.count;
      if (rows.length > 0) {
        // Each charge is an expense and a reduction of the asset's book value.
        const entries = await tx.depreciationEntry.findMany({
          where: { organizationId, OR: rows.map((r) => ({ assetId: r.assetId, year: r.year, month: r.month })) },
          select: { id: true },
        });
        await postLedgerSources(tx, { organizationId, actorId: user.id, scope: { depreciationEntryIds: entries.map((e) => e.id) } });
      }
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "depreciation.run",
        entityType: "Organization",
        entityId: organizationId,
        after: { year, month, created: inserted.count, notConfigured: result.notConfigured },
      });
    });
    result.months = [...byMonth.entries()]
      .map(([key, created]) => ({ year: Number(key.split("-")[0]), month: Number(key.split("-")[1]), created }))
      .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    return result;
  }

  // ── disposal ───────────────────────────────────────────────────────────

  async dispose(user: AuthenticatedUser, assetId: string, dto: DisposeFixedAssetRequestDto): Promise<FixedAssetDto> {
    const organizationId = user.organizationId;
    const disposedAt = new Date(dto.disposedAt);
    if (Number.isNaN(disposedAt.getTime())) throw new BadRequestException("Неверная дата выбытия");
    const proceeds = round2(dto.proceeds ?? 0);
    if (proceeds < 0) throw new BadRequestException("Выручка не может быть отрицательной");
    if (proceeds > 0 && !dto.accountId) throw new BadRequestException("Укажите счёт, на который поступили деньги");

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "fixed_assets" WHERE id = ${assetId} FOR UPDATE`;
      const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, organizationId }, include: { location: true, depreciation: true } });
      if (!asset) throw new NotFoundException("Основное средство не найдено");
      if (asset.status !== "ACTIVE") throw new BadRequestException("Основное средство уже выбыло");
      await this.guard.assertOpen(organizationId, disposedAt, tx);

      const disposalMonth = monthOf(disposedAt);
      if (asset.depreciation.some((e) => e.year * 12 + e.month >= disposalMonth.year * 12 + disposalMonth.month)) {
        throw new BadRequestException("Амортизация начислена и за месяц выбытия или позже — дата выбытия слишком ранняя");
      }
      const accumulated = round2(asset.depreciation.reduce((s, e) => s + e.amount.toNumber(), 0));
      const bookValue = round2(asset.acquisitionCost.toNumber() - accumulated);
      const result = round2(proceeds - bookValue);

      const flipped = await tx.fixedAsset.updateMany({
        where: { id: assetId, status: "ACTIVE" },
        data: { status: "DISPOSED", disposedAt, disposalProceeds: proceeds, disposalBookValue: bookValue, disposalResult: result },
      });
      if (flipped.count !== 1) throw new ConflictException("Основное средство уже выбыло");

      if (proceeds > 0) {
        const account = await tx.cashAccount.findFirst({ where: { id: dto.accountId, organizationId } });
        if (!account || !account.isActive) throw new BadRequestException("Счёт не найден или заархивирован");
        await this.cash.recordMovement(tx, {
          organizationId,
          accountId: account.id,
          type: CashMovementType.OTHER_INCOME,
          amount: proceeds,
          fixedAssetId: assetId,
          reason: `Выбытие основного средства: ${asset.name}`,
          createdById: user.id,
        });
      }
      await postLedgerSources(tx, { organizationId, actorId: user.id, scope: { fixedAssetIds: [assetId] } });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "fixedAsset.dispose",
        entityType: "FixedAsset",
        entityId: assetId,
        after: { disposedAt: disposedAt.toISOString(), proceeds, bookValue, result },
      });
      return tx.fixedAsset.findUniqueOrThrow({ where: { id: assetId }, include: { location: true, depreciation: true } });
    });
    return this.toDto(updated, null, null);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private effectiveTerms(asset: AssetRow, policyMethod: DepreciationMethod | null, policyLife: number | null) {
    return resolveDepreciableTerms(asset, policyMethod, policyLife);
  }

  private isExplicitlyNotDepreciated(asset: Pick<AssetRow, "depreciationMethod">, policyMethod: DepreciationMethod | null): boolean {
    return isExplicitlyNotDepreciated(asset, policyMethod);
  }

  toDto(asset: AssetRow, policyMethod: DepreciationMethod | null, policyLife: number | null): FixedAssetDto {
    const accumulated = round2(asset.depreciation.reduce((s, e) => s + e.amount.toNumber(), 0));
    const terms = this.effectiveTerms(asset, policyMethod, policyLife);
    const base = terms ? round2(terms.acquisitionCost - terms.salvageValue) : 0;
    let status: DepreciationStatus;
    if (this.isExplicitlyNotDepreciated(asset, policyMethod)) status = DepreciationStatus.NOT_DEPRECIATED;
    else if (!terms) status = DepreciationStatus.NOT_CONFIGURED;
    else if (accumulated >= base) status = DepreciationStatus.FULLY_DEPRECIATED;
    else status = DepreciationStatus.DEPRECIATING;
    return {
      id: asset.id,
      name: asset.name,
      note: asset.note,
      locationId: asset.locationId,
      locationName: asset.location?.name ?? null,
      acquisitionCost: asset.acquisitionCost.toNumber(),
      acquiredAt: asset.acquiredAt.toISOString(),
      sourceExpenseId: asset.sourceExpenseId,
      isOpening: asset.isOpening,
      status: asset.status as FixedAssetStatus,
      depreciationMethod: asset.depreciationMethod as DepreciationMethod | null,
      usefulLifeMonths: asset.usefulLifeMonths,
      salvageValue: asset.salvageValue ? asset.salvageValue.toNumber() : null,
      depreciationStartYear: asset.depreciationStartYear,
      depreciationStartMonth: asset.depreciationStartMonth,
      depreciationStatus: status,
      monthlyDepreciation: terms ? round2(base / terms.usefulLifeMonths) : null,
      accumulatedDepreciation: accumulated,
      bookValue: asset.status === "DISPOSED" ? 0 : round2(asset.acquisitionCost.toNumber() - accumulated),
      disposedAt: asset.disposedAt ? asset.disposedAt.toISOString() : null,
      disposalProceeds: asset.disposalProceeds ? asset.disposalProceeds.toNumber() : null,
      disposalBookValue: asset.disposalBookValue ? asset.disposalBookValue.toNumber() : null,
      disposalResult: asset.disposalResult ? asset.disposalResult.toNumber() : null,
    };
  }
}
