import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { HARD_DELETE_ROLES, PRODUCT_MANAGE_ROLES } from "@bakery-os/shared";
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

  // The starting catalogue, offered not forced: preview what it would add, then
  // apply. Owner/admin only — it adds dozens of categories in one go.
  @Get("standard-catalog")
  @Roles(...HARD_DELETE_ROLES)
  previewStandardCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.previewStandardCatalog(user.organizationId);
  }

  @Post("standard-catalog")
  @Roles(...HARD_DELETE_ROLES)
  applyStandardCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.applyStandardCatalog(user.organizationId, user.id);
  }

  @Post()
  @Roles(...PRODUCT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...PRODUCT_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(user.organizationId, id, dto, user.id);
  }

  @Post(":id/archive")
  @Roles(...PRODUCT_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.archive(user.organizationId, id, user.id);
  }

  @Post(":id/restore")
  @Roles(...PRODUCT_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.restore(user.organizationId, id, user.id);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.categoriesService.remove(user.organizationId, id, user.id);
  }
}
