import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "./products.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";

// A till photo: stored per product, readable by id for the public image route,
// replaced in place, removed on request and with the product. Own organization.

const prisma = new PrismaService();
const products = new ProductsService(prisma);
let org: IsolatedOrg;
let bread: string;
// 1×1 white JPEG
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "product-photo");
  bread = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku: "PH-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("stores, replaces and removes a product's photo", async () => {
  const withPhoto = await products.setPhoto(org.organizationId, bread, JPEG, org.user.id);
  expect(withPhoto.photoVersion).toEqual(expect.any(Number));
  const stored = await products.photo(bread);
  expect(stored?.mime).toBe("image/jpeg");
  expect(stored?.bytes.subarray(0, 2).toString("hex")).toBe("ffd8");

  await new Promise((r) => setTimeout(r, 5));
  const replaced = await products.setPhoto(org.organizationId, bread, JPEG, org.user.id);
  expect(replaced.photoVersion).toBeGreaterThan(withPhoto.photoVersion!);
  expect(await prisma.productPhoto.count({ where: { productId: bread } })).toBe(1);

  const removed = await products.removePhoto(org.organizationId, bread, org.user.id);
  expect(removed.photoVersion).toBeNull();
  expect(await products.photo(bread)).toBeNull();
});

it("refuses anything that is not a picture, and another organization's product", async () => {
  await expect(products.setPhoto(org.organizationId, bread, "data:text/html;base64,PGI+", org.user.id)).rejects.toThrow("JPEG, PNG или WebP");
  await expect(products.setPhoto("other-org", bread, JPEG, org.user.id)).rejects.toThrow("Товар не найден");
});
