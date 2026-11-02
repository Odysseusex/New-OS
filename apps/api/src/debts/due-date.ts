import { BadRequestException } from "@nestjs/common";
import { addDaysToKey, debtDateKey, PAYMENT_TERM_MAX_DAYS } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { startOfZonedDay } from "../common/zoned-day";

// A due date is a calendar day. It is stored as that day's local midnight in
// Almaty and read back as "YYYY-MM-DD" — noon UTC always falls on the same
// Almaty date, so the round trip never slips a day.
export const instantOfKey = (key: string): Date => startOfZonedDay(new Date(`${key}T12:00:00Z`));
export const dueKeyOf = (at: Date): string => debtDateKey(at);

// When a document on credit is due: the stated day, else today plus the
// counterparty's deferral, else none (the report then counts it due on its
// own date). A stated day may not be earlier than today or absurdly far off.
export async function dueDateFor(
  prisma: PrismaService,
  organizationId: string,
  counterparty: { customerId: string },
  stated: string | undefined,
  now = new Date(),
): Promise<Date | null> {
  const today = debtDateKey(now);
  if (stated) {
    if (stated < today) throw new BadRequestException("Срок оплаты не может быть раньше даты продажи");
    if (stated > addDaysToKey(today, PAYMENT_TERM_MAX_DAYS)) throw new BadRequestException("Срок оплаты — не дальше года");
    return instantOfKey(stated);
  }
  const customer = await prisma.customer.findFirst({
    where: { id: counterparty.customerId, organizationId },
    select: { paymentTermDays: true },
  });
  if (customer?.paymentTermDays === null || customer?.paymentTermDays === undefined) return null;
  return instantOfKey(addDaysToKey(today, customer.paymentTermDays));
}
