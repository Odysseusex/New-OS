import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { PLANNING_MANAGE_ROLES, PLANNING_VIEW_ROLES, PlanMetric } from "@bakery-os/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateIf, ValidateNested } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { PlanningService } from "./planning.service";

class PlanLineDto {
  @IsEnum(PlanMetric)
  metric!: PlanMetric;

  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number | null;
}

class SetPlanDto {
  @IsInt()
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PlanLineDto)
  lines!: PlanLineDto[];
}

class DriversDto {
  @IsInt()
  months!: number;

  @IsNumber()
  revenueGrowthPercentPerMonth!: number;

  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  cogsPercentOfRevenue!: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  fixedExpensesPerMonth!: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  variableExpensePercentOfRevenue!: number | null;

  @IsNumber()
  capexPerMonth!: number;

  @IsNumber()
  ownerWithdrawalsPerMonth!: number;

  @IsNumber()
  loanRepaymentPerMonth!: number;

  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  openingCash!: number | null;
}

class RunModelDto {
  @ValidateNested()
  @Type(() => DriversDto)
  drivers!: DriversDto;

  @IsOptional()
  @IsInt()
  baselineMonths?: number;
}

class SaveScenarioDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @ValidateNested()
  @Type(() => DriversDto)
  drivers!: DriversDto;
}

class CompareDto {
  @IsArray()
  @IsString({ each: true })
  scenarioIds!: string[];

  @IsOptional()
  @IsInt()
  baselineMonths?: number;
}

const num = (v: string | undefined): number | undefined => (v === undefined || v === "" ? undefined : Number(v));
const date = (v: string | undefined, fallback: Date): Date => {
  if (!v) return fallback;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Неверная дата");
  return d;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PLANNING_VIEW_ROLES)
@Controller("planning")
export class PlanningController {
  constructor(private planning: PlanningService) {}

  @Get("abc-xyz")
  abcXyz(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string, @Query("locationId") locationId?: string) {
    const end = date(to, new Date());
    return this.planning.abcXyz(user.organizationId, date(from, new Date(end.getTime() - 84 * 86400_000)), end, locationId);
  }

  @Get("replenishment")
  replenishment(
    @CurrentUser() user: AuthenticatedUser,
    @Query("lookbackDays") lookbackDays?: string,
    @Query("leadTimeDays") leadTimeDays?: string,
    @Query("safetyDays") safetyDays?: string,
    @Query("reviewDays") reviewDays?: string,
    @Query("locationId") locationId?: string,
  ) {
    return this.planning.replenishment(user.organizationId, {
      lookbackDays: num(lookbackDays),
      leadTimeDays: num(leadTimeDays),
      safetyDays: num(safetyDays),
      reviewDays: num(reviewDays),
      locationId,
    });
  }

  @Get("plan-fact")
  planFact(@CurrentUser() user: AuthenticatedUser, @Query("year") year: string, @Query("month") month: string) {
    return this.planning.planFact(user.organizationId, Number(year), Number(month));
  }

  @Put("plan")
  @Roles(...PLANNING_MANAGE_ROLES)
  setPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPlanDto) {
    return this.planning.setPlan(user, dto);
  }

  @Get("model/baseline")
  baseline(@CurrentUser() user: AuthenticatedUser, @Query("months") months?: string) {
    return this.planning.baseline(user.organizationId, num(months) ?? 3);
  }

  @Post("model/run")
  run(@CurrentUser() user: AuthenticatedUser, @Body() dto: RunModelDto) {
    return this.planning.run(user.organizationId, dto.drivers, dto.baselineMonths ?? 3);
  }

  @Get("model/scenarios")
  scenarios(@CurrentUser() user: AuthenticatedUser) {
    return this.planning.listScenarios(user.organizationId);
  }

  @Post("model/scenarios")
  @Roles(...PLANNING_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveScenarioDto) {
    return this.planning.saveScenario(user, dto);
  }

  @Put("model/scenarios/:id")
  @Roles(...PLANNING_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveScenarioDto) {
    return this.planning.saveScenario(user, dto, id);
  }

  @Delete("model/scenarios/:id")
  @Roles(...PLANNING_MANAGE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.planning.deleteScenario(user.organizationId, id);
  }

  @Post("model/compare")
  compare(@CurrentUser() user: AuthenticatedUser, @Body() dto: CompareDto) {
    return this.planning.compare(user.organizationId, dto.scenarioIds, dto.baselineMonths ?? 3);
  }
}
