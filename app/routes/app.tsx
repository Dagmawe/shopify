import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { logThrown } from "../lib/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (thrown) {
    logThrown("app layout", request, thrown);
    throw thrown;
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/reorder">Reorder</s-link>
        <s-link href="/app/purchase-orders">Purchase orders</s-link>
        <s-link href="/app/products">Case settings</s-link>
        <s-link href="/app/distributors">Distributors</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their
// headers are included in the response. Anything else is shown on screen
// instead of a blank page, so problems are easy to report.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    if (error.data) return boundary.error(error);
    return (
      <div style={{ padding: 16, fontFamily: "Inter, sans-serif" }}>
        Corkcount is reconnecting to Shopify (status {error.status}
        {error.statusText ? ` ${error.statusText}` : ""}). If this stays on
        screen, check the terminal running <code>npm run dev</code>.
      </div>
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ padding: 16, fontFamily: "Inter, sans-serif" }}>
      <p>
        <strong>Corkcount hit an error:</strong> {message}
      </p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

