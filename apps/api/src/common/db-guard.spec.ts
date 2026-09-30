import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertSafeTestDatabase, resolveDatabaseUrl } from "../../test/support/db-guard";

describe("test database host guard", () => {
  const local = "postgresql://postgres:postgres@localhost:5432/bakery_os";
  const neon = "postgresql://user:pw@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require";

  it("allows a local database", () => {
    expect(assertSafeTestDatabase(local, {})).toEqual({ host: "localhost" });
    expect(assertSafeTestDatabase("postgresql://u:p@127.0.0.1:5432/x", {}).host).toBe("127.0.0.1");
  });

  it("refuses a Neon (or any remote) host by default", () => {
    expect(() => assertSafeTestDatabase(neon, {})).toThrow(/non-local database host "ep-cool-name-123456/);
  });

  it("allows a remote host only when that exact host is named", () => {
    const host = "ep-cool-name-123456.eu-central-1.aws.neon.tech";
    expect(assertSafeTestDatabase(neon, { TEST_DATABASE_ALLOWED_HOST: host }).host).toBe(host);
    // A different branch, a suffix or a wildcard is not the named host.
    expect(() => assertSafeTestDatabase(neon, { TEST_DATABASE_ALLOWED_HOST: "neon.tech" })).toThrow();
    expect(() => assertSafeTestDatabase(neon, { TEST_DATABASE_ALLOWED_HOST: "*" })).toThrow();
    expect(() => assertSafeTestDatabase(neon, { TEST_DATABASE_ALLOWED_HOST: "ep-other.neon.tech" })).toThrow();
  });

  it("refuses NODE_ENV=production even for a local database", () => {
    expect(() => assertSafeTestDatabase(local, { NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
  });

  it("refuses a missing or unparseable URL instead of guessing", () => {
    expect(() => assertSafeTestDatabase(undefined, {})).toThrow(/not set/);
    expect(() => assertSafeTestDatabase("not a url", {})).toThrow(/not a valid URL/);
  });

  it("resolves the URL the way Prisma does: environment first, then .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "dbguard-"));
    mkdirSync(join(dir, "prisma"));
    writeFileSync(join(dir, ".env"), 'OTHER=1\nDATABASE_URL="postgresql://a:b@from-file:5432/x"\n');
    const saved = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(resolveDatabaseUrl(dir)).toBe("postgresql://a:b@from-file:5432/x");
      process.env.DATABASE_URL = "postgresql://a:b@from-env:5432/x";
      expect(resolveDatabaseUrl(dir)).toBe("postgresql://a:b@from-env:5432/x");
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });

  it("is actually active in this run (setupFiles pinned a local URL)", () => {
    expect(new URL(process.env.DATABASE_URL!).hostname).toBe("localhost");
  });
});
