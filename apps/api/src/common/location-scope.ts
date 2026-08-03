import { ForbiddenException } from "@nestjs/common";
import { ORG_WIDE_ROLES } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";

/**
 * Resolves which location(s) a request is allowed to touch.
 * - Location-pinned roles (store managers, cashiers, warehouse staff, ...) are
 *   forced onto their own location; passing a different one is a 403.
 * - Org-wide roles may optionally narrow to one location via `requestedLocationId`,
 *   or omit it to see/act across the whole organization.
 * Returns `undefined` to mean "no filter — all locations in the organization".
 */
export function resolveLocationScope(
  user: AuthenticatedUser,
  requestedLocationId?: string,
): string | undefined {
  const isOrgWide = ORG_WIDE_ROLES.includes(user.role);

  if (!isOrgWide) {
    if (!user.locationId) {
      throw new ForbiddenException("Ваш аккаунт не привязан ни к одной точке");
    }
    if (requestedLocationId && requestedLocationId !== user.locationId) {
      throw new ForbiddenException("Нет доступа к данным другой точки");
    }
    return user.locationId;
  }

  return requestedLocationId;
}

/**
 * Same as resolveLocationScope, but a concrete location is mandatory
 * (used for write operations like recording a sale or a stock movement).
 */
export function requireLocationScope(
  user: AuthenticatedUser,
  requestedLocationId?: string,
): string {
  const locationId = resolveLocationScope(user, requestedLocationId);
  if (!locationId) {
    throw new ForbiddenException("Укажите точку, к которой относится операция");
  }
  return locationId;
}
