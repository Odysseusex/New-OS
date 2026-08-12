import { Module } from "@nestjs/common";
import { HrService } from "./hr.service";
import { HrController } from "./hr.controller";
import { EmployeesService } from "./employees.service";
import { EmployeesController } from "./employees.controller";

@Module({
  providers: [HrService, EmployeesService],
  controllers: [HrController, EmployeesController],
})
export class HrModule {}
