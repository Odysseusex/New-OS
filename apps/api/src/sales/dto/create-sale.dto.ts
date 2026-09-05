import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested } from "class-validator";
import { PaymentMethod } from "@bakery-os/shared";

export class CreateSaleItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  // Only on a marked-down line: what it would have cost at full price.
  // SalesService checks it is actually higher than unitPrice.
  @IsOptional()
  @IsNumber()
  @Min(0)
  fullUnitPrice?: number;
}

export class CreateSalePaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // Two or more tenders adding up to the sale total. Absent for an ordinary
  // single-method sale.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments?: CreateSalePaymentDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];
}
