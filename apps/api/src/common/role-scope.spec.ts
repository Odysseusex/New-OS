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

  it("keeps «Выдача накладных» to the day's bakers' notes", () => {
    for (const path of ["/api/auth/me", "/api/baker/day?day=2026-11-25", "/api/baker/notes/abc", "/api/baker/print-jobs/pending"]) {
      expect(pathAllowedForRole(Role.DISPATCHER, path)).toBe(true);
    }
    for (const path of ["/api/baker/intakes", "/api/baker/catalog", "/api/sales", "/api/products", "/api/finance/pnl", "/api/inventory/stock-levels", "/api/dashboard/summary"]) {
      expect(pathAllowedForRole(Role.DISPATCHER, path)).toBe(false);
    }
  });

  it("changes nothing for every other role", () => {
    expect(pathAllowedForRole(Role.OWNER, "/api/finance/pnl")).toBe(true);
    expect(pathAllowedForRole(Role.CASHIER, "/api/sales")).toBe(true);
  });

  it("refuses the till's staff what the till never calls: техкарты, purchases, finance, margins", () => {
    for (const role of [Role.CASHIER, Role.SENIOR_CASHIER]) {
      for (const path of ["/api/recipes", "/api/recipes/abc/breakdown", "/api/procurement/orders", "/api/suppliers", "/api/finance/pnl", "/api/sales/profitability", "/api/inventory/turnover", "/api/production/batches"]) {
        expect(pathAllowedForRole(role, path)).toBe(false);
      }
      for (const path of ["/api/sales", "/api/sales/abc", "/api/sales/abc/returns", "/api/products", "/api/categories", "/api/loyalty/members/lookup", "/api/till-shifts/current", "/api/auth/pin-login", "/api/promotions/coupons/lookup", "/api/locations", "/api/notifications"]) {
        expect(pathAllowedForRole(role, path, "POST")).toBe(true);
      }
    }
    expect(pathAllowedForRole(Role.STORE_MANAGER, "/api/recipes")).toBe(true);
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
