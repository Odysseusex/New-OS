import { Module } from "@nestjs/common";
import { LoyaltyModule } from "../loyalty/loyalty.module";
import { ClubController } from "./club.controller";
import { ClubService } from "./club.service";
import { ClubAuthGuard } from "./club-auth.guard";

@Module({
  imports: [LoyaltyModule],
  providers: [ClubService, ClubAuthGuard],
  controllers: [ClubController],
})
export class ClubModule {}
