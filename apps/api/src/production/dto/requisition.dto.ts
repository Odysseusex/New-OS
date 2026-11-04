import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { MATERIAL_REQUISITION_MAX_LINES } from "@bakery-os/shared";

export class RequisitionLineInput {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  requiredQuantity?: number | null;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class UpdateRequisitionInput {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMaxSize(MATERIAL_REQUISITION_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineInput)
  lines!: RequisitionLineInput[];
}

export class CreateRequisitionInput extends UpdateRequisitionInput {
  @IsString()
  fromLocationId!: string;

  @IsString()
  toLocationId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  planDate!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  batchIds?: string[];
}

export class CreateTransferInput extends UpdateRequisitionInput {
  @IsString()
  fromLocationId!: string;

  @IsString()
  toLocationId!: string;
}
