import { Module } from "@nestjs/common";
import { CleanStartController } from "./clean-start.controller";
import { CleanStartService } from "./clean-start.service";

@Module({
  controllers: [CleanStartController],
  providers: [CleanStartService],
})
export class CleanStartModule {}
