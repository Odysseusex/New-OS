import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class StartClubLoginDto {
  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsBoolean()
  consent!: boolean;

  @IsBoolean()
  marketing!: boolean;
}

export class ClubLoginStatusRequestDto {
  @IsString()
  @MaxLength(200)
  secret!: string;
}

export class UpdateClubProfileDto {
  @IsString()
  @MaxLength(60)
  name!: string;
}
