import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from "class-validator";
import { CUT_PARTS_MAX, CUT_PARTS_MIN } from "@bakery-os/shared";

export class SetCutSourceDto {
  // The whole product; null removes the link.
  @ValidateIf((dto: SetCutSourceDto) => dto.sourceProductId !== null)
  @IsString()
  sourceProductId!: string | null;

  @IsOptional()
  @IsInt()
  @Min(CUT_PARTS_MIN)
  @Max(CUT_PARTS_MAX)
  parts?: number;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
