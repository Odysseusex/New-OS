import { REVENUE_VIEW_ROLES, Role } from "@bakery-os/shared";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { DashboardController } from "../dashboard/dashboard.controller";
import { SalesController } from "./sales.controller";

// The operator rings up sales and works with the list of checks, but does not
// see the takings as totals — the owner's decision.

const rolesOf = (target: object, method: string): Role[] | undefined =>
  Reflect.getMetadata(ROLES_KEY, (target as Record<string, unknown>)[method] as object);

describe("revenue totals", () => {
  it("are closed to the operator and to no one else", () => {
    expect(REVENUE_VIEW_ROLES).not.toContain(Role.OPERATOR);
    expect(REVENUE_VIEW_ROLES).toHaveLength(Object.values(Role).length - 1);
    // The till's day takings: the cashier counts them against the drawer.
    expect(REVENUE_VIEW_ROLES).toContain(Role.CASHIER);
  });

  it("gate every totals route, but not the list of checks or selling", () => {
    for (const method of ["summary", "report", "profitability", "dynamics", "demandAnalysis"]) {
      expect(rolesOf(SalesController.prototype, method)).toEqual(REVENUE_VIEW_ROLES);
    }
    expect(rolesOf(DashboardController.prototype, "summary")).toEqual(REVENUE_VIEW_ROLES);
    expect(rolesOf(SalesController.prototype, "findAll")).toBeUndefined();
    expect(rolesOf(SalesController.prototype, "create")).toContain(Role.OPERATOR);
  });
});
