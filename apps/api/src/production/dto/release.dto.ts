import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { PRODUCTION_RELEASE_MAX_LINES } from "@bakery-os/shared";

export class ReleaseLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

// «Выпуск за день».
export class ReleaseDto {
  @IsString()
  locationId!: string;

  @IsOptional()
  @IsString()
  outputLocationId?: string;

  @IsArray()
  @ArrayMaxSize(PRODUCTION_RELEASE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReleaseLineDto)
  lines!: ReleaseLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReleaseLineDto)
  consumption?: ReleaseLineDto[];
}
