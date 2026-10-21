// Plans are set up with Shopify "managed pricing" in the Partner Dashboard
// (Apps > CaseFlow > Distribution > Manage listing > Pricing). Shopify shows
// the plan picker, handles the 14-day trial and bills the merchant. This file
// just reads which plan the store is on and decides what it unlocks.

import type { AdminGraphql } from "./shopify-data.server";

export type PlanName = "Starter" | "Pro" | "Premium";

export interface PlanFeatures {
  name: PlanName;
  multiLocation: boolean; // receive into any location, not just the first
  autoDraftOrders: boolean; // one-click draft POs from reorder alerts
}

const FEATURES: Record<PlanName, PlanFeatures> = {
  Starter: { name: "Starter", multiLocation: false, autoDraftOrders: false },
  Pro: { name: "Pro", multiLocation: true, autoDraftOrders: true },
  Premium: { name: "Premium", multiLocation: true, autoDraftOrders: true },
};

// The plan names you create in the Partner Dashboard must contain one of
// these words (for example "Starter", "Pro", "Premium").
function matchPlan(subscriptionName: string): PlanName | null {
  const n = subscriptionName.toLowerCase();
  if (n.includes("premium")) return "Premium";
  if (n.includes("pro")) return "Pro";
  if (n.includes("starter")) return "Starter";
  return null;
}

// Whether to skip the plan check and treat every store as Pro.
// - CASEFLOW_BILLING_BYPASS=true  -> always skip (testing only)
// - CASEFLOW_BILLING_BYPASS=false -> always check (to test billing locally)
// - not set -> skip during `npm run dev`, check in production
export function billingBypassed(): boolean {
  const flag = process.env.CASEFLOW_BILLING_BYPASS;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export async function getActivePlan(admin: AdminGraphql): Promise<PlanFeatures | null> {
  if (billingBypassed()) return FEATURES.Pro;

  const response = await admin.graphql(
    `#graphql
    query CaseFlowPlan {
      currentAppInstallation {
        activeSubscriptions { name status }
      }
    }`,
  );
  const json = (await response.json()) as {
    data?: {
      currentAppInstallation: {
        activeSubscriptions: Array<{ name: string; status: string }>;
      };
    };
  };
  const subs = json.data?.currentAppInstallation.activeSubscriptions ?? [];
  for (const sub of subs) {
    if (sub.status !== "ACTIVE") continue;
    const plan = matchPlan(sub.name);
    if (plan) return FEATURES[plan];
  }
  return null;
}

// The app's own handle (the part after /apps/ in admin URLs), read from
// Shopify rather than configured, so it can't point at a different app.
const handleCache = { value: null as string | null };

export async function getAppHandle(admin: AdminGraphql): Promise<string> {
  if (handleCache.value) return handleCache.value;
  const response = await admin.graphql(
    `#graphql
    query CaseFlowAppHandle {
      currentAppInstallation { app { handle } }
    }`,
  );
  const json = (await response.json()) as {
    data?: { currentAppInstallation: { app: { handle: string | null } } };
  };
  const handle = json.data?.currentAppInstallation.app.handle;
  if (!handle) throw new Error("Shopify didn't return this app's handle.");
  handleCache.value = handle;
  return handle;
}

// Shopify's hosted plan-selection page for managed pricing, in the form the
// app's redirect helper expects (it opens the page in the top admin window).
export function planSelectionRedirectPath(appHandle: string): string {
  return `shopify://admin/charges/${appHandle}/pricing_plans`;
}

// Same page as a full link, for "See plans" and "Change plan" links.
export function planSelectionUrl(shop: string, appHandle: string): string {
  const storeHandle = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
