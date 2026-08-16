import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceCategoryKind, PlannedFixedCostDto } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreatePlannedFixedCostDto } from "./dto/create-planned-fixed-cost.dto";

const PLANNED_INCLUDE = { category: true, location: true, createdBy: true };

/**
 * Planned (never actual) recurring fixed costs — rent, utilities, internet.
 *
 * Append-only history, exactly like EmployeeCompensation: setting a new
 * amount closes the previous open-ended row rather than overwriting it, so
 * "what did we plan for rent in March" stays answerable.
 *
 * Nothing here ever creates an Expense or a CashMovement. That separation is
 * the whole point of the plan/fact split — real money moves only through
 * FinanceService.createExpense/recordExpensePayment.
 */
@Injectable()
export class PlannedFixedCostsService {
  constructor(private prisma: PrismaService) {}

  // Only currently-active rows (effectiveTo = null) by default — the
  // superseded history is opt-in, same shape as the archived toggles used by
  // every reference entity in the app.
  async list(organizationId: string, includeHistory = false): Promise<PlannedFixedCostDto[]> {
    const rows = await this.prisma.plannedFixedCost.findMany({
      where: { organizationId, ...(includeHistory ? {} : { effectiveTo: null }) },
      include: PLANNED_INCLUDE,
      orderBy: [{ effectiveTo: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreatePlannedFixedCostDto): Promise<PlannedFixedCostDto> {
    const category = await this.prisma.financeCategory.findFirst({
      where: { id: dto.categoryId, organizationId: user.organizationId },
    });
    if (!category) {
      throw new NotFoundException("Категория не найдена");
    }
    // A planned INCOME line would be a revenue forecast, which is a
    // different feature with different maths — reject rather than silently
    // letting it distort the fixed-cost total.
    if (category.kind !== FinanceCategoryKind.EXPENSE) {
      throw new BadRequestException("Плановый постоянный расход можно задать только для статьи расходов");
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId: user.organizationId },
      });
      if (!location) {
        throw new NotFoundException("Точка не найдена");
      }
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const locationId = dto.locationId ?? null;

    // At most one open row per (category, location) pair — "аренда для Абая"
    // and "аренда для Достыка" are separate plans, but one of them can't
    // have two current amounts at once.
    const openRow = await this.prisma.plannedFixedCost.findFirst({
      where: { organizationId: user.organizationId, categoryId: dto.categoryId, locationId, effectiveTo: null },
    });
    if (openRow && effectiveFrom <= openRow.effectiveFrom) {
      throw new BadRequestException(
        "Дата вступления в силу должна быть позже даты предыдущего планового значения",
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (openRow) {
        await tx.plannedFixedCost.update({
          where: { id: openRow.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      return tx.plannedFixedCost.create({
        data: {
          organizationId: user.organizationId,
          categoryId: dto.categoryId,
          locationId,
          amount: dto.amount,
          effectiveFrom,
          createdById: user.id,
        },
        include: PLANNED_INCLUDE,
      });
    });

    return this.toDto(created);
  }

  // Ends a plan without rewriting history — the row stays, it just stops
  // being current (same spirit as archiving a reference entity).
  async close(user: AuthenticatedUser, id: string): Promise<PlannedFixedCostDto> {
    const row = await this.prisma.plannedFixedCost.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!row) {
      throw new NotFoundException("Плановый расход не найден");
    }
    if (row.effectiveTo) {
      throw new BadRequestException("Этот плановый расход уже закрыт");
    }
    const updated = await this.prisma.plannedFixedCost.update({
      where: { id },
      data: { effectiveTo: new Date() },
      include: PLANNED_INCLUDE,
    });
    return this.toDto(updated);
  }

  private toDto = (row: {
    id: string;
    categoryId: string;
    category: { name: string };
    locationId: string | null;
    location: { name: string } | null;
    amount: { toNumber: () => number };
    effectiveFrom: Date;
    effectiveTo: Date | null;
    createdBy: { fullName: string };
    createdAt: Date;
  }): PlannedFixedCostDto => ({
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    amount: row.amount.toNumber(),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
  });
}
