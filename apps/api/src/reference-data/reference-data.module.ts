import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { CustomersModule } from "../customers/customers.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ReferenceDataController } from "./reference-data.controller";
import { ReferenceDataService } from "./reference-data.service";

@Module({
  imports: [ProductsModule, CustomersModule, SuppliersModule],
  providers: [ReferenceDataService],
  controllers: [ReferenceDataController],
})
export class ReferenceDataModule {}
