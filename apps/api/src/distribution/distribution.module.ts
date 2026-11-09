import { Module } from "@nestjs/common";
import { StandingOrdersController } from "./standing-orders.controller";
import { StandingOrdersService } from "./standing-orders.service";

@Module({
  controllers: [StandingOrdersController],
  providers: [StandingOrdersService],
})
export class DistributionModule {}
