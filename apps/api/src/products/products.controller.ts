import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PRODUCT_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("products")
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.productsService.findAllForOrganization(user.organizationId);
  }

  @Post()
  @Roles(...PRODUCT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.organizationId, dto);
  }
}
