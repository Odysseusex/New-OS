import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";

// The specs hand-wire their services, so they cannot see a dependency the real
// container cannot resolve. Compiling the whole application module does: it
// fails here, in CI, instead of at start-up on the server.
describe("application module", () => {
  it("resolves every provider's dependencies", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
