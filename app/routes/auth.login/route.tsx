import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { login } from "../../shopify.server";

// App Store rule 2.3.1: installs must start from Shopify, and the app must
// never ask merchants to type in their store's address. When Shopify sends a
// merchant here it includes the shop, and login() redirects them on to
// Shopify's sign-in. Anyone arriving without one is told where to go instead
// of being shown a form.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    await login(request);
  }
  return null;
};

export const meta: MetaFunction = () => [{ title: "Open CaseFlow from Shopify" }];

export default function Auth() {
  return (
    <main
      style={{
        fontFamily: "Inter, -apple-system, sans-serif",
        maxWidth: 480,
        margin: "15vh auto",
        padding: "0 16px",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Open CaseFlow from Shopify</h1>
      <p>
        CaseFlow runs inside your Shopify admin. Go to your Shopify admin, choose{" "}
        <strong>Apps</strong>, then <strong>CaseFlow</strong>. If it isn&apos;t installed
        yet, install it from the Shopify App Store.
      </p>
    </main>
  );
}
