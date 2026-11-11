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

export class ClubPushSubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @MaxLength(300)
  p256dh!: string;

  @IsString()
  @MaxLength(300)
  auth!: string;
}

export class ClubPushUnsubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}

export class ClubChatSendDto {
  @IsString()
  @MaxLength(4000)
  text!: string;
}
