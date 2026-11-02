import { Role } from "@bakery-os/shared";

// Roles whose whole job is one part of the app. For them the server refuses
// every other route — not only the screen: most GET routes here are open to
// any signed-in role, so hiding a menu alone would still let a direct request
// read sales or stock. Prefixes are paths after the global "/api".
export const ROLE_API_SCOPE: Partial<Record<Role, string[]>> = {
  [Role.CLIENT_MANAGER]: ["/auth", "/crm", "/loyalty"],
};

// Roles kept out of the staff Telegram bot, which reads stock, sales and
// finance through the services directly.
export const STAFF_BOT_EXCLUDED_ROLES: Role[] = [Role.CLIENT_MANAGER];

export function pathAllowedForRole(role: Role, path: string): boolean {
  const scope = ROLE_API_SCOPE[role];
  if (!scope) return true;
  const clean = path.split("?")[0].replace(/^\/api(?=\/|$)/, "") || "/";
  return scope.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}
