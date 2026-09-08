import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
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

// The card half was taken on the Kaspi terminal, which already moved the
// money. The till is reporting what the terminal returned, so the server
// stores it as given — it has no way to verify it and no business refusing a
// payment that has already happened.
export class CreateSaleTerminalPaymentDto {
  @IsString()
  @MaxLength(32)
  method!: string;

  @IsString()
  @MaxLength(64)
  transactionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardMask?: string;
}

export class CreateSaleDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSaleTerminalPaymentDto)
  terminalPayment?: CreateSaleTerminalPaymentDto;

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
