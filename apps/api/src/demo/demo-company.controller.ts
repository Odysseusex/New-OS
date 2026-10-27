import { Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { DEMO_COMPANY_ROLES, DemoCompanyCredentialsDto, DemoCompanyStatusDto } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { DemoCompanyService } from "./demo-company.service";

// Настройки → «Песочница». Owner only, like «Скачать все данные».
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...DEMO_COMPANY_ROLES)
@Controller("demo-company")
export class DemoCompanyController {
  constructor(private demo: DemoCompanyService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser): Promise<DemoCompanyStatusDto> {
    return this.demo.status(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser): Promise<DemoCompanyCredentialsDto> {
    return this.demo.create(user);
  }

  @Post("password")
  resetPassword(@CurrentUser() user: AuthenticatedUser): Promise<DemoCompanyCredentialsDto> {
    return this.demo.resetPassword(user);
  }

  @Delete()
  remove(@CurrentUser() user: AuthenticatedUser): Promise<{ deleted: true }> {
    return this.demo.remove(user);
  }
}
