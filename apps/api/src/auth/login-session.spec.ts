import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { AuthService } from "./auth.service";
import { JwtPayload } from "./auth.types";
import { resetLoginThrottle } from "./login-throttle";

// Sign-in: wrong passwords are counted, and a password change ends earlier sessions.

const prisma = new PrismaService();
const jwt = new JwtService({ secret: "spec-secret", signOptions: { expiresIn: "8h" } });
const auth = new AuthService(prisma, jwt);
let org: IsolatedOrg;
const email = `session-${Math.random()}@iso.test`;
let userId: string;

beforeAll(async () => {
  await prisma.$connect();
  resetLoginThrottle();
  org = await createIsolatedOrg(prisma, "login-session");
  userId = (
    await prisma.user.create({
      data: { organizationId: org.organizationId, fullName: "Менеджер", email, passwordHash: await bcrypt.hash("first-password", 4), role: Role.STORE_MANAGER, locationId: org.storeId },
    })
  ).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const who = async (token: string) => {
  const payload = await jwt.verifyAsync<JwtPayload>(token);
  return auth.validateUserById(payload.sub, payload.ak, payload.pv);
};

describe("sign-in sessions", () => {
  it("a password change ends the sessions opened under the old password", async () => {
    const { accessToken } = await auth.login(email, "first-password", "1.1.1.1");
    expect((await who(accessToken))?.id).toBe(userId);

    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash("second-password", 4) } });
    expect(await who(accessToken)).toBeNull();

    const fresh = await auth.login(email, "second-password", "1.1.1.1");
    expect((await who(fresh.accessToken))?.id).toBe(userId);
    // A token from before this check (no stamp) still works until it runs out.
    expect((await auth.validateUserById(userId))?.id).toBe(userId);
  });

  it("ten wrong passwords lock the sign-in for that email from that address — even the right one waits", async () => {
    resetLoginThrottle();
    for (let i = 0; i < 10; i++) await expect(auth.login(email, "wrong-password", "5.5.5.5")).rejects.toThrow(/Неверный email или пароль/);
    await expect(auth.login(email, "second-password", "5.5.5.5")).rejects.toThrow(/Слишком много попыток/);
    // An unknown email answers the same way as a wrong password.
    await expect(auth.login("nobody@iso.test", "whatever-pass", "5.5.5.5")).rejects.toThrow(/Неверный email или пароль/);
    resetLoginThrottle();
  });
});
