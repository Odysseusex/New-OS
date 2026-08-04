import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { InvoicesService } from "./invoices.service";
import { InvoicesController } from "./invoices.controller";

@Module({
  imports: [FinanceModule],
  providers: [InvoicesService],
  controllers: [InvoicesController],
})
export class InvoicesModule {}
