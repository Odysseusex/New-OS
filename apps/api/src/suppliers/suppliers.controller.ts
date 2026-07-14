import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SUPPLIER_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { SuppliersService } from "./suppliers.service";
import { CreateSupplierDto } from "./dto/create-supplier.dto";
import { UpdateSupplierDto } from "./dto/update-supplier.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("suppliers")
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) {
    return this.suppliersService.findAllForOrganization(user.organizationId, includeArchived === "true");
  }

  @Post()
  @Roles(...SUPPLIER_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...SUPPLIER_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(user.organizationId, id, dto);
  }

  @Post(":id/archive")
  @Roles(...SUPPLIER_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.suppliersService.archive(user.organizationId, id);
  }

  @Post(":id/restore")
  @Roles(...SUPPLIER_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.suppliersService.restore(user.organizationId, id);
  }

  @Delete(":id")
  @Roles(...SUPPLIER_MANAGE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.suppliersService.remove(user.organizationId, id);
  }
}
