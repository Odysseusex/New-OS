import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { STANDING_ORDER_MAX_LINES } from "@bakery-os/shared";

export class StandingOrderLineInput {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;
}

export class SaveStandingOrderDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsArray()
  @ArrayMaxSize(STANDING_ORDER_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StandingOrderLineInput)
  lines!: StandingOrderLineInput[];
}
