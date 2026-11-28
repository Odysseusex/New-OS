import { JwtService } from "@nestjs/jwt";
import {
  CRM_ROLES,
  CRM_VIEW_ROLES,
  LOYALTY_ADMIN_ROLES,
  LOYALTY_MANAGE_ROLES,
  LOYALTY_VIEW_ROLES,
  CASH_ADJUSTMENT_ROLES,
  HARD_DELETE_ROLES,
  INVENTORY_MANAGE_ROLES,
  LEDGER_MANAGE_ROLES,
  PERIOD_CLOSE_ROLES,
  PRODUCTION_MANAGE_ROLES,
  Role,
  SALE_RETURN_ROLES,
  STOCK_VOID_ROLES,
  STOCKTAKE_APPROVE_ROLES,
  TILL_SHIFT_ROLES,
  USER_MANAGE_ROLES,
  FINANCE_VIEW_ROLES,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { pathAllowedForRole } from "../common/role-scope";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

// «Помощник»: the owner's AI assistant as a role. It does documents and reads every report through the
// API with a key; what cannot be undone is refused by the server itself, whatever a route's role list says.

const prisma = new PrismaService();
const users = new UsersService(prisma);
const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? "dev-secret-change-me" });
const auth = new AuthService(prisma, jwt);
let org: IsolatedOrg;
let assistantId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "assistant");
  const created = await users.create(org.user, { fullName: "Помощник", email: `assistant-${Date.now()}@iso.test`, password: "not-used-123", role: Role.ASSISTANT } as never);
  assistantId = created.id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const A = Role.ASSISTANT;

it("has the day-to-day rights and none of the irreversible ones", () => {
  for (const roles of [INVENTORY_MANAGE_ROLES, PRODUCTION_MANAGE_ROLES, FINANCE_VIEW_ROLES]) expect(roles).toContain(A);
  for (const roles of [
    HARD_DELETE_ROLES,
    PERIOD_CLOSE_ROLES,
    USER_MANAGE_ROLES,
    STOCK_VOID_ROLES,
    LEDGER_MANAGE_ROLES,
    CASH_ADJUSTMENT_ROLES,
    STOCKTAKE_APPROVE_ROLES,
    SALE_RETURN_ROLES,
    TILL_SHIFT_ROLES,
    LOYALTY_MANAGE_ROLES,
    LOYALTY_ADMIN_ROLES,
    CRM_ROLES,
  ]) {
    expect(roles).not.toContain(A);
  }
});

it("reads the customer base and the CRM but cannot change or message anything there", () => {
  expect(LOYALTY_VIEW_ROLES).toContain(A);
  expect(CRM_VIEW_ROLES).toContain(A);
  expect(pathAllowedForRole(A, "/api/crm/members", "GET")).toBe(true);
  expect(pathAllowedForRole(A, "/api/crm/chats/x", "GET")).toBe(true);
  expect(pathAllowedForRole(A, "/api/loyalty/analytics", "GET")).toBe(true);
  expect(pathAllowedForRole(A, "/api/crm/chats/x", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/crm/chats/broadcast", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/crm/orders/x", "PATCH")).toBe(false);
  expect(pathAllowedForRole(A, "/api/loyalty/members/x/points/adjust", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/loyalty/settings", "PATCH")).toBe(false);
});

it("the server refuses deletes, people, settings and month closing whatever the route allows", () => {
  expect(pathAllowedForRole(A, "/api/inventory/receipts/batch", "POST")).toBe(true);
  expect(pathAllowedForRole(A, "/api/production/batches/release", "POST")).toBe(true);
  expect(pathAllowedForRole(A, "/api/finance/pnl", "GET")).toBe(true);
  expect(pathAllowedForRole(A, "/api/finance/expenses", "POST")).toBe(true);
  // Reading a closed area is fine; changing it is not.
  expect(pathAllowedForRole(A, "/api/finance/periods", "GET")).toBe(true);
  expect(pathAllowedForRole(A, "/api/finance/periods/2026/10/close", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/inventory/voids", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/inventory/settings", "PUT")).toBe(false);
  expect(pathAllowedForRole(A, "/api/ledger/entries", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/locations/x", "PATCH")).toBe(false);
  // A stock count: it creates one, types the figures and sends it for review; approving stays a person's.
  expect(pathAllowedForRole(A, "/api/stocktakes", "POST")).toBe(true);
  expect(pathAllowedForRole(A, "/api/stocktakes/x/lines/y", "PUT")).toBe(true);
  expect(pathAllowedForRole(A, "/api/stocktakes/x/submit", "POST")).toBe(true);
  expect(pathAllowedForRole(A, "/api/stocktakes/x/approve", "POST")).toBe(false);
  expect(pathAllowedForRole(A, "/api/stocktakes/x/approve?opening=1", "POST")).toBe(false);
  // Nothing is ever deleted, anywhere.
  expect(pathAllowedForRole(A, "/api/products/x", "DELETE")).toBe(false);
  expect(pathAllowedForRole(A, "/api/production/batches/x", "DELETE")).toBe(false);
  // No request at all.
  for (const path of ["/api/users", "/api/clean-start/preview", "/api/backup/export", "/api/demo-company", "/api/audit", "/api/auth/till-approval"]) {
    expect(pathAllowedForRole(A, path, "GET")).toBe(false);
  }
  // Other roles are untouched by these rules.
  expect(pathAllowedForRole(Role.ADMIN, "/api/products/x", "DELETE")).toBe(true);
  expect(pathAllowedForRole(Role.CLIENT_MANAGER, "/api/sales", "GET")).toBe(false);
});

it("is let in by its current key only: no password, no old key, and the key is nobody else's", async () => {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: assistantId } });
  await expect(auth.login(row.email, "not-used-123")).rejects.toThrow(/только по ключу/);
  // A plain token (as a password login would give) is not enough.
  expect(await auth.validateUserById(assistantId)).toBeNull();

  await expect(users.issueAssistantKey(org.user, org.user.id)).rejects.toThrow(/только для роли «Помощник»/);
  const first = await users.issueAssistantKey(org.user, assistantId);
  const firstId = (jwt.decode(first.key as string) as { ak: string }).ak;
  expect((await auth.validateUserById(assistantId, firstId))?.role).toBe(A);
  expect((await users.findAllForOrganization(org.organizationId)).find((u) => u.id === assistantId)?.hasAssistantKey).toBe(true);

  // A new key makes the earlier one worthless.
  const second = await users.issueAssistantKey(org.user, assistantId);
  const secondId = (jwt.decode(second.key as string) as { ak: string }).ak;
  expect(await auth.validateUserById(assistantId, firstId)).toBeNull();
  expect((await auth.validateUserById(assistantId, secondId))?.id).toBe(assistantId);
  // The key id opens no other account.
  expect(await auth.validateUserById(org.user.id, secondId)).toBeNull();
  expect((await auth.validateUserById(org.user.id))?.id).toBe(org.user.id);

  // Revoked: nothing works until a new key is issued.
  expect(await users.issueAssistantKey(org.user, assistantId, true)).toEqual({ key: null, expiresAt: null });
  expect(await auth.validateUserById(assistantId, secondId)).toBeNull();

  const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId }, select: { action: true } })).map((a) => a.action));
  expect(AUDIT_ACTION_GROUPS.assistant.filter((a) => !logged.has(a))).toEqual([]);
});
