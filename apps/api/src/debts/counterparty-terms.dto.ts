import { IsInt, Matches, Max, Min, ValidateIf } from "class-validator";
import { normalizeBin, PAYMENT_TERM_MAX_DAYS } from "@bakery-os/shared";

// БИН/ИИН and the payment deferral, shared by the customer and supplier forms.
// Both may be cleared with null (or an empty БИН).
export class CounterpartyTermsDto {
  @ValidateIf((o: CounterpartyTermsDto) => o.bin !== undefined && o.bin !== null && o.bin.trim() !== "")
  @Matches(/^\s*(\d\s*){12}$/, { message: "БИН/ИИН — 12 цифр" })
  bin?: string | null;

  @ValidateIf((o: CounterpartyTermsDto) => o.paymentTermDays !== undefined && o.paymentTermDays !== null)
  @IsInt({ message: "Отсрочка — целое число дней" })
  @Min(0)
  @Max(PAYMENT_TERM_MAX_DAYS, { message: `Отсрочка — не больше ${PAYMENT_TERM_MAX_DAYS} дней` })
  paymentTermDays?: number | null;
}

// What goes to the database: the БИН without spaces (empty = none); fields
// that were not sent are left out, so an edit never clears them by accident.
export function termsData(dto: { bin?: string | null; paymentTermDays?: number | null }): { bin?: string | null; paymentTermDays?: number | null } {
  return {
    ...(dto.bin !== undefined ? { bin: normalizeBin(dto.bin) } : {}),
    ...(dto.paymentTermDays !== undefined ? { paymentTermDays: dto.paymentTermDays } : {}),
  };
}
