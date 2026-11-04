import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductPhotoController, ProductsController } from "./products.controller";

@Module({
  providers: [ProductsService],
  controllers: [ProductsController, ProductPhotoController],
  exports: [ProductsService],
})
export class ProductsModule {}
