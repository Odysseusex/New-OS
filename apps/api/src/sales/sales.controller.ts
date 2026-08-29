import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CUSTOMER_VIEW_ROLES, PAYMENT_RECORD_ROLES, SALE_CREATE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { SalesService } from "./sales.service";
import { CreateSaleDto } from "./dto/create-sale.dto";
import { GetCustomerTrendQueryDto } from "./dto/get-customer-trend-query.dto";
import { GetDemandQueryDto } from "./dto/get-demand-query.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("sales")
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.salesService.findAll(
      user,
      locationId,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.salesService.summary(user, locationId);
  }

  @Get("report")
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("locationId") locationId?: string,
  ) {
    return this.salesService.report(user, new Date(from), new Date(to), locationId);
  }

  @Get("demand")
  demandAnalysis(@CurrentUser() user: AuthenticatedUser, @Query() query: GetDemandQueryDto) {
    return this.salesService.demandAnalysis(user, new Date(query.from), new Date(query.to), {
      locationId: query.locationId,
      customerId: query.customerId,
      categoryId: query.categoryId,
      productId: query.productId,
    });
  }

  // Declared before @Get(":id") — otherwise the id route swallows this path.
  // Gated on customer access: this returns one named customer's order history,
  // the same data CustomersController protects.
  @Get("customer-trend")
  @Roles(...CUSTOMER_VIEW_ROLES)
  customerTrend(@CurrentUser() user: AuthenticatedUser, @Query() query: GetCustomerTrendQueryDto) {
    return this.salesService.customerTrend(
      user,
      query.customerId,
      new Date(query.from),
      new Date(query.to),
      { locationId: query.locationId },
    );
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.salesService.findOne(user, id);
  }

  @Post()
  @Roles(...SALE_CREATE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSaleDto) {
    return this.salesService.create(user, dto);
  }

  @Post(":id/record-payment")
  @Roles(...PAYMENT_RECORD_ROLES)
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.salesService.recordPayment(user, id, dto);
  }

  @Get(":id/payments")
  payments(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.salesService.paymentsForSale(user, id);
  }
}
