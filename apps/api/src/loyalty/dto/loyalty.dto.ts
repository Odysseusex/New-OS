import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { LoyaltyConsentChannel, LoyaltyConsentPurpose, LoyaltyConsentSource } from "@bakery-os/shared";

export class RegisterLoyaltyMemberDto {
  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsBoolean()
  personalDataConsent!: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(LoyaltyConsentChannel, { each: true })
  marketingChannels?: LoyaltyConsentChannel[];

  @IsEnum(LoyaltyConsentSource)
  source!: LoyaltyConsentSource;
}

export class UpdateLoyaltyMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class RecordLoyaltyConsentDto {
  @IsEnum(LoyaltyConsentPurpose)
  purpose!: LoyaltyConsentPurpose;

  @IsOptional()
  @IsEnum(LoyaltyConsentChannel)
  channel?: LoyaltyConsentChannel;

  @IsBoolean()
  granted!: boolean;

  @IsEnum(LoyaltyConsentSource)
  source!: LoyaltyConsentSource;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MergeLoyaltyMembersDto {
  @IsString()
  primaryId!: string;

  @IsString()
  duplicateId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class LoyaltyImportRowDto {
  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  consent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telegram?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LoyaltyImportPreviewRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => LoyaltyImportRowDto)
  rows!: LoyaltyImportRowDto[];
}

export class LoyaltyImportApplyRequestDto extends LoyaltyImportPreviewRequestDto {
  // Where the consents in the file came from (e.g. «анкеты 2025»), stored on each imported consent.
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  note!: string;
}
