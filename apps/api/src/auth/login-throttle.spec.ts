import { HttpException } from "@nestjs/common";
import { assertLoginAllowed, noteLoginFailure, resetLoginThrottle } from "./login-throttle";

describe("sign-in attempt limit", () => {
  beforeEach(() => resetLoginThrottle());

  it("refuses the 11th try for one email from one address, whatever the letter case", () => {
    for (let i = 0; i < 10; i++) {
      assertLoginAllowed("Owner@Example.com", "1.1.1.1");
      noteLoginFailure("owner@example.com", "1.1.1.1");
    }
    expect(() => assertLoginAllowed("OWNER@example.com ", "1.1.1.1")).toThrow(HttpException);
    // Another address and another email are not held back by it.
    expect(() => assertLoginAllowed("owner@example.com", "2.2.2.2")).not.toThrow();
    expect(() => assertLoginAllowed("other@example.com", "1.1.1.1")).not.toThrow();
  });

  it("guessing one email from many addresses is stopped at 100 an hour", () => {
    for (let i = 0; i < 100; i++) noteLoginFailure("owner@example.com", `10.0.0.${i}`);
    expect(() => assertLoginAllowed("owner@example.com", "9.9.9.9")).toThrow(HttpException);
  });
});
