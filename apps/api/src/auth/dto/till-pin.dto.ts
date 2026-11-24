import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { TillApprovalAction } from "@bakery-os/shared";

export class PinLoginDto {
  @IsString()
  @MaxLength(12)
  pin!: string;
}

export class TillApprovalBodyDto {
  @IsString()
  @MaxLength(12)
  pin!: string;

  @IsIn(["DISCOUNT", "RETURN", "LINE_REMOVAL", "WELCOME_BONUS"])
  action!: TillApprovalAction;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detail?: string;
}

export class SetUserPinDto {
  @IsOptional()
  @IsString()
  @MaxLength(12)
  pin!: string | null;
}

export class BakerPinLoginDto {
  @IsString()
  @MaxLength(1000)
  deviceToken!: string;

  @IsString()
  @MaxLength(12)
  pin!: string;
}
