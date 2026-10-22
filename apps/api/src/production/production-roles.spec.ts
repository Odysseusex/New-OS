import { INVENTORY_MANAGE_ROLES, PRODUCTION_MANAGE_ROLES, RECIPE_MANAGE_ROLES, Role } from "@bakery-os/shared";

// The operator (documents + baking in a small bakery) works production tasks, but
// gains no stock-correction or recipe-editing right from it.
describe("production roles", () => {
  it("lets the operator plan, start and complete production tasks", () => {
    expect(PRODUCTION_MANAGE_ROLES).toContain(Role.OPERATOR);
  });

  it("does not widen anything else for the operator", () => {
    expect(RECIPE_MANAGE_ROLES).not.toContain(Role.OPERATOR);
    expect(INVENTORY_MANAGE_ROLES).not.toContain(Role.OPERATOR);
  });

  it("keeps the roles that already worked", () => {
    for (const role of [Role.OWNER, Role.ADMIN, Role.PRODUCTION_MANAGER, Role.PRODUCTION_STAFF]) {
      expect(PRODUCTION_MANAGE_ROLES).toContain(role);
    }
  });
});
