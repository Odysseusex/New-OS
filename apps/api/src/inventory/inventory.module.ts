import { Module } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryController } from "./inventory.controller";
import { StockVoidService } from "./stock-void.service";

@Module({
  providers: [InventoryService, StockVoidService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
