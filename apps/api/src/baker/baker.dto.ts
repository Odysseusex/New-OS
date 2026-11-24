import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { BAKER_NOTE_MAX_LINES, BakerNoteKind } from "@bakery-os/shared";

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
