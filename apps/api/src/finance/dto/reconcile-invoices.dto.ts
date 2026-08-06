import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNumber, IsString, Min, ValidateNested } from "class-validator";

export class ReconcileInvoiceItemDto {
  @IsString()
  invoiceId!: string;

  @IsNumber()
  @Min(0)
  amountPaid!: number;
}

export class ReconcileInvoicesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReconcileInvoiceItemDto)
  items!: ReconcileInvoiceItemDto[];
}
