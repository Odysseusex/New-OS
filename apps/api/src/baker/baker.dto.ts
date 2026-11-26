import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { BAKER_NOTE_MAX_LINES, BakerNoteKind, PRINT_JOB_MAX_NOTES, SUPPLIER_INTAKE_PHOTO_MAX_CHARS, SupplierIntakePayment, SupplierIntakeStatus } from "@bakery-os/shared";

export class BakerNoteLineInput {
  @IsString()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;
}

export class SaveBakerNoteInput {
  @IsEnum(BakerNoteKind)
  kind!: BakerNoteKind;

  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsArray()
  @ArrayMaxSize(BAKER_NOTE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => BakerNoteLineInput)
  lines!: BakerNoteLineInput[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}

export class BakerDayPostInput {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Дата — в формате ГГГГ-ММ-ДД" })
  day!: string;

  @IsString()
  sourceLocationId!: string;

  @IsString()
  @MaxLength(64)
  signature!: string;
}

export class CreateSupplierIntakeInput {
  @IsString()
  locationId!: string;

  @IsEnum(SupplierIntakePayment)
  payment!: SupplierIntakePayment;

  @IsOptional()
  @IsString()
  paymentAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}

export class AddIntakePhotoInput {
  @IsString()
  @MaxLength(SUPPLIER_INTAKE_PHOTO_MAX_CHARS)
  dataUrl!: string;
}

export class ResolveSupplierIntakeInput {
  @IsIn([SupplierIntakeStatus.POSTED, SupplierIntakeStatus.REJECTED])
  status!: SupplierIntakeStatus.POSTED | SupplierIntakeStatus.REJECTED;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CreatePrintJobInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_JOB_MAX_NOTES)
  @IsString({ each: true })
  noteIds!: string[];

  @IsBoolean()
  pack!: boolean;
}

export class MarkNotesPrintedInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  noteIds!: string[];
}
