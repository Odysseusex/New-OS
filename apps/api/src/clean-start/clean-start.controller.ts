import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsString } from "class-validator";
import { Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { NotDemoGuard } from "../common/guards/not-demo.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CleanStartService } from "./clean-start.service";

class CleanStartDto {
  @IsString()
  confirmation!: string;
}

// The owner only, never inside the sandbox (its backup cannot be downloaded there).
@UseGuards(JwtAuthGuard, RolesGuard, NotDemoGuard)
@Roles(Role.OWNER)
@Controller("clean-start")
export class CleanStartController {
  constructor(private service: CleanStartService) {}

  @Get("preview")
  preview(@CurrentUser() user: AuthenticatedUser) {
    return this.service.preview(user);
  }

  @Post()
  execute(@CurrentUser() user: AuthenticatedUser, @Body() dto: CleanStartDto) {
    return this.service.execute(user, dto.confirmation);
  }
}
