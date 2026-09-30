import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { HARD_DELETE_ROLES, PURCHASE_ORDER_MANAGE_ROLES, SUPPLIER_PAYMENT_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProcurementService } from "./procurement.service";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { ReceivePurchaseOrderDto } from "./dto/receive-purchase-order.dto";
import { RecordPurchaseOrderPaymentDto, ReversePurchaseOrderPaymentDto } from "./dto/purchase-order-payment.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("procurement/workflow")
export class ProcurementWorkflowController {
  constructor(private procurementService: ProcurementService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.procurementService.getWorkflow(user.organizationId);
  }

  // The purchasing cutover — a one-way switch, owner/admin only.
  @Post("activate")
  @Roles(...HARD_DELETE_ROLES)
  activate(@CurrentUser() user: AuthenticatedUser) {
    return this.procurementService.activateCutover(user);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("procurement/orders")
export class ProcurementController {
  constructor(private procurementService: ProcurementService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.procurementService.findAll(user, locationId);
  }

  @Post()
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.procurementService.create(user, dto);
  }

  @Post(":id/receive")
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  receive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.procurementService.receive(user, id, dto);
  }

  @Post(":id/payments")
  @Roles(...SUPPLIER_PAYMENT_ROLES)
  pay(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: RecordPurchaseOrderPaymentDto) {
    return this.procurementService.recordPayment(user, id, dto);
  }

  @Post(":id/payments/:paymentId/reverse")
  @Roles(...HARD_DELETE_ROLES)
  reversePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() dto: ReversePurchaseOrderPaymentDto,
  ) {
    return this.procurementService.reversePayment(user, id, paymentId, dto.reason);
  }

  @Post(":id/cancel")
  @Roles(...PURCHASE_ORDER_MANAGE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.procurementService.cancel(user, id);
  }
}
