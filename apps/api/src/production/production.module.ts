import { Module } from "@nestjs/common";
import { ProductionService } from "./production.service";
import { ProductionController } from "./production.controller";
import { MaterialRequisitionsService } from "./requisitions.service";
import { MaterialRequisitionsController } from "./requisitions.controller";

@Module({
  providers: [ProductionService, MaterialRequisitionsService],
  controllers: [MaterialRequisitionsController, ProductionController],
  exports: [ProductionService],
})
export class ProductionModule {}
