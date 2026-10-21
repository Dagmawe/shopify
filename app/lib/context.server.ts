import { authenticate } from "../shopify.server";
import { getActivePlan, planSelectionRedirectPath, type PlanFeatures } from "./plan.server";

// Small in-memory cache so we don't ask Shopify for the plan on every click.
const planCache = new Map<string, { plan: PlanFeatures; expires: number }>();
const PLAN_CACHE_MS = 5 * 60 * 1000;

// Every app page calls this first. It signs the merchant in, makes sure the
// store has picked a plan (sending them to Shopify's plan page if not), and
// returns what the page needs.
export async function requireApp(request: Request) {
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
    throw context.redirect(planSelectionRedirectPath(), { target: "_top" });
  }

  return { ...context, shop, plan };
}

export function clearPlanCache(shop: string) {
  planCache.delete(shop);
}

export function intField(form: FormData, key: string, fallback = 0): number {
  const raw = form.get(key);
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function floatField(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (raw == null || raw === "") return null;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function textField(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}
