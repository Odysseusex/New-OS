import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { FiscalModule } from "../fiscal/fiscal.module";
import { SalesService } from "./sales.service";
import { SaleReturnsService } from "./sale-returns.service";
import { SalesController } from "./sales.controller";

@Module({
  imports: [FinanceModule, FiscalModule],
  providers: [SalesService, SaleReturnsService],
  controllers: [SalesController],
  exports: [SalesService, SaleReturnsService],
})
export class SalesModule {}
