import type { LinksFunction, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { SitePage, siteFontLinks } from "../components/site";
import styles from "../styles/site.module.css";

// Keep this page in step with what the app actually stores. Data lives in
// prisma/schema.prisma; Shopify access is set in shopify.app*.toml.

export const loader = () => ({
  supportEmail: process.env.CORKCOUNT_SUPPORT_EMAIL || null,
});

export const links: LinksFunction = () => siteFontLinks;

export const meta: MetaFunction = () => [
  { title: "Privacy policy · Corkcount" },
  {
    name: "description",
    content: "What Corkcount stores, why, where it's kept, and how it's deleted.",
  },
];

export default function Privacy() {
  const { supportEmail } = useLoaderData<typeof loader>();
  const contact = supportEmail ? (
    <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
  ) : (
    "the Support link on Corkcount's Shopify App Store listing"
  );

  return (
    <SitePage>
      <main className={styles.doc}>
        <h1>Privacy policy</h1>
        <p className={styles.updated}>Last updated October 23, 2026</p>

        <p>
          Corkcount is a Shopify app made by Dagmawe Legesse (&quot;we&quot;), an independent developer. It helps wine
          and liquor stores order from distributors, receive deliveries and reorder stock.
          This policy explains what information Corkcount handles for the stores that
          install it (&quot;merchants&quot;).
        </p>

        <h2>The short version</h2>
        <ul>
          <li>Corkcount does not access your customers&apos; personal information.</li>
          <li>It stores only what it needs to run your purchase orders.</li>
          <li>We don&apos;t sell or share your data, and we delete it after you uninstall.</li>
        </ul>

        <h2>What Corkcount reads from your Shopify store</h2>
        <p>With your permission at install, Corkcount reads:</p>
        <ul>
          <li>Products and variants: names, SKUs and stock quantities.</li>
          <li>Inventory levels at each of your locations.</li>
          <li>Your location names.</li>
        </ul>
        <p>
          When you record a delivery, Corkcount increases the stock of the products you
          received at the location you choose. It does not read orders, customers or
          payment information.
        </p>

        <h2>What Corkcount stores</h2>
        <ul>
          <li>
            <strong>Your store&apos;s Shopify address and access token</strong>, so the app
            can sign in to your store.
          </li>
          <li>
            <strong>Distributors you add</strong>: names, sales rep names, order email
            addresses, phone numbers, lead times, minimum orders and notes.
          </li>
          <li>
            <strong>Case settings</strong> for your products: bottles per case, cost per
            case, reorder point, target stock and distributor.
          </li>
          <li>
            <strong>Purchase orders</strong>: products, quantities, costs, dates and what
            has been received.
          </li>
        </ul>
        <p>
          When you email a purchase order, Corkcount opens your own email program with the
          order filled in. The email is sent from your account. Corkcount doesn&apos;t send
          or keep a copy.
        </p>

        <h2>How we use it</h2>
        <p>
          Only to provide Corkcount&apos;s features to your store. We don&apos;t use your data
          for advertising, sell it, or share it with anyone except the service providers
          below.
        </p>

        <h2>Where it&apos;s kept</h2>
        <p>
          Corkcount runs on servers provided by Render (render.com) in the United States.
          Data is sent between your browser, Shopify and Corkcount over encrypted
          connections (HTTPS). Shopify handles billing for Corkcount&apos;s plans; we
          don&apos;t receive your payment details.
        </p>

        <h2>Deletion</h2>
        <p>
          When you uninstall Corkcount, its access to your store ends immediately. Shopify
          then tells us to delete your store&apos;s data, and Corkcount deletes your
          distributors, case settings, purchase orders and access token within 48 hours. To
          ask for deletion sooner, or for a copy of your data, contact us at {contact}.
        </p>

        <h2>Your customers</h2>
        <p>
          Corkcount has no access to your customers&apos; information. If Shopify forwards a
          customer&apos;s request to see or delete their data, there is nothing in Corkcount
          to return or delete.
        </p>

        <h2>Changes and contact</h2>
        <p>
          If this policy changes, we&apos;ll update the date at the top of this page.
          Questions: {contact}.
        </p>
      </main>
    </SitePage>
  );
}
