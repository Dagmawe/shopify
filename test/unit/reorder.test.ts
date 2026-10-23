import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getReorderRows } from "../../app/models/reorder.server";
import { clearShop, makeDistributor, makeOrder, makeSetting } from "../support/db";
import { FakeShopify } from "../support/fake-shopify";

const SHOP = "reorder-tests.myshopify.com";
const OTHER = "reorder-tests-other.myshopify.com";
const MAIN = "gid://shopify/Location/1";
const WAREHOUSE = "gid://shopify/Location/2";
const item = (n: number) => `gid://shopify/InventoryItem/${n}`;

beforeEach(async () => {
  await clearShop(SHOP);
  await clearShop(OTHER);
});

describe("getReorderRows", () => {
  it("lists products at or below their reorder point with the cases to order", async () => {
    const d = await makeDistributor(SHOP);
    await makeSetting(SHOP, 1, { caseSize: 6, reorderPoint: 30, parLevel: 36, distributorId: d.id });
    await makeSetting(SHOP, 2, { caseSize: 12, reorderPoint: 24, parLevel: 48, distributorId: d.id });
    const shopify = new FakeShopify({
      stock: { [item(1)]: { [MAIN]: 28 }, [item(2)]: { [MAIN]: 30 } },
    });

    const rows = await getReorderRows(shopify, SHOP);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Wine 1");
    assert.equal(rows[0].available, 28);
    assert.equal(rows[0].cases, 2);
    assert.equal(rows[0].distributorId, d.id);
    assert.equal(rows[0].draft, null);
  });

  it("adds up stock across every location", async () => {
    await makeSetting(SHOP, 1, { caseSize: 12, reorderPoint: 72, parLevel: 96 });
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 10, [WAREHOUSE]: 60 } } });
    const [row] = await getReorderRows(shopify, SHOP);
    assert.equal(row.available, 70);
    assert.equal(row.cases, 3); // 26 short -> 3 cases of 12
  });

  it("drops a product once enough is on order", async () => {
    const d = await makeDistributor(SHOP);
    await makeSetting(SHOP, 1, { caseSize: 6, reorderPoint: 30, parLevel: 36, distributorId: d.id });
    await makeOrder(SHOP, d.id, "ORDERED", [{ n: 1, cases: 2, caseSize: 6 }]);
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    assert.deepEqual(await getReorderRows(shopify, SHOP), []);
  });

  it("still lists a product that's only on a draft, and links the draft", async () => {
    const d = await makeDistributor(SHOP);
    await makeSetting(SHOP, 1, { caseSize: 6, reorderPoint: 30, parLevel: 36, distributorId: d.id });
    const draft = await makeOrder(SHOP, d.id, "DRAFT", [{ n: 1, cases: 2, caseSize: 6 }]);
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    const [row] = await getReorderRows(shopify, SHOP);
    assert.equal(row.incoming, 0, "a draft isn't on order yet");
    assert.deepEqual(row.draft, { orderId: draft.id, number: draft.number });
  });

  it("flags out-of-stock and oversold products", async () => {
    await makeSetting(SHOP, 1, { caseSize: 12, reorderPoint: 12, parLevel: 24 });
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: -3 } } });
    const [row] = await getReorderRows(shopify, SHOP);
    assert.equal(row.available, -3);
    assert.equal(row.cases, 3); // 27 short
  });

  it("skips products without reorder settings", async () => {
    await makeSetting(SHOP, 1, { reorderPoint: 0, parLevel: 0 });
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 0 } } });
    assert.deepEqual(await getReorderRows(shopify, SHOP), []);
    assert.deepEqual(shopify.calls, [], "no need to ask Shopify");
  });

  it("never shows another store's products", async () => {
    await makeSetting(OTHER, 1, { reorderPoint: 30, parLevel: 36 });
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 0 } } });
    assert.deepEqual(await getReorderRows(shopify, SHOP), []);
  });
});
