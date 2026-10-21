import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { checkClockOnce } from "./lib/clock-check.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  // During `npm run dev` the Shopify CLI sets SHOPIFY_APP_URL. On Render the
  // host provides RENDER_EXTERNAL_URL, so it doesn't have to be entered.
  appUrl: process.env.SHOPIFY_APP_URL || process.env.RENDER_EXTERNAL_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Set CORKCOUNT_DEBUG=true in .env to see every sign-in step (noisy, and it
  // prints session tokens). Otherwise: info while developing, warnings live.
  logger: {
    level:
      process.env.CORKCOUNT_DEBUG === "true"
        ? LogSeverity.Debug
        : process.env.NODE_ENV === "production"
          ? LogSeverity.Warning
          : LogSeverity.Info,
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

checkClockOnce();

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
