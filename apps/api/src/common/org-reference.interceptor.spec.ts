import { ExecutionContext, NotFoundException } from "@nestjs/common";
import { of } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { OrgReferenceInterceptor } from "./org-reference.interceptor";

// An id of ANOTHER organization inside a request is refused before any handler runs
// (a stock receipt used to accept any `locationId`).

const prisma = new PrismaService();
const interceptor = new OrgReferenceInterceptor(prisma);
let mine: IsolatedOrg;
let theirs: IsolatedOrg;
let myProduct: string;
let theirProduct: string;

const run = (user: IsolatedOrg["user"] | undefined, req: { body?: unknown; query?: unknown; params?: unknown }) => {
  const context = { getType: () => "http", switchToHttp: () => ({ getRequest: () => ({ user, ...req }) }) } as unknown as ExecutionContext;
  return interceptor.intercept(context, { handle: () => of("handled") });
};

beforeAll(async () => {
  await prisma.$connect();
  mine = await createIsolatedOrg(prisma, "orgref-mine");
  theirs = await createIsolatedOrg(prisma, "orgref-theirs");
  const product = (org: IsolatedOrg, sku: string) =>
    prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku, unit: "PCS", type: "FINISHED_GOOD", price: 100 } });
  myProduct = (await product(mine, "OR-1")).id;
  theirProduct = (await product(theirs, "OR-2")).id;
});
afterAll(async () => {
  const leftovers = [...(await destroyOrg(prisma, mine.organizationId)), ...(await destroyOrg(prisma, theirs.organizationId))];
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("ids of another organization in a request", () => {
  it("own ids pass, in the body, the query and the address", async () => {
    await expect(run(mine.user, { body: { locationId: mine.storeId, lines: [{ productId: myProduct, quantity: 1 }] }, query: { locationId: mine.storeId }, params: { productId: myProduct } })).resolves.toBeDefined();
  });

  it("another organization's point or product is refused wherever it is put", async () => {
    await expect(run(mine.user, { body: { locationId: theirs.storeId, productId: myProduct } })).rejects.toThrow(NotFoundException);
    await expect(run(mine.user, { query: { locationId: theirs.storeId } })).rejects.toThrow(NotFoundException);
    await expect(run(mine.user, { params: { productId: theirProduct } })).rejects.toThrow(NotFoundException);
    await expect(run(mine.user, { body: { toLocationId: mine.storeId, items: [{ productId: myProduct }, { ingredientProductId: theirProduct }] } })).rejects.toThrow(NotFoundException);
    await expect(run(mine.user, { body: { memberIds: ["nope"], productIds: [myProduct, theirProduct] } })).rejects.toThrow(NotFoundException);
  });

  it("an id found nowhere, an empty value and a request with no login are left to the handler", async () => {
    await expect(run(mine.user, { query: { locationId: "", productId: "no-such-product" }, body: { accountId: null, note: "x" } })).resolves.toBeDefined();
    await expect(run(undefined, { body: { locationId: theirs.storeId } })).resolves.toBeDefined();
  });
});
