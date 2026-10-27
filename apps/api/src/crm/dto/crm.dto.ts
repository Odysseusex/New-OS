import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { CrmContactChannel, CrmContactOutcome, CrmContactReason, CrmOrderStage } from "@bakery-os/shared";

export class CreateCrmContactDto {
  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsEnum(CrmContactChannel)
  channel!: CrmContactChannel;

  @IsEnum(CrmContactOutcome)
  outcome!: CrmContactOutcome;

  @IsEnum(CrmContactReason)
  reason!: CrmContactReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SaveCrmOrderDto {
  @IsOptional()
  @IsString()
  memberId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string | null;

  @IsOptional()
  @IsNumber()
  weightKg?: number | null;

  @IsOptional()
  @IsNumber()
  price?: number | null;

  @IsOptional()
  @IsBoolean()
  prepaid?: boolean;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(CrmOrderStage)
  stage?: CrmOrderStage;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string | null;
}
