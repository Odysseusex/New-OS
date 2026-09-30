import { existsSync, readFileSync } from "fs";
import { join } from "path";

// The API's specs write real rows (sales, cash movements, stock). They must
// never reach the production database. This guard runs before every test file
// (jest `setupFiles`) and refuses to continue unless the database is local.
//
// A non-local host is allowed ONLY when TEST_DATABASE_ALLOWED_HOST names that
// exact host — e.g. a throwaway Neon branch created for a rehearsal. There is
// no wildcard and no "allow everything" switch, and NODE_ENV=production is
// refused outright.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSafeTestDatabase(
  databaseUrl: string | undefined,
  env: { NODE_ENV?: string; TEST_DATABASE_ALLOWED_HOST?: string },
): { host: string } {
  if (env.NODE_ENV === "production") {
    throw new Error("[db-guard] Refusing to run tests with NODE_ENV=production.");
  }
  if (!databaseUrl) {
    throw new Error("[db-guard] DATABASE_URL is not set — refusing to guess which database the tests would write to.");
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("[db-guard] DATABASE_URL is not a valid URL — refusing to run tests.");
  }
  if (!host) {
    throw new Error("[db-guard] DATABASE_URL has no host — refusing to run tests.");
  }
  if (LOCAL_HOSTS.has(host)) return { host };

  const allowed = env.TEST_DATABASE_ALLOWED_HOST?.trim();
  if (allowed && allowed === host) return { host };

  throw new Error(
    `[db-guard] Refusing to run tests against non-local database host "${host}". ` +
      "Tests write real data. To run them against a throwaway database branch, set " +
      "TEST_DATABASE_ALLOWED_HOST to exactly that host. Never point it at production.",
  );
}

// Resolves the URL the Prisma client will actually use: an environment
// variable wins over apps/api/.env (Prisma never overrides an existing env var).
export function resolveDatabaseUrl(apiRoot: string): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [join(apiRoot, ".env"), join(apiRoot, "prisma", ".env")]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) return match[1].trim();
  }
  return undefined;
}
