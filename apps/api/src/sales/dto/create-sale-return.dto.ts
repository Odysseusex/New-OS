import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

class SaleReturnItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

class RefundSplitDto {
  @IsIn(["CASH", "CARD", "TRANSFER"])
  method!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CreateSaleReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemDto)
  items!: SaleReturnItemDto[];

  @IsOptional()
  @IsString()
  reason?: string;

  // Defaults to true in the service: goods normally go back on the shelf, and
  // the cashier opts out for anything that cannot be resold.
  @IsOptional()
  @IsBoolean()
  restocked?: boolean;

  // A cashier's return carries a senior cashier's approval (ТЗ §5.4).
  @IsOptional()
  @IsString()
  approvalToken?: string;

  // Explicit override of how the refund is paid out. Left out, a refund follows
  // the original tender allocation proportionally (a mixed sale is split).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundSplitDto)
  refundSplit?: RefundSplitDto[];
}
