import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  HARD_DELETE_ROLES,
  PRODUCT_FORCE_DELETE_ROLES,
  PRODUCT_MANAGE_ROLES,
  SALE_CREATE_ROLES,
} from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { SetLocationPriceDto } from "./dto/set-location-price.dto";
import { SetProductPhotoDto } from "./dto/set-product-photo.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("products")
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("includeArchived") includeArchived?: string,
    // Optional: resolves each product's effectivePrice against this point of
    // sale. The till always passes it.
    @Query("locationId") locationId?: string,
  ) {
    return this.productsService.findAllForOrganization(
      user.organizationId,
      includeArchived === "true",
      locationId || undefined,
    );
  }

  // Prices charged at one point of sale. Read is open to any authenticated
  // role, like the rest of the catalogue; changing a price is a manage
  // action.
  @Get("location-prices/:locationId")
  locationPrices(@CurrentUser() user: AuthenticatedUser, @Param("locationId") locationId: string) {
    return this.productsService.locationPrices(user.organizationId, locationId);
  }

  @Put("location-prices/:locationId/:productId")
  @Roles(...PRODUCT_MANAGE_ROLES)
  setLocationPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("locationId") locationId: string,
    @Param("productId") productId: string,
    @Body() dto: SetLocationPriceDto,
  ) {
    return this.productsService.setLocationPrice(user.organizationId, locationId, productId, dto.price, user.id);
  }

  @Delete("location-prices/:locationId/:productId")
  @Roles(...PRODUCT_MANAGE_ROLES)
  clearLocationPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("locationId") locationId: string,
    @Param("productId") productId: string,
  ) {
    return this.productsService.clearLocationPrice(user.organizationId, locationId, productId, user.id);
  }

  // The till needs this row to ring up an item that is not in the catalogue
  // yet, so it is gated to whoever may sell — not to PRODUCT_MANAGE_ROLES —
  // even though it can create a product. It creates exactly one, once, and
  // returns the same one forever after.
  @Get("open-price")
  @Roles(...SALE_CREATE_ROLES)
  openPrice(@CurrentUser() user: AuthenticatedUser) {
    return this.productsService.getOrCreateOpenPrice(user.organizationId);
  }

  @Post()
  @Roles(...PRODUCT_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(...PRODUCT_MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user.organizationId, id, dto, user.id);
  }

  @Post(":id/archive")
  @Roles(...PRODUCT_MANAGE_ROLES)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.archive(user.organizationId, id, user.id);
  }

  @Post(":id/restore")
  @Roles(...PRODUCT_MANAGE_ROLES)
  restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.restore(user.organizationId, id, user.id);
  }

  // Photo for the till tile: the browser sends it already resized, as a data URL.
  @Put(":id/photo")
  @Roles(...PRODUCT_MANAGE_ROLES)
  setPhoto(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SetProductPhotoDto) {
    return this.productsService.setPhoto(user.organizationId, id, dto.dataUrl, user.id);
  }

  @Delete(":id/photo")
  @Roles(...PRODUCT_MANAGE_ROLES)
  removePhoto(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.removePhoto(user.organizationId, id, user.id);
  }

  @Delete(":id")
  @Roles(...HARD_DELETE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.remove(user.organizationId, id, user.id);
  }

  @Delete(":id/force")
  @Roles(...PRODUCT_FORCE_DELETE_ROLES)
  forceRemove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.forceRemove(user.organizationId, id, user.id);
  }
}

// The picture itself, WITHOUT a login: an <img> cannot send a token, and the
// browser should keep it (the address carries `?v=` = its last change, so a new
// photo is a new address). A product picture is not sensitive.
@Controller("products")
export class ProductPhotoController {
  constructor(private productsService: ProductsService) {}

  @Get(":id/photo")
  async photo(@Param("id") id: string, @Res() res: Response) {
    const photo = await this.productsService.photo(id);
    if (!photo) throw new NotFoundException("Фото нет");
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(photo.bytes);
  }
}
