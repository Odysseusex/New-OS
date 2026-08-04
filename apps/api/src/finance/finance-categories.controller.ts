import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { FINANCE_CATEGORY_MANAGE_ROLES, FINANCE_VIEW_ROLES, FinanceCategoryKind, HARD_DELETE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FinanceCategoriesService } from "./finance-categories.service";
import { CreateFinanceCategoryDto } from "./dto/create-finance-category.dto";
import { UpdateFinanceCategoryDto } from "./dto/update-finance-category.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_VIEW_ROLES)
@Controller("finance/categories")
export class FinanceCategoriesController {
  constructor(private financeCategoriesService: FinanceCategoriesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("kind") kind?: FinanceCategoryKind,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.financeCategoriesService.findAll(user.organizationId, kind, includeArchived === "true");
  }

  @Post()
  @Roles(...FINANCE_CATEGORY_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFinanceCategoryDto) {
    return this.financeCategoriesService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...FINANCE_CATEGORY_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateFinanceCategoryDto) {
    return this.financeCategoriesService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @Roles(...FINANCE_CATEGORY_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.financeCategoriesService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...FINANCE_CATEGORY_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.financeCategoriesService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.financeCategoriesService.remove(user.organizationId, id);
  }
}
