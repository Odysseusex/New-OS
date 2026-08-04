import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CASH_ADJUSTMENT_ROLES, CASH_REGISTER_MANAGE_ROLES, FINANCE_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashMovementsService } from "./cash-movements.service";
import { CashDepositDto } from "./dto/cash-deposit.dto";
import { CashWithdrawalDto } from "./dto/cash-withdrawal.dto";
import { CashTransferDto } from "./dto/cash-transfer.dto";
import { CashAdjustmentDto } from "./dto/cash-adjustment.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance/movements")
export class CashMovementsController {
  constructor(private cashMovementsService: CashMovementsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("accountId") accountId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.cashMovementsService.findAll(user.organizationId, accountId, limit ? Number(limit) : undefined);
  }

  @Post("deposit")
  @Roles(...CASH_REGISTER_MANAGE_ROLES)
  deposit(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashDepositDto) {
    return this.cashMovementsService.deposit(user, dto);
  }

  @Post("withdraw")
  @Roles(...CASH_REGISTER_MANAGE_ROLES)
  withdraw(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashWithdrawalDto) {
    return this.cashMovementsService.withdraw(user, dto);
  }

  @Post("transfer")
  @Roles(...CASH_REGISTER_MANAGE_ROLES)
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashTransferDto) {
    return this.cashMovementsService.transfer(user, dto);
  }

  @Post("adjust")
  @Roles(...CASH_ADJUSTMENT_ROLES)
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashAdjustmentDto) {
    return this.cashMovementsService.adjust(user, dto);
  }
}
