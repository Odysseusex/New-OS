import { Module } from "@nestjs/common";
import { DemoCompanyController } from "./demo-company.controller";
import { DemoCompanyService } from "./demo-company.service";

@Module({
  controllers: [DemoCompanyController],
  providers: [DemoCompanyService],
})
export class DemoCompanyModule {}
