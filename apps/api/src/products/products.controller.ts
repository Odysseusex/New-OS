import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { HARD_DELETE_ROLES, PRODUCT_FORCE_DELETE_ROLES, PRODUCT_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("products")
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.productsService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Post()
  @Roles(...PRODUCT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...PRODUCT_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @Roles(...PRODUCT_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...PRODUCT_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.remove(user.organizationId, id);
  }

  @Delete(":id/force")
  @Roles(...PRODUCT_FORCE_DELETE_ROLES)
  forceRemove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.forceRemove(user.organizationId, id);
  }
}
