import { Module } from "@nestjs/common";
import { ProductionService } from "./production.service";
import { ProductionController } from "./production.controller";
import { MaterialRequisitionsService } from "./requisitions.service";
import { MaterialRequisitionsController } from "./requisitions.controller";
import { StockTransfersController } from "./transfers.controller";

@Module({
  providers: [ProductionService, MaterialRequisitionsService],
  controllers: [MaterialRequisitionsController, StockTransfersController, ProductionController],
  exports: [ProductionService],
})
export class ProductionModule {}
