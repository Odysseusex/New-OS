import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { INVENTORY_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { InventoryService } from "./inventory.service";
import { ReceiveStockDto } from "./dto/receive-stock.dto";
import { WriteOffStockDto } from "./dto/write-off-stock.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory")
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Get("stock-levels")
  getStockLevels(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
  ) {
    return this.inventoryService.getStockLevels(user, locationId);
  }

  @Get("movements")
  getMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
  ) {
    return this.inventoryService.getMovements(user, locationId);
  }

  @Post("receipts")
  @Roles(...INVENTORY_MANAGE_ROLES)
  receive(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReceiveStockDto) {
    return this.inventoryService.receive(user, dto);
  }

  @Post("write-offs")
  @Roles(...INVENTORY_MANAGE_ROLES)
  writeOff(@CurrentUser() user: AuthenticatedUser, @Body() dto: WriteOffStockDto) {
    return this.inventoryService.writeOff(user, dto);
  }

  @Post("adjustments")
  @Roles(...INVENTORY_MANAGE_ROLES)
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdjustStockDto) {
    return this.inventoryService.adjust(user, dto);
  }
}
