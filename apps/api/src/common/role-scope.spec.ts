import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { pathAllowedForRole } from "./role-scope";

describe("role scope", () => {
  it("keeps the client manager to the CRM, the loyalty programme and their own login", () => {
    for (const path of ["/api/crm/today", "/api/crm", "/api/loyalty/members/abc", "/api/loyalty/analytics?from=1", "/api/auth/me"]) {
      expect(pathAllowedForRole(Role.CLIENT_MANAGER, path)).toBe(true);
    }
    for (const path of ["/api/sales", "/api/sales/summary", "/api/inventory/stock-levels", "/api/finance/pnl", "/api/dashboard/summary", "/api/crmx", "/api/users"]) {
      expect(pathAllowedForRole(Role.CLIENT_MANAGER, path)).toBe(false);
    }
  });

  it("changes nothing for every other role", () => {
    expect(pathAllowedForRole(Role.OWNER, "/api/finance/pnl")).toBe(true);
    expect(pathAllowedForRole(Role.CASHIER, "/api/sales")).toBe(true);
  });

  it("the JWT guard refuses an out-of-scope route after authentication", () => {
    const guard = new JwtAuthGuard();
    const ctx = (path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as unknown as ExecutionContext;
    const manager = { id: "u", role: Role.CLIENT_MANAGER };
    expect(guard.handleRequest(null, manager, null, ctx("/api/crm/today"))).toBe(manager);
    expect(() => guard.handleRequest(null, manager, null, ctx("/api/sales/report"))).toThrow(ForbiddenException);
    expect(guard.handleRequest(null, { id: "o", role: Role.OWNER }, null, ctx("/api/sales/report"))).toEqual({ id: "o", role: Role.OWNER });
  });
});
