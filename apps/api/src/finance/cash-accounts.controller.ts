import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CASH_ACCOUNT_MANAGE_ROLES, FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashAccountsService } from "./cash-accounts.service";
import { CreateCashAccountDto } from "./dto/create-cash-account.dto";
import { UpdateCashAccountDto } from "./dto/update-cash-account.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance/accounts")
export class CashAccountsController {
  constructor(private cashAccountsService: CashAccountsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.cashAccountsService.findAll(user.organizationId, includeArchived === "true");
  }

  @Post()
  @Roles(...CASH_ACCOUNT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCashAccountDto) {
    return this.cashAccountsService.create(user, dto);
  }

  @Patch(":id")
  @Roles(...CASH_ACCOUNT_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateCashAccountDto) {
    return this.cashAccountsService.update(user.organizationId, id, dto);
  }

  @Post(":id/set-default")
  @Roles(...CASH_ACCOUNT_MANAGE_ROLES)
  setDefault(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cashAccountsService.setDefault(user, id);
  }

  @Post(":id/archive")
  @Roles(...CASH_ACCOUNT_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cashAccountsService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...CASH_ACCOUNT_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cashAccountsService.restore(user.organizationId, id);
  }
}
