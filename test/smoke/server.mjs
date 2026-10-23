// Starts the built app (run `npm run build` first) and checks it from the
// outside, the way a browser and Shopify's webhook sender would.
//   npm run test:smoke
// Needs DATABASE_URL pointing at a migrated database.

import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

// On GitHub, "::error ::" lines become annotations on the run.
const onGitHub = Boolean(process.env.GITHUB_ACTIONS);
const annotate = (level, title, message) =>
  onGitHub && console.log(`::${level} title=${title}::${message.replace(/\n/g, "%0A")}`);

// Give up after two minutes rather than hanging the CI job.
setTimeout(() => {
  annotate("error", "Smoke test", "Timed out after 2 minutes.");
  console.error("Smoke test timed out.\n" + serverLog);
  stopServer();
  process.exit(1);
}, 120_000).unref();

// Run react-router-serve with node directly (not through npx), in its own
// process group, so stopping it stops the real server too.
const require = createRequire(import.meta.url);
const servePkgPath = require.resolve("@react-router/serve/package.json");
const servePkg = JSON.parse(readFileSync(servePkgPath, "utf8"));
const serveBin = join(
  dirname(servePkgPath),
  typeof servePkg.bin === "string" ? servePkg.bin : servePkg.bin["react-router-serve"],
);

const PORT = process.env.SMOKE_PORT || "3123";
const BASE = `http://localhost:${PORT}`;
const SECRET = "smoke-test-secret";
const SHOP = "smoke-test.myshopify.com";

const server = spawn(process.execPath, [serveBin, "./build/server/index.js"], {
  detached: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT,
    SHOPIFY_API_KEY: "smoke-test-key",
    SHOPIFY_API_SECRET: SECRET,
    SHOPIFY_APP_URL: BASE,
    SCOPES: "read_products,read_inventory,write_inventory,read_locations",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
function stopServer() {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already stopped
  }
}
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const db = new PrismaClient();
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n    ${err.message.split("\n").join("\n    ")}`);
    annotate("error", `Smoke: ${name}`, err.message);
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server didn't start within 30 seconds.\n${serverLog}`);
}

function webhook(topic, body, { secret = SECRET } = {}) {
  const raw = JSON.stringify(body);
  const hmac = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  return fetch(`${BASE}/webhooks/${topic}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": randomUUID(),
      "X-Shopify-Event-Id": randomUUID(),
      "X-Shopify-Triggered-At": new Date().toISOString(),
    },
    body: raw,
  });
}

async function seedShop() {
  await db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { shop: SHOP } } });
  await db.purchaseOrder.deleteMany({ where: { shop: SHOP } });
  await db.productSetting.deleteMany({ where: { shop: SHOP } });
  await db.distributor.deleteMany({ where: { shop: SHOP } });
  const d = await db.distributor.create({ data: { shop: SHOP, name: "Smoke Wines" } });
  await db.productSetting.create({
    data: { shop: SHOP, variantId: "v1", inventoryItemId: "i1", title: "Red", distributorId: d.id },
  });
  await db.purchaseOrder.create({
    data: {
      shop: SHOP,
      number: 1001,
      distributorId: d.id,
      lines: {
        create: [{ variantId: "v1", inventoryItemId: "i1", title: "Red", caseSize: 12, casesOrdered: 1 }],
      },
    },
  });
}

async function countShopRows() {
  const [d, s, o] = await Promise.all([
    db.distributor.count({ where: { shop: SHOP } }),
    db.productSetting.count({ where: { shop: SHOP } }),
    db.purchaseOrder.count({ where: { shop: SHOP } }),
  ]);
  return d + s + o;
}

try {
  await waitForServer();
  console.log("Smoke test against the built server:");

  await check("health check answers ok", async () => {
    const res = await fetch(`${BASE}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });

  await check("landing page loads", async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Order by the case/);
  });

  await check("landing page sends Shopify's ?shop= visits into the app", async () => {
    const res = await fetch(`${BASE}/?shop=${SHOP}&host=abc`, { redirect: "manual" });
    assert.ok([301, 302].includes(res.status), `status ${res.status}`);
    assert.match(res.headers.get("location") ?? "", /^\/app\?/);
  });

  await check("privacy policy loads", async () => {
    const res = await fetch(`${BASE}/privacy`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Privacy policy/);
    assert.match(html, /48 hours/);
  });

  await check("login page has no 'enter your store' field (App Store rule 2.3.1)", async () => {
    const res = await fetch(`${BASE}/auth/login`);
    assert.ok(res.status < 500, `status ${res.status}`);
    assert.doesNotMatch(await res.text(), /name="shop"/);
  });

  await check("the app refuses visitors who aren't signed in through Shopify", async () => {
    const res = await fetch(`${BASE}/app`, { redirect: "manual" });
    assert.ok(res.status >= 300 && res.status < 500, `status ${res.status}`);
  });

  for (const topic of ["app/uninstalled", "app/scopes_update", "customers/data_request", "customers/redact", "shop/redact"]) {
    await check(`webhook ${topic} rejects a forged signature`, async () => {
      const res = await webhook(topic, { shop_domain: SHOP }, { secret: "wrong-secret" });
      assert.equal(res.status, 401);
    });
  }

  await check("webhook app/scopes_update accepts Shopify's signature, even without a scope list", async () => {
    const ok = await webhook("app/scopes_update", { id: 1, current: ["read_products"], previous: [] });
    assert.equal(ok.status, 200);
    const odd = await webhook("app/scopes_update", { id: 1 });
    assert.equal(odd.status, 200);
  });

  await check("webhook customers/data_request accepts Shopify's signature", async () => {
    const res = await webhook("customers/data_request", {
      shop_domain: SHOP,
      customer: { id: 1, email: "tom@example.com" },
      orders_requested: [],
    });
    assert.equal(res.status, 200);
  });

  await check("webhook customers/redact accepts Shopify's signature", async () => {
    const res = await webhook("customers/redact", {
      shop_domain: SHOP,
      customer: { id: 1, email: "tom@example.com" },
      orders_to_redact: [],
    });
    assert.equal(res.status, 200);
  });

  await check("webhook app/uninstalled keeps the store's data for 48 hours", async () => {
    await seedShop();
    const res = await webhook("app/uninstalled", { id: 1, domain: SHOP });
    assert.equal(res.status, 200);
    assert.equal(await countShopRows(), 3);
  });

  await check("webhook shop/redact deletes everything for the store", async () => {
    await seedShop();
    assert.equal(await countShopRows(), 3);
    const res = await webhook("shop/redact", { shop_id: 1, shop_domain: SHOP });
    assert.equal(res.status, 200);
    assert.equal(await countShopRows(), 0);
  });
} catch (err) {
  console.error(err);
  annotate("error", "Smoke test", err.message);
  results.push({ name: "startup", ok: false });
} finally {
  stopServer();
  await db.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log("\nServer output:\n" + serverLog);
  annotate("error", "Smoke test server output", serverLog.slice(-3000));
  process.exit(1);
}
annotate("notice", "Smoke test", `${results.length} checks passed`);
process.exit(0);
