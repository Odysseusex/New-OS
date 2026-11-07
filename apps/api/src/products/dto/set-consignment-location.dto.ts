import { IsOptional, IsString } from "class-validator";

export class SetConsignmentLocationDto {
  // A STORE point of the organization, or null / empty for «any point».
  @IsOptional()
  @IsString()
  locationId?: string | null;
}
