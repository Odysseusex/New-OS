import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { FIXED_ASSET_DISPOSE_ROLES, FIXED_ASSET_MANAGE_ROLES } from "@bakery-os/shared";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, Max, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FixedAssetsService } from "./fixed-assets.service";

class OpeningAssetDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  acquisitionCost!: number;

  @IsDateString()
  acquiredAt!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class RegisterFixedAssetDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  sourceExpenseId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OpeningAssetDto)
  opening?: OpeningAssetDto;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class SetTermsDto {
  @ValidateIf((_, v) => v !== null)
  @IsIn(["STRAIGHT_LINE", "NOT_DEPRECIATED"])
  method!: "STRAIGHT_LINE" | "NOT_DEPRECIATED" | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvageValue?: number;

  @IsOptional()
  @IsInt()
  startYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth?: number;
}

class DisposeDto {
  @IsDateString()
  disposedAt!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  proceeds?: number;

  @IsOptional()
  @IsString()
  accountId?: string;
}

class RunDepreciationDto {
  @IsInt()
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FIXED_ASSET_MANAGE_ROLES)
@Controller("fixed-assets")
export class FixedAssetsController {
  constructor(private service: FixedAssetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.organizationId);
  }

  @Get("unregistered-capital-expenses")
  unregistered(@CurrentUser() user: AuthenticatedUser) {
    return this.service.unregisteredCapitalExpenses(user.organizationId);
  }

  @Get("depreciation")
  depreciation(@CurrentUser() user: AuthenticatedUser, @Query("year") year?: string, @Query("month") month?: string) {
    return this.service.depreciationEntries(user.organizationId, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }

  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterFixedAssetDto) {
    return this.service.register(user, dto);
  }

  @Put(":id/terms")
  setTerms(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SetTermsDto) {
    return this.service.setTerms(user, id, dto as never);
  }

  @Post("depreciation/run")
  run(@CurrentUser() user: AuthenticatedUser, @Body() dto: RunDepreciationDto) {
    return this.service.runDepreciation(user, dto.year, dto.month);
  }

  @Post(":id/dispose")
  @Roles(...FIXED_ASSET_DISPOSE_ROLES)
  dispose(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: DisposeDto) {
    return this.service.dispose(user, id, dto);
  }
}
