import { Module } from "@nestjs/common";
import { LoyaltyController, LoyaltyProgramController } from "./loyalty.controller";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyAnalyticsService } from "./loyalty-analytics.service";
import { LoyaltyService } from "./loyalty.service";

@Module({
  providers: [LoyaltyService, LoyaltyPointsService, LoyaltyAnalyticsService],
  controllers: [LoyaltyController, LoyaltyProgramController],
  exports: [LoyaltyService, LoyaltyPointsService],
})
export class LoyaltyModule {}
