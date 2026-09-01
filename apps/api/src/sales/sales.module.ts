import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { FiscalModule } from "../fiscal/fiscal.module";
import { SalesService } from "./sales.service";
import { SalesController } from "./sales.controller";

@Module({
  imports: [FinanceModule, FiscalModule],
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
