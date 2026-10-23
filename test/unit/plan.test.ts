import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billingBypassed,
  getActivePlan,
  planSelectionRedirectPath,
  planSelectionUrl,
} from "../../app/lib/plan.server";
import { FakeShopify } from "../support/fake-shopify";

const saved = { flag: process.env.CORKCOUNT_BILLING_BYPASS, env: process.env.NODE_ENV };
afterEach(() => {
  if (saved.flag === undefined) delete process.env.CORKCOUNT_BILLING_BYPASS;
  else process.env.CORKCOUNT_BILLING_BYPASS = saved.flag;
  process.env.NODE_ENV = saved.env;
});

describe("billingBypassed", () => {
  it("checks plans in production by default", () => {
    delete process.env.CORKCOUNT_BILLING_BYPASS;
    process.env.NODE_ENV = "production";
    assert.equal(billingBypassed(), false);
  });
  it("skips the check while developing", () => {
    delete process.env.CORKCOUNT_BILLING_BYPASS;
    process.env.NODE_ENV = "development";
    assert.equal(billingBypassed(), true);
  });
  it("follows the explicit setting either way", () => {
    process.env.NODE_ENV = "production";
    process.env.CORKCOUNT_BILLING_BYPASS = "true";
    assert.equal(billingBypassed(), true);
    process.env.NODE_ENV = "development";
    process.env.CORKCOUNT_BILLING_BYPASS = "false";
    assert.equal(billingBypassed(), false);
  });
});

describe("getActivePlan", () => {
  const live = () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORKCOUNT_BILLING_BYPASS;
  };

  it("returns no plan for a store without a subscription", async () => {
    live();
    assert.equal(await getActivePlan(new FakeShopify()), null);
  });

  it("maps each plan name to its features", async () => {
    live();
    const cases = [
      ["Starter", { multiLocation: false, autoDraftOrders: false }],
      ["Pro", { multiLocation: true, autoDraftOrders: true }],
      ["Premium", { multiLocation: true, autoDraftOrders: true }],
    ] as const;
    for (const [name, features] of cases) {
      const plan = await getActivePlan(
        new FakeShopify({ subscriptions: [{ name, status: "ACTIVE" }] }),
      );
      assert.equal(plan?.name, name);
      assert.equal(plan?.multiLocation, features.multiLocation);
      assert.equal(plan?.autoDraftOrders, features.autoDraftOrders);
    }
  });

  it("matches plan names case-insensitively and inside longer names", async () => {
    live();
    const plan = await getActivePlan(
      new FakeShopify({ subscriptions: [{ name: "Corkcount PREMIUM (annual)", status: "ACTIVE" }] }),
    );
    assert.equal(plan?.name, "Premium");
  });

  it("ignores subscriptions that aren't active", async () => {
    live();
    const plan = await getActivePlan(
      new FakeShopify({
        subscriptions: [
          { name: "Premium", status: "CANCELLED" },
          { name: "Starter", status: "ACTIVE" },
        ],
      }),
    );
    assert.equal(plan?.name, "Starter");
  });

  it("ignores subscriptions it doesn't recognise", async () => {
    live();
    const plan = await getActivePlan(
      new FakeShopify({ subscriptions: [{ name: "Legacy", status: "ACTIVE" }] }),
    );
    assert.equal(plan, null);
  });

  it("treats every store as Pro when the check is bypassed", async () => {
    process.env.CORKCOUNT_BILLING_BYPASS = "true";
    const shopify = new FakeShopify();
    const plan = await getActivePlan(shopify);
    assert.equal(plan?.name, "Pro");
    assert.deepEqual(shopify.calls, [], "no call to Shopify needed");
  });
});

describe("plan selection links", () => {
  it("points at Shopify's hosted plan page for this app", () => {
    assert.equal(planSelectionRedirectPath("corkcount"), "shopify://admin/charges/corkcount/pricing_plans");
    assert.equal(
      planSelectionUrl("rosas-wines.myshopify.com", "corkcount"),
      "https://admin.shopify.com/store/rosas-wines/charges/corkcount/pricing_plans",
    );
  });
});
