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
export const STAFF_BOT_EXCLUDED_ROLES: Role[] = [Role.CLIENT_MANAGER, Role.ASSISTANT];

// «Помощник» (the owner's AI assistant) does documents and reads reports. What cannot be undone, and
// everything about people, access and settings, is refused HERE as well as by each route's own roles —
// so a route added later with too wide a role list still cannot be reached by it.
//   · nothing is ever deleted (DELETE anywhere);
//   · `closed`: no request at all; `readOnly`: reading only;
//   · `refusedActions`: single routes refused inside an area it otherwise works in. Stock counts
//     (owner, 24.11.2026): it creates a count, types the figures in and sends it for review, but
//     «Провести» sets the whole shelf at once and stays a person's press on the screen.
export const ASSISTANT_REFUSALS = {
  closed: ["/users", "/clean-start", "/backup", "/demo-company", "/fiscal", "/audit", "/telegram", "/club", "/auth/pin-login", "/auth/till-approval", "/auth/baker-device", "/auth/baker-pin"],
  readOnly: [
    "/finance/periods",
    "/finance/setup",
    "/finance/policy",
    "/procurement/workflow",
    "/ledger",
    "/inventory/voids",
    "/inventory/settings",
    "/locations",
    "/directions",
    "/hr",
    "/loyalty",
    "/crm",
    "/promotions",
    "/till-shifts",
    "/classification",
    "/fixed-assets",
    "/planning",
    "/vehicles",
    "/logistics",
  ],
  refusedActions: [/^\/stocktakes\/[^/]+\/approve$/],
};

const under = (clean: string, prefixes: string[]) => prefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));

export function pathAllowedForRole(role: Role, path: string, method = "GET"): boolean {
  const clean = path.split("?")[0].replace(/^\/api(?=\/|$)/, "") || "/";
  if (role === Role.ASSISTANT) {
    const reading = method.toUpperCase() === "GET";
    if (method.toUpperCase() === "DELETE") return false;
    if (under(clean, ASSISTANT_REFUSALS.closed)) return false;
    if (!reading && under(clean, ASSISTANT_REFUSALS.readOnly)) return false;
    if (!reading && ASSISTANT_REFUSALS.refusedActions.some((route) => route.test(clean))) return false;
    return true;
  }
  const scope = ROLE_API_SCOPE[role];
  if (!scope) return true;
  return under(clean, scope);
}
