import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  JournalEntryKind,
  JournalListQuery,
  LEDGER_MANAGE_ROLES,
  LEDGER_SETUP_ROLES,
  LEDGER_VIEW_ROLES,
  LedgerAccountType,
} from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { LedgerService } from "./ledger.service";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerDiagnosticsService } from "./ledger-diagnostics.service";
import {
  CreateLedgerAccountDto,
  EnableLedgerDto,
  ManualJournalEntryDto,
  OpeningBalanceDto,
  ReverseEntryDto,
  UpdateLedgerAccountDto,
} from "./dto/ledger.dto";

const date = (value: string | undefined, fallback?: Date): Date => {
  if (!value) {
    if (fallback) return fallback;
    throw new BadRequestException("Укажите дату");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Неверная дата");
  return d;
};

// Every query is scoped by the caller's organization inside the services: an id
// from another organization simply is not found.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...LEDGER_VIEW_ROLES)
@Controller("ledger")
export class LedgerController {
  constructor(
    private ledger: LedgerService,
    private reports: LedgerReportsService,
    private diagnostics: LedgerDiagnosticsService,
  ) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.getStatus(user.organizationId);
  }

  @Roles(...LEDGER_SETUP_ROLES)
  @Post("system-accounts")
  initSystemAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.initializeSystemAccounts(user);
  }

  @Roles(...LEDGER_SETUP_ROLES)
  @Post("enable")
  enable(@CurrentUser() user: AuthenticatedUser, @Body() body: EnableLedgerDto) {
    return this.ledger.enable(user, body);
  }

  // ── chart of accounts ──
  @Get("accounts")
  accounts(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.listAccounts(user.organizationId);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Post("accounts")
  createAccount(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateLedgerAccountDto) {
    return this.ledger.createAccount(user, body);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Patch("accounts/:id")
  updateAccount(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: UpdateLedgerAccountDto) {
    return this.ledger.updateAccount(user, id, body);
  }

  @Get("accounts/:id/ledger")
  accountLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
  ) {
    return this.ledger.getAccountLedger(user.organizationId, id, { from, to, locationId });
  }

  // ── journal ──
  @Get("entries")
  entries(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("accountId") accountId?: string,
    @Query("kind") kind?: string,
    @Query("sourceType") sourceType?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const query: JournalListQuery = {
      from,
      to,
      accountId,
      sourceType,
      kind: kind ? (kind as JournalEntryKind) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    };
    return this.ledger.listEntries(user.organizationId, query);
  }

  @Get("entries/:id")
  entry(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ledger.getEntry(user.organizationId, id);
  }

  @Get("trace/:sourceType/:sourceId")
  trace(@CurrentUser() user: AuthenticatedUser, @Param("sourceType") sourceType: string, @Param("sourceId") sourceId: string) {
    return this.ledger.tracesForSource(user.organizationId, sourceType, sourceId);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Post("entries")
  postManual(@CurrentUser() user: AuthenticatedUser, @Body() body: ManualJournalEntryDto) {
    return this.ledger.postManual(user, body);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Post("entries/:id/reverse")
  reverse(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: ReverseEntryDto) {
    return this.ledger.reverse(user, id, body.reason);
  }

  // ── opening balance & catching up ──
  @Get("opening/proposal")
  openingProposal(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.proposeOpening(user.organizationId);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Post("opening")
  postOpening(@CurrentUser() user: AuthenticatedUser, @Body() body: OpeningBalanceDto) {
    return this.ledger.postOpening(user, body);
  }

  @Roles(...LEDGER_MANAGE_ROLES)
  @Post("post-pending")
  postPending(@CurrentUser() user: AuthenticatedUser) {
    return this.ledger.postPending(user);
  }

  // ── books and statements ──
  @Get("trial-balance")
  trialBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
    @Query("accountType") accountType?: string,
  ) {
    return this.ledger.getTrialBalance(user.organizationId, { from, to, locationId, accountType: accountType as LedgerAccountType | undefined });
  }

  @Get("reports/pnl")
  pnl(@CurrentUser() user: AuthenticatedUser, @Query("from") from: string, @Query("to") to: string, @Query("locationId") locationId?: string) {
    return this.reports.getPnl(user.organizationId, date(from), date(to, new Date()), locationId);
  }

  @Get("reports/balance")
  balance(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.reports.getBalanceSheet(user.organizationId, date(asOf, new Date()));
  }

  @Get("reports/cash-flow")
  cashFlow(@CurrentUser() user: AuthenticatedUser, @Query("from") from: string, @Query("to") to: string) {
    return this.reports.getCashFlow(user.organizationId, date(from), date(to, new Date()));
  }

  @Get("reports/pnl-reconciliation")
  pnlReconciliation(@CurrentUser() user: AuthenticatedUser, @Query("from") from: string, @Query("to") to: string) {
    return this.reports.reconcilePnl(user.organizationId, date(from), date(to, new Date()));
  }

  // ── diagnostics ──
  @Get("diagnostics")
  runDiagnostics(@CurrentUser() user: AuthenticatedUser) {
    return this.diagnostics.run(user.organizationId);
  }

  @Get("coverage")
  coverage(@CurrentUser() user: AuthenticatedUser) {
    return this.diagnostics.coverage(user.organizationId);
  }
}
