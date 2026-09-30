import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { FixedAssetsController } from "./fixed-assets.controller";
import { FixedAssetsService } from "./fixed-assets.service";

@Module({
  imports: [FinanceModule],
  providers: [FixedAssetsService],
  controllers: [FixedAssetsController],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
