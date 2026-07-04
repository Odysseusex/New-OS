import { Module } from "@nestjs/common";
import { LogisticsService } from "./logistics.service";
import { LogisticsController } from "./logistics.controller";

@Module({
  providers: [LogisticsService],
  controllers: [LogisticsController],
})
export class LogisticsModule {}
