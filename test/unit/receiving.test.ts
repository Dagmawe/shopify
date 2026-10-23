import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliveryKey, receiveDelivery, remainingUnits } from "../../app/models/receiving.server";
import { clearShop, db, makeDistributor, makeOrder } from "../support/db";
import { FakeShopify } from "../support/fake-shopify";

const SHOP = "receiving-tests.myshopify.com";
const MAIN = "gid://shopify/Location/1";
const item = (n: number) => `gid://shopify/InventoryItem/${n}`;

beforeEach(async () => {
  await clearShop(SHOP);
});

async function freshOrder(status = "ORDERED") {
  const d = await makeDistributor(SHOP);
  return makeOrder(SHOP, d.id, status, [
    { n: 1, cases: 2, loose: 3, caseSize: 6 }, // 15 bottles
    { n: 2, cases: 1, caseSize: 12 }, // 12 bottles
  ]);
}

const reload = (id: number) =>
  db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { id: "asc" } } } });

describe("receiveDelivery", () => {
  it("adds a partial delivery to Shopify and the order", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    const [red] = order.lines;

    const result = await receiveDelivery(shopify, order, new Map([[red.id, 6]]));
    assert.deepEqual(result, { ok: true, status: "PARTIAL" });
    assert.equal(shopify.available(item(1), MAIN), 34);

    const after = await reload(order.id);
    assert.equal(after.status, "PARTIAL");
    assert.equal(after.lines[0].unitsReceived, 6);
    assert.equal(after.lines[1].unitsReceived, 0);
    assert.equal(after.receivedAt, null);
  });

  it("marks the order received when everything is in", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 0 }, [item(2)]: { [MAIN]: 0 } } });
    const all = new Map(order.lines.map((l) => [l.id, remainingUnits(l)]));

    const result = await receiveDelivery(shopify, order, all);
    assert.deepEqual(result, { ok: true, status: "RECEIVED" });
    assert.equal(shopify.available(item(1), MAIN), 15);
    assert.equal(shopify.available(item(2), MAIN), 12);
    const after = await reload(order.id);
    assert.equal(after.status, "RECEIVED");
    assert.ok(after.receivedAt);
    assert.equal(shopify.adjustments.length, 1, "one adjustment for the whole delivery");
  });

  it("records an over-delivery in full", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 0 }, [item(2)]: { [MAIN]: 0 } } });
    const [red, white] = order.lines;
    const result = await receiveDelivery(shopify, order, new Map([[red.id, 18], [white.id, 12]]));
    assert.deepEqual(result, { ok: true, status: "RECEIVED" });
    assert.equal(shopify.available(item(1), MAIN), 18);
  });

  it("counts a delivery only once when it's submitted twice at the same moment", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    const [red] = order.lines;
    const delivery = new Map([[red.id, 6]]);

    const results = await Promise.all([
      receiveDelivery(shopify, order, delivery),
      receiveDelivery(shopify, order, delivery),
    ]);
    const oks = results.filter((r) => r.ok);
    assert.equal(oks.length, 1, "exactly one submission is recorded");
    const refused = results.find((r) => !r.ok);
    assert.match(refused && !refused.ok ? refused.error : "", /already recorded/);

    assert.equal(shopify.available(item(1), MAIN), 34, "Shopify got +6, not +12");
    assert.equal((await reload(order.id)).lines[0].unitsReceived, 6);
  });

  it("refuses a stale resubmission after the page has moved on", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    const [red] = order.lines;
    await receiveDelivery(shopify, order, new Map([[red.id, 6]]));
    // Same old copy of the order (unitsReceived 0) sent again, e.g. browser resend.
    const again = await receiveDelivery(shopify, order, new Map([[red.id, 6]]));
    assert.equal(again.ok, false);
    assert.equal(shopify.available(item(1), MAIN), 34);
  });

  it("accepts a second, genuine delivery of the same size", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    const [red] = order.lines;
    await receiveDelivery(shopify, order, new Map([[red.id, 6]]));
    const fresh = await reload(order.id);
    const second = await receiveDelivery(shopify, fresh, new Map([[red.id, 6]]));
    assert.deepEqual(second, { ok: true, status: "PARTIAL" });
    assert.equal(shopify.available(item(1), MAIN), 40);
    assert.equal(shopify.adjustments.length, 2);
    assert.notEqual(shopify.adjustments[0].idempotencyKey, shopify.adjustments[1].idempotencyKey);
  });

  it("undoes its claim when Shopify refuses the update", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 28 } } });
    shopify.failNextAdjustment = "Inventory item is not tracked";
    const [red] = order.lines;

    const result = await receiveDelivery(shopify, order, new Map([[red.id, 6]]));
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /nothing was changed.*not tracked/);
    assert.equal(shopify.available(item(1), MAIN), 28);
    const after = await reload(order.id);
    assert.equal(after.lines[0].unitsReceived, 0);
    assert.equal(after.status, "ORDERED");

    // And the merchant can simply try again.
    const retry = await receiveDelivery(shopify, after, new Map([[red.id, 6]]));
    assert.equal(retry.ok, true);
    assert.equal(shopify.available(item(1), MAIN), 34);
  });

  it("refuses an empty delivery", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify();
    const result = await receiveDelivery(shopify, order, new Map([[order.lines[0].id, 0]]));
    assert.deepEqual(result, { ok: false, error: "Enter what arrived before receiving." });
    assert.deepEqual(shopify.calls, []);
  });

  it("ignores negative and fractional amounts", async () => {
    const order = await freshOrder();
    const shopify = new FakeShopify({ stock: { [item(1)]: { [MAIN]: 0 } } });
    const [red, white] = order.lines;
    const result = await receiveDelivery(shopify, order, new Map([[red.id, 2.9], [white.id, -5]]));
    assert.equal(result.ok, true);
    assert.equal(shopify.available(item(1), MAIN), 2);
    assert.equal(shopify.available(item(2), MAIN), 0);
  });

  it("refuses an order with no delivery location", async () => {
    const d = await makeDistributor(SHOP);
    const order = await makeOrder(SHOP, d.id, "ORDERED", [{ n: 1, cases: 1 }], null);
    const result = await receiveDelivery(new FakeShopify(), order, new Map([[order.lines[0].id, 12]]));
    assert.equal(result.ok, false);
  });
});

describe("deliveryKey", () => {
  const order = {
    id: 7,
    number: 1007,
    locationId: MAIN,
    lines: [
      { id: 1, inventoryItemId: item(1), casesOrdered: 2, looseOrdered: 0, caseSize: 6, unitsReceived: 0 },
      { id: 2, inventoryItemId: item(2), casesOrdered: 1, looseOrdered: 0, caseSize: 12, unitsReceived: 0 },
    ],
  };

  it("is the same for the same delivery", () => {
    assert.equal(deliveryKey(order, new Map([[1, 6]])), deliveryKey(order, new Map([[1, 6]])));
  });
  it("differs for a different amount, line, order or starting point", () => {
    const key = deliveryKey(order, new Map([[1, 6]]));
    assert.notEqual(key, deliveryKey(order, new Map([[1, 7]])));
    assert.notEqual(key, deliveryKey(order, new Map([[2, 6]])));
    assert.notEqual(key, deliveryKey({ ...order, id: 8 }, new Map([[1, 6]])));
    const moved = { ...order, lines: [{ ...order.lines[0], unitsReceived: 6 }, order.lines[1]] };
    assert.notEqual(key, deliveryKey(moved, new Map([[1, 6]])));
  });
  it("ignores lines with nothing delivered", () => {
    assert.equal(deliveryKey(order, new Map([[1, 6], [2, 0]])), deliveryKey(order, new Map([[1, 6]])));
  });
});
