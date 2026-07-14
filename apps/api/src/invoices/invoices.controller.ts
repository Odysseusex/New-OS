import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { INVOICE_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("invoices")
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.invoicesService.findAll(user, locationId);
  }

  @Post()
  @Roles(...INVOICE_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(user, dto);
  }

  @Post(":id/confirm")
  @Roles(...INVOICE_MANAGE_ROLES)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.invoicesService.confirm(user, id);
  }

  @Post(":id/cancel")
  @Roles(...INVOICE_MANAGE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.invoicesService.cancel(user, id);
  }
}
