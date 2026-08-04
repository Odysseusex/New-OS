import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { SalesService } from "./sales.service";
import { SalesController } from "./sales.controller";

@Module({
  imports: [FinanceModule],
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
