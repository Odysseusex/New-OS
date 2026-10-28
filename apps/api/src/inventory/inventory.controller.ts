import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CreateStockVoidRequestDto, INVENTORY_MANAGE_ROLES, STOCK_MOVEMENTS_MAX, STOCK_VOID_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { InventoryService } from "./inventory.service";
import { ReceiveStockDto } from "./dto/receive-stock.dto";
import { WriteOffStockDto } from "./dto/write-off-stock.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { AdjustStockBatchDto, ReceiveStockBatchDto, WriteOffStockBatchDto } from "./dto/stock-batch.dto";
import { StockVoidService } from "./stock-void.service";
import { CreateStockVoidDto, PreviewStockVoidDto } from "./dto/stock-void.dto";
import { ListStockMovementsQueryDto } from "./dto/list-stock-movements-query.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory")
export class InventoryController {
  constructor(
    private inventoryService: InventoryService,
    private stockVoids: StockVoidService,
  ) {}

  @Get("stock-levels")
  getStockLevels(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
  ) {
    return this.inventoryService.getStockLevels(user, locationId);
  }

  // Without a period or a product: the latest 50, as the history always was.
  // With one: everything in it, up to STOCK_MOVEMENTS_MAX rows.
  @Get("movements")
  getMovements(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockMovementsQueryDto) {
    const narrowed = Boolean(query.from || query.to || query.productId);
    return this.inventoryService.getMovements(user, query.locationId, narrowed ? STOCK_MOVEMENTS_MAX : 50, {
      productId: query.productId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
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

  // Several products in one document, all-or-nothing.
  @Post("receipts/batch")
  @Roles(...INVENTORY_MANAGE_ROLES)
  receiveBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReceiveStockBatchDto) {
    return this.inventoryService.applyBatch(user, "receive", dto);
  }

  @Post("write-offs/batch")
  @Roles(...INVENTORY_MANAGE_ROLES)
  writeOffBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: WriteOffStockBatchDto) {
    return this.inventoryService.applyBatch(user, "write-off", dto);
  }

  @Post("adjustments/batch")
  @Roles(...INVENTORY_MANAGE_ROLES)
  adjustBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdjustStockBatchDto) {
    return this.inventoryService.applyBatch(user, "adjustment", dto);
  }

  // ── Аннулирование ошибочного прихода и списания ──
  @Get("voids")
  @Roles(...STOCK_VOID_ROLES)
  listVoids(@CurrentUser() user: AuthenticatedUser, @Query("productId") productId?: string) {
    return this.stockVoids.list(user, productId);
  }

  @Get("voids/candidates")
  @Roles(...STOCK_VOID_ROLES)
  voidCandidates(@CurrentUser() user: AuthenticatedUser, @Query("productId") productId: string) {
    return this.stockVoids.candidates(user, productId);
  }

  @Post("voids/preview")
  @Roles(...STOCK_VOID_ROLES)
  previewVoid(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewStockVoidDto) {
    return this.stockVoids.preview(user, dto);
  }

  @Post("voids")
  @Roles(...STOCK_VOID_ROLES)
  createVoid(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockVoidDto) {
    return this.stockVoids.create(user, dto as CreateStockVoidRequestDto);
  }
}
