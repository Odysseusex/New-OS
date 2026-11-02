import { Module } from "@nestjs/common";
import { DebtsService } from "./debts.service";
import { DebtsController } from "./debts.controller";

@Module({
  providers: [DebtsService],
  controllers: [DebtsController],
  exports: [DebtsService],
})
export class DebtsModule {}
