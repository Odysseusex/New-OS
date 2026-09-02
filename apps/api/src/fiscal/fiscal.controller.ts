import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { FiscalReceipt } from "@prisma/client";
import {
  FiscalReceiptDto,
  FiscalReceiptStatus,
  FiscalReconcileResultDto,
  HARD_DELETE_ROLES,
} from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { FiscalService } from "./fiscal.service";

// Fiscal receipts are a legal/financial document, not an operational list —
// same sensitivity as FINANCE_SETUP_ROLES, so gated the same way rather than
// opened to every authenticated role by default.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...HARD_DELETE_ROLES)
@Controller("fiscal")
export class FiscalController {
  constructor(private fiscalService: FiscalService) {}

  @Get("needs-attention")
  async needsAttention(@CurrentUser() user: AuthenticatedUser): Promise<FiscalReceiptDto[]> {
    const receipts = await this.fiscalService.needsAttention(user.organizationId);
    return receipts.map(toDto);
  }

  // Retries every UNKNOWN receipt once, synchronously, and reports what
  // changed. Deliberately a POST the owner presses rather than only a
  // background cron — while the operator's shift limit and cadence are
  // still unknowns, a human-triggered check-in is the safer default.
  @Post("reconcile")
  async reconcile(@CurrentUser() user: AuthenticatedUser): Promise<FiscalReconcileResultDto> {
    // reconcile() only ever touches receipts that were UNKNOWN, so that is
    // every "before" value — no need to look it up per receipt.
    const results = await this.fiscalService.reconcile(user.organizationId);

    return {
      checked: results.length,
      resolved: results.filter((r) => r.status === FiscalReceiptStatus.REGISTERED).length,
      outcomes: results.map((r) => ({
        receiptId: r.id,
        saleId: r.saleId,
        before: FiscalReceiptStatus.UNKNOWN,
        after: r.status as FiscalReceiptStatus,
      })),
    };
  }
}

function toDto(receipt: FiscalReceipt): FiscalReceiptDto {
  return {
    id: receipt.id,
    saleId: receipt.saleId,
    status: receipt.status as FiscalReceiptStatus,
    ticketNumber: receipt.ticketNumber,
    qrCode: receipt.qrCode,
    errorMessage: receipt.errorMessage,
    attempts: receipt.attempts,
    createdAt: receipt.createdAt.toISOString(),
    registeredAt: receipt.registeredAt?.toISOString() ?? null,
  };
}
