import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { INVENTORY_MANAGE_ROLES } from "@bakery-os/shared";
import { MaterialRequisitionKind } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { MaterialRequisitionsService } from "./requisitions.service";
import { CreateTransferInput } from "./dto/requisition.dto";

// Склад → «Перемещение» (ТЗ §3.3): the same document as the требование-накладная,
// kind TRANSFER, posted the moment it is saved.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory/transfers")
export class StockTransfersController {
  constructor(private requisitions: MaterialRequisitionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.requisitions.list(user, from, to, MaterialRequisitionKind.TRANSFER);
  }

  @Post()
  @Roles(...INVENTORY_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTransferInput) {
    return this.requisitions.transfer(user, dto);
  }
}
