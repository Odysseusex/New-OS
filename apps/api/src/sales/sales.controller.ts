import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { SALE_CREATE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { SalesService } from "./sales.service";
import { CreateSaleDto } from "./dto/create-sale.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("sales")
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.salesService.findAll(user, locationId);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.salesService.summary(user, locationId);
  }

  @Post()
  @Roles(...SALE_CREATE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSaleDto) {
    return this.salesService.create(user, dto);
  }
}
