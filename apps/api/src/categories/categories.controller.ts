import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PRODUCT_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("categories")
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.categoriesService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Post()
  @Roles(...PRODUCT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...PRODUCT_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @Roles(...PRODUCT_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...PRODUCT_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @Roles(...PRODUCT_MANAGE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.remove(user.organizationId, id);
  }
}
