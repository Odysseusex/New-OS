import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { TILL_SHIFT_HISTORY_ROLES, TILL_SHIFT_ROLES, TILL_SHIFT_SETTINGS_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { TillShiftsService } from "./till-shifts.service";

const MAX_CASH = 100_000_000;

class OpenTillShiftDto {
  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_CASH)
  openingCash!: number;
}

class TillShiftCashDto {
  @IsIn(["IN", "OUT"])
  direction!: "IN" | "OUT";

  @IsNumber()
  @Min(0.01)
  @Max(MAX_CASH)
  amount!: number;

  @IsString()
  accountId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  comment!: string;
}

class CloseTillShiftDto {
  @IsNumber()
  @Min(0)
  @Max(MAX_CASH)
  countedCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class TillShiftListQuery {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}

class TillShiftRequiredDto {
  @IsBoolean()
  required!: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("till-shifts")
export class TillShiftsController {
  constructor(private service: TillShiftsService) {}

  // The till's own view: the open shift with its live X-report.
  @Get("current")
  @Roles(...TILL_SHIFT_ROLES)
  current(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.service.state(user, locationId);
  }

  @Post()
  @Roles(...TILL_SHIFT_ROLES)
  open(@CurrentUser() user: AuthenticatedUser, @Body() dto: OpenTillShiftDto) {
    return this.service.open(user, dto);
  }

  @Post(":id/cash")
  @Roles(...TILL_SHIFT_ROLES)
  moveCash(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: TillShiftCashDto) {
    return this.service.moveCash(user, id, dto);
  }

  @Post(":id/close")
  @Roles(...TILL_SHIFT_ROLES)
  close(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CloseTillShiftDto) {
    return this.service.close(user, id, dto);
  }

  @Get()
  @Roles(...TILL_SHIFT_HISTORY_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: TillShiftListQuery) {
    return this.service.list(user, q.locationId, new Date(q.from), new Date(q.to));
  }

  @Put("required")
  @Roles(...TILL_SHIFT_SETTINGS_ROLES)
  setRequired(@CurrentUser() user: AuthenticatedUser, @Body() dto: TillShiftRequiredDto) {
    return this.service.setRequired(user, dto.required);
  }

  // A shift's report: the cashier's own point, or any for the history roles.
  @Get(":id")
  @Roles(...TILL_SHIFT_ROLES, ...TILL_SHIFT_HISTORY_ROLES)
  detail(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.detail(user, id);
  }
}
