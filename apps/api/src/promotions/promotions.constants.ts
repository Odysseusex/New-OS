import { randomInt } from "node:crypto";

// Excludes 0/O, 1/I/L — the classic handwriting-and-print confusions, which
// matter here because a code is read off a printed sheet and typed by hand
// at a till, not scanned.
const COUPON_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PROMOTION_COUPON_CODE_LENGTH = 6;
// A little headroom over the generated length, for the DTO validator — never
// used as the length itself.
export const PROMOTION_COUPON_CODE_MAX_LENGTH = 16;

// One random code, e.g. "7K3PXQ". Uniqueness is enforced by the DB's
// (organizationId, code) unique index and retried by the caller on
// collision — see PromotionsService.generateCoupons.
export function generateCouponCode(): string {
  let code = "";
  for (let i = 0; i < PROMOTION_COUPON_CODE_LENGTH; i++) {
    code += COUPON_CODE_ALPHABET[randomInt(COUPON_CODE_ALPHABET.length)];
  }
  return code;
}
