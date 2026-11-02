import { CounterpartyTermsDto } from "../../debts/counterparty-terms.dto";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateSupplierDto extends CounterpartyTermsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
