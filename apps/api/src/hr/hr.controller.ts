import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { HR_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { HrService } from "./hr.service";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { ClockInDto } from "./dto/clock-in.dto";
import { ClockInForDto } from "./dto/clock-in-for.dto";
import { GetKpiQueryDto } from "./dto/get-kpi-query.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("hr")
export class HrController {
  constructor(private hrService: HrService) {}

  @Get("shifts")
  @Roles(...HR_MANAGE_ROLES)
  listShifts(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.hrService.listShifts(user, locationId);
  }

  @Get("shifts/me")
  listMyShifts(@CurrentUser() user: AuthenticatedUser) {
    return this.hrService.listMyShifts(user);
  }

  @Post("shifts")
  @Roles(...HR_MANAGE_ROLES)
  createShift(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShiftDto) {
    return this.hrService.createShift(user, dto);
  }

  @Post("shifts/:id/cancel")
  @Roles(...HR_MANAGE_ROLES)
  cancelShift(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.hrService.cancelShift(user, id);
  }

  @Get("time-entries")
  @Roles(...HR_MANAGE_ROLES)
  listTimeEntries(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.hrService.listTimeEntries(user, locationId);
  }

  @Get("time-entries/me")
  listMyTimeEntries(@CurrentUser() user: AuthenticatedUser) {
    return this.hrService.listMyTimeEntries(user);
  }

  @Post("time-entries/clock-in")
  clockIn(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClockInDto) {
    return this.hrService.clockIn(user, dto);
  }

  @Post("time-entries/clock-out")
  clockOut(@CurrentUser() user: AuthenticatedUser) {
    return this.hrService.clockOut(user);
  }

  // Manager-assisted attendance for employees with no ERP login of their own.
  @Post("employees/:employeeId/clock-in")
  @Roles(...HR_MANAGE_ROLES)
  clockInFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param("employeeId") employeeId: string,
    @Body() dto: ClockInForDto,
  ) {
    return this.hrService.clockInFor(user, employeeId, dto);
  }

  @Post("employees/:employeeId/clock-out")
  @Roles(...HR_MANAGE_ROLES)
  clockOutFor(@CurrentUser() user: AuthenticatedUser, @Param("employeeId") employeeId: string) {
    return this.hrService.clockOutFor(user, employeeId);
  }

  @Get("kpi")
  @Roles(...HR_MANAGE_ROLES)
  getKpi(@CurrentUser() user: AuthenticatedUser, @Query() query: GetKpiQueryDto) {
    return this.hrService.getKpi(user, new Date(query.from), new Date(query.to), query.locationId);
  }
}
