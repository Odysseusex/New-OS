import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { FINANCE_VIEW_ROLES, POLICY_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { AccountingPolicyService } from "./accounting-policy.service";
import { UpdateAccountingPolicyDto } from "./dto/update-accounting-policy.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("finance/policy")
export class AccountingPolicyController {
  constructor(private accountingPolicyService: AccountingPolicyService) {}

  @Get()
  @Roles(...FINANCE_VIEW_ROLES)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.accountingPolicyService.get(user.organizationId);
  }

  @Put()
  @Roles(...POLICY_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAccountingPolicyDto) {
    return this.accountingPolicyService.update(user, dto);
  }
}
