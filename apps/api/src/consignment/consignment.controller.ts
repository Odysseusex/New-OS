import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CONSIGNMENT_PAY_ROLES, CONSIGNMENT_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ConsignmentService } from "./consignment.service";
import { CreateConsignmentPaymentDto } from "./dto/create-consignment-payment.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("consignment")
export class ConsignmentController {
  constructor(private consignmentService: ConsignmentService) {}

  @Get("balances")
  @Roles(...CONSIGNMENT_VIEW_ROLES)
  balances(@CurrentUser() user: AuthenticatedUser) {
    return this.consignmentService.balances(user.organizationId);
  }

  @Get("balances/:supplierId")
  @Roles(...CONSIGNMENT_VIEW_ROLES)
  detail(@CurrentUser() user: AuthenticatedUser, @Param("supplierId") supplierId: string) {
    return this.consignmentService.detail(user.organizationId, supplierId);
  }

  @Post("payments")
  @Roles(...CONSIGNMENT_PAY_ROLES)
  pay(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConsignmentPaymentDto) {
    return this.consignmentService.pay(user, dto);
  }
}
