import { join } from "path";
import { assertSafeTestDatabase, resolveDatabaseUrl } from "./db-guard";

// Jest `setupFiles` entry: runs before every test file, before any Prisma
// client exists. Pinning the checked URL into process.env guarantees the
// client connects to exactly the database that was checked.
const url = resolveDatabaseUrl(join(__dirname, "..", ".."));
assertSafeTestDatabase(url, process.env);
process.env.DATABASE_URL = url;
