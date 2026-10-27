import { Module } from "@nestjs/common";
import { LoyaltyController, LoyaltyProgramController } from "./loyalty.controller";
import { LoyaltyPointsService } from "./loyalty-points.service";
import { LoyaltyAnalyticsService } from "./loyalty-analytics.service";
import { LoyaltyBirthdayService } from "./loyalty-birthday.service";
import { CustomerBotService } from "./customer-bot.service";
import { CustomerBotController } from "./customer-bot.controller";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";
import { LoyaltyService } from "./loyalty.service";

@Module({
  providers: [LoyaltyService, LoyaltyPointsService, LoyaltyAnalyticsService, LoyaltyBirthdayService, WhatsAppService, CustomerBotService],
  controllers: [LoyaltyController, LoyaltyProgramController, CustomerBotController, WhatsAppController],
  exports: [LoyaltyService, LoyaltyPointsService, LoyaltyAnalyticsService, CustomerBotService, WhatsAppService],
})
export class LoyaltyModule {}
