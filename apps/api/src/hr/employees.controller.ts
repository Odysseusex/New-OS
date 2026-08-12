import { Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards } from "@nestjs/common";
import { EMPLOYEE_MANAGE_ROLES, HARD_DELETE_ROLES, SALARY_MANAGE_ROLES, SALARY_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { EmployeesService } from "./employees.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { AddCompensationDto } from "./dto/add-compensation.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("hr/employees")
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Get()
  @Roles(...EMPLOYEE_MANAGE_ROLES)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.employeesService.list(user, locationId, includeArchived === "true");
  }

  @Post()
  @Roles(...EMPLOYEE_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(user, dto);
  }

  @Patch(":id")
  @Roles(...EMPLOYEE_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(user, id, dto);
  }

  @Post(":id/archive")
  @Roles(...EMPLOYEE_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.employeesService.archive(user, id);
  }

  @Post(":id/restore")
  @Roles(...EMPLOYEE_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.employeesService.restore(user, id);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.employeesService.remove(user, id);
  }

  @Get(":id/compensations")
  @Roles(...SALARY_VIEW_ROLES)
  listCompensations(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.employeesService.listCompensations(user, id);
  }

  @Post(":id/compensations")
  @Roles(...SALARY_MANAGE_ROLES)
  addCompensation(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AddCompensationDto) {
    return this.employeesService.addCompensation(user, id, dto);
  }
}
