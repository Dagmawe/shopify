import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addReceivedStock, getAvailable, getLocations } from "../../app/lib/shopify-data.server";
import { FakeShopify } from "../support/fake-shopify";

const MAIN = "gid://shopify/Location/1";
const WAREHOUSE = "gid://shopify/Location/2";
const RED = "gid://shopify/InventoryItem/100";
const WHITE = "gid://shopify/InventoryItem/200";

describe("getLocations", () => {
  it("lists the store's locations", async () => {
    const shopify = new FakeShopify();
    assert.deepEqual(
      (await getLocations(shopify)).map((l) => l.name),
      ["Main store", "Warehouse"],
    );
  });
});

describe("getAvailable", () => {
  const stock = { [RED]: { [MAIN]: 10, [WAREHOUSE]: 132 }, [WHITE]: { [MAIN]: 28 } };

  it("adds up stock across locations", async () => {
    const levels = await getAvailable(new FakeShopify({ stock }), [RED, WHITE]);
    assert.equal(levels.get(RED), 142);
    assert.equal(levels.get(WHITE), 28);
  });

  it("reads one location when asked", async () => {
    const levels = await getAvailable(new FakeShopify({ stock }), [RED, WHITE], WAREHOUSE);
    assert.equal(levels.get(RED), 132);
    assert.equal(levels.get(WHITE), 0, "not stocked there counts as 0");
  });

  it("asks once per item even if an item is listed twice", async () => {
    const shopify = new FakeShopify({ stock });
    const levels = await getAvailable(shopify, [RED, RED, WHITE]);
    assert.equal(levels.size, 2);
    assert.equal(shopify.calls.length, 1);
  });

  it("batches large lists into groups of 100", async () => {
    const many: Record<string, Record<string, number>> = {};
    const ids = Array.from({ length: 250 }, (_, i) => `gid://shopify/InventoryItem/${i + 1}`);
    for (const id of ids) many[id] = { [MAIN]: 1 };
    const shopify = new FakeShopify({ stock: many });
    const levels = await getAvailable(shopify, ids);
    assert.equal(levels.size, 250);
    assert.equal(shopify.calls.length, 3);
  });
});

describe("addReceivedStock", () => {
  it("adds bottles with compare-and-set and the caller's key", async () => {
    const shopify = new FakeShopify({ stock: { [RED]: { [MAIN]: 20 } } });
    await addReceivedStock(shopify, {
      locationId: MAIN,
      reference: "corkcount://purchase-order/1001",
      idempotencyKey: "key-1",
      changes: [{ inventoryItemId: RED, delta: 24 }],
    });
    assert.equal(shopify.available(RED, MAIN), 44);
    const [adj] = shopify.adjustments;
    assert.match(adj.idempotencyKey, /^key-1:[0-9a-f]{16}$/);
    assert.equal(adj.reason, "received");
    assert.equal(adj.reference, "corkcount://purchase-order/1001");
    assert.equal(adj.changes[0].changeFromQuantity, 20);
  });

  it("sends the same key for an identical request from the same stock", async () => {
    const params = {
      locationId: MAIN,
      reference: "r",
      idempotencyKey: "same-key",
      changes: [{ inventoryItemId: RED, delta: 24 }],
    };
    const a = new FakeShopify({ stock: { [RED]: { [MAIN]: 20 } } });
    const b = new FakeShopify({ stock: { [RED]: { [MAIN]: 20 } } });
    await addReceivedStock(a, params);
    await addReceivedStock(b, params);
    assert.equal(a.attemptedKeys[0], b.attemptedKeys[0]);
  });

  it("uses a fresh key when retrying after a sale changed the stock", async () => {
    const shopify = new FakeShopify({ stock: { [RED]: { [MAIN]: 20 } } });
    const params = {
      locationId: MAIN,
      reference: "r",
      idempotencyKey: "delivery",
      changes: [{ inventoryItemId: RED, delta: 24 }],
    };
    shopify.failNextAdjustment = "The quantity changed. Try again.";
    await assert.rejects(addReceivedStock(shopify, params), /quantity changed/);
    shopify.stock[RED][MAIN] = 19; // a bottle sold meanwhile
    await addReceivedStock(shopify, params);
    assert.notEqual(shopify.attemptedKeys[0], shopify.attemptedKeys[1]);
    assert.equal(shopify.available(RED, MAIN), 43);
  });

  it("stocks the item at a new location before adding to it", async () => {
    const shopify = new FakeShopify({ stock: { [RED]: { [MAIN]: 5 } } });
    await addReceivedStock(shopify, {
      locationId: WAREHOUSE,
      reference: "r",
      idempotencyKey: "k",
      changes: [{ inventoryItemId: RED, delta: 12 }],
    });
    assert.deepEqual(shopify.activations, [{ inventoryItemId: RED, locationId: WAREHOUSE }]);
    assert.equal(shopify.available(RED, WAREHOUSE), 12);
    assert.equal(shopify.available(RED, MAIN), 5);
  });

  it("does nothing when nothing changes", async () => {
    const shopify = new FakeShopify();
    await addReceivedStock(shopify, {
      locationId: MAIN,
      reference: "r",
      idempotencyKey: "k",
      changes: [{ inventoryItemId: RED, delta: 0 }],
    });
    assert.deepEqual(shopify.calls, []);
  });

  it("surfaces Shopify's error and changes nothing", async () => {
    const shopify = new FakeShopify({ stock: { [RED]: { [MAIN]: 20 } } });
    shopify.failNextAdjustment = "Inventory item is not tracked";
    await assert.rejects(
      addReceivedStock(shopify, {
        locationId: MAIN,
        reference: "r",
        idempotencyKey: "k",
        changes: [{ inventoryItemId: RED, delta: 6 }],
      }),
      /not tracked/,
    );
    assert.equal(shopify.available(RED, MAIN), 20);
  });

  it("throws on GraphQL errors instead of failing silently", async () => {
    const broken = {
      graphql: async () => new Response(JSON.stringify({ errors: [{ message: "Throttled" }] })),
    };
    await assert.rejects(getLocations(broken), /Throttled/);
  });
});
