import { ArrayMinSize, IsArray, IsString, MinLength } from "class-validator";

export class PreviewStockVoidDto {
  @IsString()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  movementIds!: string[];
}

export class CreateStockVoidDto extends PreviewStockVoidDto {
  @IsString()
  @MinLength(5)
  reason!: string;
}
