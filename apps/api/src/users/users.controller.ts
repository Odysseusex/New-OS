import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { USER_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { UsersService } from "./users.service";
import { CreateUserAccountDto } from "./dto/create-user-account.dto";
import { UpdateUserAccountDto } from "./dto/update-user-account.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...USER_MANAGE_ROLES)
@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.usersService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserAccountDto) {
    return this.usersService.create(user, dto);
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateUserAccountDto) {
    return this.usersService.update(user, id, dto);
  }

  @Post(":id/archive")
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.usersService.archive(user, id);
  }

  @Post(":id/restore")
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.usersService.restore(user, id);
  }
}
