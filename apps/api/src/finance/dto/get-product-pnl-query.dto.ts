import { IsString } from "class-validator";
import { GetPnlQueryDto } from "./get-pnl-query.dto";

export class GetProductPnlQueryDto extends GetPnlQueryDto {
  @IsString()
  productId!: string;
}
