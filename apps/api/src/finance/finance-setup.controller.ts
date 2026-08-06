import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { FINANCE_SETUP_ROLES, FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceSetupService } from "./finance-setup.service";
import { ReconcileInvoicesDto } from "./dto/reconcile-invoices.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("finance/setup")
export class FinanceSetupController {
  constructor(private financeSetupService: FinanceSetupService) {}

  @Get("status")
  @Roles(...FINANCE_VIEW_ROLES)
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.financeSetupService.getStatus(user.organizationId);
  }

  @Post("reconcile-invoices")
  @Roles(...FINANCE_SETUP_ROLES)
  reconcileInvoices(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReconcileInvoicesDto) {
    return this.financeSetupService.reconcileInvoices(user, dto);
  }

  @Post("complete")
  @Roles(...FINANCE_SETUP_ROLES)
  complete(@CurrentUser() user: AuthenticatedUser) {
    return this.financeSetupService.complete(user);
  }
}
