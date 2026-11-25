import { Role, TILL_ROLES } from "@bakery-os/shared";

// Roles whose whole job is one part of the app. For them the server refuses
// every other route — not only the screen: most GET routes here are open to
// any signed-in role, so hiding a menu alone would still let a direct request
// read sales or stock. Prefixes are paths after the global "/api".
export const ROLE_API_SCOPE: Partial<Record<Role, string[]>> = {
  [Role.CLIENT_MANAGER]: ["/auth", "/crm", "/loyalty"],
  // The door laptop: the day's bakers' notes only (reading; every write route there is gated to other roles).
  [Role.DISPATCHER]: ["/auth", "/baker/day", "/baker/notes", "/baker/print-jobs"],
};

// The till's own staff (cashier, senior cashier) are kept on /pos by the screen, but a login token
// is a login token: asked directly, the server used to hand a cashier the техкарты, purchase prices,
// margins and suppliers (security review, 25.11.2026). These areas the till never calls, so they are
// refused for till roles here. A deny-list on purpose: a till call missed by an allow-list would
// stop sales at the counter.
export const TILL_REFUSED_PREFIXES = [
  "/recipes",
  "/recipe-stage-types",
  "/procurement",
  "/suppliers",
  "/invoices",
  "/finance",
  "/ledger",
  "/production",
  "/planning",
  "/debts",
  "/bank-statements",
  "/fixed-assets",
  "/consignment",
  "/reference-data",
  "/distribution",
  "/crm",
  "/hr/employees",
  "/sales/profitability",
  "/sales/report",
  "/sales/summary",
  "/sales/dynamics",
  "/sales/demand",
  "/inventory/turnover",
  "/dashboard",
];

// Roles kept out of the staff Telegram bot, which reads stock, sales and
// finance through the services directly.
export const STAFF_BOT_EXCLUDED_ROLES: Role[] = [Role.CLIENT_MANAGER, Role.ASSISTANT, Role.DISPATCHER];

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
  if ((TILL_ROLES as readonly Role[]).includes(role) && under(clean, TILL_REFUSED_PREFIXES)) return false;
  const scope = ROLE_API_SCOPE[role];
  if (!scope) return true;
  return under(clean, scope);
}
