import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { BankLineAction, BankPresetCategory } from "@bakery-os/shared";

export class ParsedBankLineInput {
  @IsString()
  @MaxLength(64)
  docNumber!: string;

  @IsDateString()
  occurredAt!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  counterpartyName!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  counterpartyBin!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  counterpartyIban!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  knp!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purpose!: string | null;
}

export class UploadBankStatementInput {
  @IsString()
  accountId!: string;

  @IsString()
  @MaxLength(100)
  bankName!: string;

  @IsOptional()
  @IsString()
  iban!: string | null;

  @IsOptional()
  @IsString()
  holderBin!: string | null;

  @IsDateString()
  periodFrom!: string;

  @IsDateString()
  periodTo!: string;

  @IsOptional()
  @IsNumber()
  openingBalance!: number | null;

  @IsOptional()
  @IsNumber()
  closingBalance!: number | null;

  @IsOptional()
  @IsString()
  fileName!: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ParsedBankLineInput)
  lines!: ParsedBankLineInput[];
}

export class PostBankLineInput {
  @IsString()
  lineId!: string;

  @IsEnum(BankLineAction)
  action!: BankLineAction;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsEnum(BankPresetCategory)
  presetCategory?: BankPresetCategory | null;

  @IsOptional()
  @IsString()
  targetAccountId?: string | null;

  @IsOptional()
  @IsString()
  supplierId?: string | null;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class PostBankLinesInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PostBankLineInput)
  lines!: PostBankLineInput[];
}
