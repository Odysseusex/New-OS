import { ForbiddenException } from "@nestjs/common";
import { SHARED_TILL_MESSAGE } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";

// The point's shared till login opens the till but never sells, returns or runs a shift: every such
// document must carry the person who made it (owner, 23.11.2026). The cashier switches with her PIN.
export function assertPersonalTill(user: AuthenticatedUser): void {
  if (user.sharedTill) throw new ForbiddenException(SHARED_TILL_MESSAGE);
}
