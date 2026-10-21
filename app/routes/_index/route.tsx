import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const meta: MetaFunction = () => [
  { title: "Corkcount: purchase orders for wine & liquor stores" },
  {
    name: "description",
    content:
      "Order from distributors by the case, receive deliveries in one click, and get reorder alerts. Built for Shopify wine and liquor stores.",
  },
];

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Order by the case. Sell by the bottle.</h1>
        <p className={styles.text}>
          Corkcount is purchase ordering and receiving for wine and liquor stores on Shopify.
        </p>
        {/* Shopify requires installs to start from the Shopify App Store or
            admin, so there is deliberately no "enter your store" form here. */}
        <p className={styles.text}>
          Install Corkcount from the Shopify App Store, then open it from your
          Shopify admin.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Case-pack purchasing</strong>. Order from distributors in
            cases; Corkcount converts to bottles for your Shopify stock.
          </li>
          <li>
            <strong>Fast receiving</strong>. Count what arrived, click once,
            and your stock is updated.
          </li>
          <li>
            <strong>Reorder alerts</strong>. See what's running low, grouped by
            distributor, with suggested case quantities.
          </li>
        </ul>
      </div>
    </div>
  );
}
