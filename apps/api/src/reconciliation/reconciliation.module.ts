import { Module } from "@nestjs/common";
import { ReconciliationController } from "./reconciliation.controller";
import { ReconciliationService } from "./reconciliation.service";
import { ShelfCountController } from "./shelf-count.controller";
import { ShelfCountService } from "./shelf-count.service";

@Module({
  controllers: [ShelfCountController, ReconciliationController],
  providers: [ReconciliationService, ShelfCountService],
})
export class ReconciliationModule {}
