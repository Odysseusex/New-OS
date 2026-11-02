import { CounterpartyTermsDto } from "../../debts/counterparty-terms.dto";
import { IsEmail, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

export class UpdateCustomerDto extends CounterpartyTermsDto {
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
  address?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;
}
