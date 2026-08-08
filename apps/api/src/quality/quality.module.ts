import { Module } from "@nestjs/common";
import { QualityService } from "./quality.service";
import { QualityController } from "./quality.controller";

@Module({
  providers: [QualityService],
  controllers: [QualityController],
  // Exported so AiModule can reuse getSummary() rather than re-querying
  // WRITE_OFF stock movements itself.
  exports: [QualityService],
})
export class QualityModule {}
