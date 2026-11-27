import { Module } from "@nestjs/common";
import { ProductionModule } from "../production/production.module";
import { SalesModule } from "../sales/sales.module";
import { TelegramModule } from "../telegram/telegram.module";
import { BakerController } from "./baker.controller";
import { BakerNotesService } from "./baker-notes.service";
import { BakerDayService } from "./baker-day.service";
import { SupplierIntakesService } from "./supplier-intakes.service";
import { PrintJobsService } from "./print-jobs.service";
import { BakerTripsService } from "./baker-trips.service";
import { StaffPushService } from "./staff-push.service";

@Module({
  imports: [ProductionModule, SalesModule, TelegramModule],
  controllers: [BakerController],
  providers: [BakerNotesService, BakerDayService, SupplierIntakesService, PrintJobsService, BakerTripsService, StaffPushService],
})
export class BakerModule {}
