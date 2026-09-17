import { Module } from "@nestjs/common";
import { HrService } from "./hr.service";
import { HrController } from "./hr.controller";
import { EmployeesService } from "./employees.service";
import { EmployeesController } from "./employees.controller";

@Module({
  providers: [HrService, EmployeesService],
  controllers: [HrController, EmployeesController],
  // Exported for the AI business context, which projects getKpi() rather
  // than recomputing per-employee sales and production a second way.
  exports: [HrService],
})
export class HrModule {}
