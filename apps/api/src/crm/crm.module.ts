import { Module } from "@nestjs/common";
import { LoyaltyModule } from "../loyalty/loyalty.module";
import { CrmController } from "./crm.controller";
import { CrmOrdersService } from "./crm-orders.service";
import { CrmService } from "./crm.service";

@Module({
  imports: [LoyaltyModule],
  providers: [CrmService, CrmOrdersService],
  controllers: [CrmController],
})
export class CrmModule {}
