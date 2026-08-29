import { IsDateString, IsOptional, IsString } from "class-validator";

export class GetCustomerTrendQueryDto {
  // Required, unlike the demand report's optional filter: this chart is a
  // single customer's curve, and "все клиенты" would silently fold walk-in
  // retail (customerId = null) into the same line.
  @IsString()
  customerId!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}
