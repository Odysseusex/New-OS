import { createHmac } from "crypto";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { Role, TILL_APPROVER_ROLES, TILL_PIN_PATTERN, TillApprovalAction } from "@bakery-os/shared";
import { AuthenticatedUser } from "./auth.types";

// Till PINs and the senior cashier's approval (ТЗ §5.4).
//
// A PIN is stored only as an HMAC digest keyed by the server's secret, unique per
// organization, so «the PIN alone says who it is» is a plain indexed lookup and
// the database never holds anything a PIN can be read back from.
//
// An approval is a short JWT signed with a DIFFERENT key from the login tokens,
// so it can never be presented as a login. It names the action, the cashier who
// asked and the approver, and expires in minutes.

type Db = { user: Prisma.TransactionClient["user"] };

const baseSecret = () => process.env.JWT_SECRET ?? "dev-secret-change-me";
const approvalJwt = () => new JwtService({ secret: `${baseSecret()}:till-approval` });
const APPROVAL_TTL = "10m";

export function assertPinFormat(pin: string): void {
  if (!TILL_PIN_PATTERN.test(pin)) throw new BadRequestException("PIN — от 4 до 6 цифр");
}

export function pinDigest(organizationId: string, pin: string): string {
  return createHmac("sha256", `${baseSecret()}:till-pin`).update(`${organizationId}:${pin}`).digest("hex");
}

// Wrong PINs in a row per organization + device user: 5 within 5 minutes locks for 5 minutes.
const failures = new Map<string, number[]>();
const WINDOW_MS = 5 * 60_000;
const LIMIT = 5;

function checkThrottle(key: string): void {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  if (recent.length >= LIMIT) throw new ForbiddenException("Слишком много неверных PIN — подождите 5 минут");
}
function noteFailure(key: string): void {
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}
function clearFailures(key: string): void {
  failures.delete(key);
}

export async function findUserByPin(db: Db, actor: AuthenticatedUser, pin: string) {
  const key = `${actor.organizationId}:${actor.id}`;
  checkThrottle(key);
  if (!TILL_PIN_PATTERN.test(pin)) {
    noteFailure(key);
    throw new UnauthorizedException("Неверный PIN");
  }
  const found = await db.user.findFirst({ where: { organizationId: actor.organizationId, pinDigest: pinDigest(actor.organizationId, pin), isActive: true } });
  if (!found) {
    noteFailure(key);
    throw new UnauthorizedException("Неверный PIN");
  }
  clearFailures(key);
  return found;
}

export async function signTillApproval(
  db: Db,
  actor: AuthenticatedUser,
  pin: string,
  action: TillApprovalAction,
  locationId?: string,
): Promise<{ approvalToken: string; approver: { id: string; fullName: string } }> {
  const approver = await findUserByPin(db, actor, pin);
  if (!TILL_APPROVER_ROLES.includes(approver.role as Role)) {
    throw new ForbiddenException("Этот PIN не у старшего кассира — подтвердить нельзя");
  }
  const at = locationId ?? actor.locationId ?? null;
  if (approver.locationId && at && approver.locationId !== at) {
    throw new ForbiddenException("Старший кассир другой точки не может подтвердить");
  }
  const approvalToken = await approvalJwt().signAsync(
    { typ: "till-approval", act: action, sub: approver.id, org: actor.organizationId, by: actor.id },
    { expiresIn: APPROVAL_TTL },
  );
  return { approvalToken, approver: { id: approver.id, fullName: approver.fullName } };
}

// Who approved `action` for `user`. A senior cashier / manager approves themselves.
export async function resolveTillApproval(
  db: Db,
  user: AuthenticatedUser,
  action: TillApprovalAction,
  token: string | undefined,
): Promise<{ id: string; fullName: string }> {
  if (TILL_APPROVER_ROLES.includes(user.role)) return { id: user.id, fullName: user.fullName };
  if (!token) throw new ForbiddenException("Нужно подтверждение старшего кассира");
  let payload: { typ?: string; act?: string; sub?: string; org?: string; by?: string };
  try {
    payload = await approvalJwt().verifyAsync(token);
  } catch {
    throw new ForbiddenException("Подтверждение старшего кассира устарело — введите PIN ещё раз");
  }
  if (payload.typ !== "till-approval" || payload.act !== action || payload.org !== user.organizationId || payload.by !== user.id || !payload.sub) {
    throw new ForbiddenException("Подтверждение старшего кассира не подходит");
  }
  const approver = await db.user.findFirst({ where: { id: payload.sub, organizationId: user.organizationId, isActive: true } });
  if (!approver || !TILL_APPROVER_ROLES.includes(approver.role as Role)) throw new ForbiddenException("Подтверждение старшего кассира не подходит");
  return { id: approver.id, fullName: approver.fullName };
}

// For specs: forget wrong-PIN counts.
export function resetPinThrottle(): void {
  failures.clear();
}
