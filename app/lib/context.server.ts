import { authenticate } from "../shopify.server";
import { getShopCurrency, type AdminGraphql } from "./shopify-data.server";
import {
  getActivePlan,
  getAppHandle,
  planSelectionRedirectPath,
  type PlanFeatures,
} from "./plan.server";

// Small in-memory cache so we don't ask Shopify for the plan on every click.
const planCache = new Map<string, { plan: PlanFeatures; expires: number }>();
// Kept short so a merchant who just changed plans sees the new plan right away.
const PLAN_CACHE_MS = 30 * 1000;

// Every app page calls this first. It signs the merchant in, makes sure the
// store has picked a plan (sending them to Shopify's plan page if not), and
// returns what the page needs.
export async function requireApp(request: Request) {
  try {
    return await requireAppInner(request);
  } catch (thrown) {
    logThrown("page", request, thrown);
    throw thrown;
  }
}

async function requireAppInner(request: Request) {
  const context = await authenticate.admin(request);
  const shop = context.session.shop;

  let plan: PlanFeatures | null = null;
  const cached = planCache.get(shop);
  if (cached && cached.expires > Date.now()) {
    plan = cached.plan;
  } else {
    plan = await getActivePlan(context.admin);
    if (plan) planCache.set(shop, { plan, expires: Date.now() + PLAN_CACHE_MS });
  }

  if (!plan) {
    const appHandle = await getAppHandle(context.admin);
    throw context.redirect(planSelectionRedirectPath(appHandle), { target: "_top" });
  }

  return { ...context, shop, plan };
}

export function clearPlanCache(shop: string) {
  planCache.delete(shop);
  currencyCache.delete(shop);
}

// The store's currency rarely changes, so it's looked up once an hour. If
// Shopify can't be reached, prices fall back to US dollars for that page.
const currencyCache = new Map<string, { code: string; expires: number }>();
const CURRENCY_CACHE_MS = 60 * 60 * 1000;

export async function shopCurrency(admin: AdminGraphql, shop: string): Promise<string> {
  const cached = currencyCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.code;
  try {
    const code = await getShopCurrency(admin);
    currencyCache.set(shop, { code, expires: Date.now() + CURRENCY_CACHE_MS });
    return code;
  } catch (err) {
    console.warn(`[Corkcount] Couldn't read ${shop}'s currency`, err);
    return "USD";
  }
}

// Form helpers live in ./form (no server imports, so they can be tested).
export { dateField, floatField, intField, moneyField, textField } from "./form";

// Logs why a request was stopped (a redirect, a sign-in retry, or an error),
// so the terminal shows the reason instead of a blank screen.
export function logThrown(where: string, request: Request, thrown: unknown) {
  const path = new URL(request.url).pathname;
  if (thrown instanceof Response) {
    console.warn(
      `[Corkcount] ${where} ${path}: stopped with HTTP ${thrown.status}` +
        (thrown.headers.get("Location") ? ` -> ${thrown.headers.get("Location")}` : ""),
    );
  } else {
    console.error(`[Corkcount] ${where} ${path}: error`, thrown);
  }
}
