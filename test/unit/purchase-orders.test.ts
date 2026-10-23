import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftsByVariant,
  incomingByVariant,
  nextPoNumber,
  poTotals,
  statusAfterReceiving,
} from "../../app/models/purchase-orders.server";
import { clearShop, db, makeDistributor, makeOrder } from "../support/db";

const SHOP = "po-tests.myshopify.com";
const OTHER = "po-tests-other.myshopify.com";
const RED = "gid://shopify/ProductVariant/1";
const WHITE = "gid://shopify/ProductVariant/2";

beforeEach(async () => {
  await clearShop(SHOP);
  await clearShop(OTHER);
});

describe("nextPoNumber", () => {
  it("starts at 1001", async () => {
    assert.equal(await nextPoNumber(SHOP), 1001);
  });

  it("counts up from the store's highest number", async () => {
    const d = await makeDistributor(SHOP);
    await db.purchaseOrder.create({ data: { shop: SHOP, number: 1007, distributorId: d.id } });
    assert.equal(await nextPoNumber(SHOP), 1008);
  });

  it("numbers each store separately", async () => {
    const d = await makeDistributor(OTHER);
    await db.purchaseOrder.create({ data: { shop: OTHER, number: 1500, distributorId: d.id } });
    assert.equal(await nextPoNumber(SHOP), 1001);
  });
});

describe("incomingByVariant", () => {
  it("counts bottles ordered but not yet received", async () => {
    const d = await makeDistributor(SHOP);
    await makeOrder(SHOP, d.id, "ORDERED", [{ n: 1, cases: 2, loose: 3 }]); // 27
    await makeOrder(SHOP, d.id, "PARTIAL", [{ n: 1, cases: 1, received: 5 }]); // 7 left
    const incoming = await incomingByVariant(SHOP);
    assert.equal(incoming.get(RED), 34);
  });

  it("ignores drafts, received and cancelled orders", async () => {
    const d = await makeDistributor(SHOP);
    await makeOrder(SHOP, d.id, "DRAFT", [{ n: 1, cases: 5 }]);
    await makeOrder(SHOP, d.id, "RECEIVED", [{ n: 1, cases: 5, received: 60 }]);
    await makeOrder(SHOP, d.id, "CANCELLED", [{ n: 1, cases: 5 }]);
    assert.equal((await incomingByVariant(SHOP)).size, 0);
  });

  it("never counts an over-delivery as negative stock on order", async () => {
    const d = await makeDistributor(SHOP);
    await makeOrder(SHOP, d.id, "PARTIAL", [{ n: 1, cases: 1, received: 18 }]);
    assert.equal((await incomingByVariant(SHOP)).get(RED), 0);
  });

  it("only sees the store's own orders", async () => {
    const d = await makeDistributor(OTHER);
    await makeOrder(OTHER, d.id, "ORDERED", [{ n: 1, cases: 5 }]);
    assert.equal((await incomingByVariant(SHOP)).size, 0);
  });
});

describe("draftsByVariant", () => {
  it("finds the oldest draft each product is on", async () => {
    const d = await makeDistributor(SHOP);
    const first = await makeOrder(SHOP, d.id, "DRAFT", [{ n: 1, cases: 1 }]);
    await makeOrder(SHOP, d.id, "DRAFT", [{ n: 1, cases: 2 }, { n: 2, cases: 1 }]);
    await makeOrder(SHOP, d.id, "ORDERED", [{ n: 2, cases: 1 }]);
    const drafts = await draftsByVariant(SHOP);
    assert.equal(drafts.get(RED)?.orderId, first.id);
    assert.equal(drafts.get(RED)?.number, first.number);
    assert.ok(drafts.has(WHITE));
  });

  it("only sees the store's own drafts", async () => {
    const d = await makeDistributor(OTHER);
    await makeOrder(OTHER, d.id, "DRAFT", [{ n: 1, cases: 1 }]);
    assert.equal((await draftsByVariant(SHOP)).size, 0);
  });
});

describe("poTotals", () => {
  it("adds up cases, loose bottles, units and cost", () => {
    const totals = poTotals([
      { casesOrdered: 2, looseOrdered: 3, caseSize: 6, costPerCase: 72, unitsReceived: 6 },
      { casesOrdered: 1, looseOrdered: 0, caseSize: 12, costPerCase: 120, unitsReceived: 0 },
    ]);
    assert.deepEqual(totals, { cases: 3, loose: 3, units: 27, received: 6, cost: 300 });
  });

  it("has no total cost when any price is missing", () => {
    const totals = poTotals([
      { casesOrdered: 1, looseOrdered: 0, caseSize: 12, costPerCase: null, unitsReceived: 0 },
    ]);
    assert.equal(totals.cost, null);
  });
});

describe("statusAfterReceiving", () => {
  const line = { casesOrdered: 1, looseOrdered: 2, caseSize: 6 };
  it("is partly received until every line is in", () => {
    assert.equal(statusAfterReceiving([{ ...line, unitsReceived: 7 }]), "PARTIAL");
    assert.equal(
      statusAfterReceiving([{ ...line, unitsReceived: 8 }, { ...line, unitsReceived: 0 }]),
      "PARTIAL",
    );
  });
  it("is received when everything (or more) has arrived", () => {
    assert.equal(statusAfterReceiving([{ ...line, unitsReceived: 8 }]), "RECEIVED");
    assert.equal(statusAfterReceiving([{ ...line, unitsReceived: 12 }]), "RECEIVED");
  });
});
