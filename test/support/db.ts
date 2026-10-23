// Helpers for tests that use the real database (SQLite, see DATABASE_URL in
// the test scripts). Each test file uses its own shop names, and clears them
// before each test, so files never see each other's rows.

import db from "../../app/db.server";

export { db };

export async function clearShop(shop: string): Promise<void> {
  await db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { shop } } });
  await db.purchaseOrder.deleteMany({ where: { shop } });
  await db.productSetting.deleteMany({ where: { shop } });
  await db.distributor.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
}

export async function makeDistributor(shop: string, name = "Southern Wine Co.") {
  return db.distributor.create({ data: { shop, name } });
}

export async function makeSetting(
  shop: string,
  n: number,
  data: Partial<{
    caseSize: number;
    costPerCase: number | null;
    reorderPoint: number;
    parLevel: number;
    distributorId: number | null;
    title: string;
  }> = {},
) {
  return db.productSetting.create({
    data: {
      shop,
      variantId: `gid://shopify/ProductVariant/${n}`,
      inventoryItemId: `gid://shopify/InventoryItem/${n}`,
      title: data.title ?? `Wine ${n}`,
      caseSize: data.caseSize ?? 12,
      costPerCase: data.costPerCase === undefined ? 120 : data.costPerCase,
      reorderPoint: data.reorderPoint ?? 0,
      parLevel: data.parLevel ?? 0,
      distributorId: data.distributorId ?? null,
    },
  });
}

let nextNumber = 5000;

export async function makeOrder(
  shop: string,
  distributorId: number,
  status: string,
  lines: Array<{ n: number; cases: number; loose?: number; caseSize?: number; received?: number }>,
  locationId: string | null = "gid://shopify/Location/1",
) {
  return db.purchaseOrder.create({
    data: {
      shop,
      number: nextNumber++,
      distributorId,
      status,
      locationId,
      locationName: locationId ? "Main store" : null,
      lines: {
        create: lines.map((l) => ({
          variantId: `gid://shopify/ProductVariant/${l.n}`,
          inventoryItemId: `gid://shopify/InventoryItem/${l.n}`,
          title: `Wine ${l.n}`,
          caseSize: l.caseSize ?? 12,
          casesOrdered: l.cases,
          looseOrdered: l.loose ?? 0,
          costPerCase: 120,
          unitsReceived: l.received ?? 0,
        })),
      },
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}
