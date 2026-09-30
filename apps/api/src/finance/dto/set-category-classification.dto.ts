import { IsEnum, IsOptional, IsString } from "class-validator";
import { BalanceTreatment, CashActivity, PnlTreatment } from "@bakery-os/shared";

export class SetCategoryClassificationDto {
  @IsEnum(PnlTreatment)
  pnlTreatment!: PnlTreatment;

  @IsEnum(CashActivity)
  cashActivity!: CashActivity;

  @IsEnum(BalanceTreatment)
  balanceTreatment!: BalanceTreatment;

  @IsOptional()
  @IsString()
  reason?: string;
}
