import { Body, Controller, Get, Patch, Query, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
import { DEBT_VIEW_ROLES, DebtCounterpartyKind, HARD_DELETE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { DebtsService } from "./debts.service";

class StatementQueryDto {
  @IsIn([DebtCounterpartyKind.CUSTOMER, DebtCounterpartyKind.SUPPLIER])
  kind!: DebtCounterpartyKind;

  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

class UpdateRequisitesDto {
  @IsOptional()
  @ValidateIf((o: UpdateRequisitesDto) => o.legalName !== null)
  @IsString()
  @MaxLength(200)
  legalName?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateRequisitesDto) => o.bin !== null && o.bin !== undefined && o.bin.trim() !== "")
  @Matches(/^\s*(\d\s*){12}$/, { message: "БИН/ИИН — 12 цифр" })
  bin?: string | null;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...DEBT_VIEW_ROLES)
@Controller()
export class DebtsController {
  constructor(private debts: DebtsService) {}

  @Get("debts/receivables")
  receivables(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.debts.receivables(user.organizationId, asOf);
  }

  @Get("debts/payables")
  payables(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.debts.payables(user.organizationId, asOf);
  }

  @Get("debts/statement")
  statement(@CurrentUser() user: AuthenticatedUser, @Query() q: StatementQueryDto) {
    return this.debts.statement(user.organizationId, q.kind, q.id, q.from, q.to);
  }

  @Get("organization/requisites")
  requisites(@CurrentUser() user: AuthenticatedUser) {
    return this.debts.requisites(user.organizationId);
  }

  @Patch("organization/requisites")
  @Roles(...HARD_DELETE_ROLES)
  updateRequisites(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRequisitesDto) {
    return this.debts.updateRequisites(user.organizationId, dto, user.id);
  }
}
