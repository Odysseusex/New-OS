import { ForbiddenException } from "@nestjs/common";
import { TILL_ROLES } from "@bakery-os/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";

// When the organization requires it, a cashier sells only inside an open shift at that point.
export async function assertTillShiftOpen(prisma: PrismaService | Prisma.TransactionClient, user: AuthenticatedUser, locationId: string): Promise<void> {
  if (!TILL_ROLES.includes(user.role)) return;
  const org = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { tillShiftsRequired: true } });
  if (!org?.tillShiftsRequired) return;
  const open = await prisma.tillShift.findFirst({ where: { organizationId: user.organizationId, locationId, closedAt: null }, select: { id: true } });
  if (!open) throw new ForbiddenException("Смена не открыта — откройте смену на кассе");
}
