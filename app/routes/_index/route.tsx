import { useState } from "react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";

import { SitePage, siteFontLinks } from "../../components/site";
import styles from "../../styles/site.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify opens the app with ?shop=...; send those requests into the app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const links: LinksFunction = () => siteFontLinks;

export const meta: MetaFunction = () => [
  { title: "Corkcount: case ordering for wine & liquor stores on Shopify" },
  {
    name: "description",
    content:
      "Order from distributors by the case, receive deliveries in one count, and see what to reorder. Corkcount keeps your Shopify stock in bottles.",
  },
];

const CASE_SIZE = 12;

// Shopify installs must start from Shopify, so this page deliberately has no
// "enter your store" form (App Store rule 2.3.1).
export default function Landing() {
  const [inCase, setInCase] = useState<boolean[]>(() => Array(CASE_SIZE).fill(true));
  const bottles = inCase.filter(Boolean).length;
  const sold = CASE_SIZE - bottles;

  return (
    <SitePage>
      <main>
        <section className={styles.hero}>
          <div>
            <h1 className={styles.title}>Order by the case. Sell by the bottle.</h1>
            <p className={styles.lede}>
              Your distributor ships in cases of 6, 12 or 24. Shopify counts single bottles.
              Corkcount handles the conversion, so purchase orders, deliveries and reorder
              alerts all line up with what&apos;s on your shelf.
            </p>
            <p className={styles.install}>
              <strong>Built for wine and liquor shops on Shopify.</strong> Install it from the
              Shopify App Store, then open it from Apps in your Shopify admin.
            </p>
          </div>

          <figure className={styles.caseFigure}>
            <div className={styles.carton} role="group" aria-label="A 12-bottle case, seen from above">
              {inCase.map((full, i) => (
                <button
                  key={i}
                  type="button"
                  className={styles.slot}
                  disabled={!full}
                  aria-label={full ? `Sell bottle ${i + 1}` : `Bottle ${i + 1} sold`}
                  onClick={() =>
                    setInCase((prev) => prev.map((v, j) => (j === i ? false : v)))
                  }
                >
                  <span className={full ? styles.cork : styles.empty} />
                </button>
              ))}
            </div>
            <div className={styles.readout} aria-live="polite">
              <span className={styles.count}>
                {bottles} {bottles === 1 ? "bottle" : "bottles"}
              </span>
              <span className={styles.caseMath}>
                {bottles === CASE_SIZE
                  ? "1 full case"
                  : `${sold} sold, ${bottles} left in the case`}
              </span>
            </div>
            <figcaption className={styles.caption}>
              {sold === 0 ? (
                "Click a cork to sell a bottle."
              ) : bottles > 3 ? (
                "Shopify sees each bottle. Your distributor sees cases."
              ) : bottles > 0 ? (
                "Below your reorder point: Corkcount suggests another case."
              ) : (
                <>
                  Out of stock, and the reorder was due three bottles ago.{" "}
                  <button
                    type="button"
                    className={styles.reset}
                    onClick={() => setInCase(Array(CASE_SIZE).fill(true))}
                  >
                    Restock the case
                  </button>
                </>
              )}
            </figcaption>
          </figure>
        </section>

        <section className={styles.steps} aria-labelledby="how">
          <h2 id="how" className={styles.sectionTitle}>
            How it works
          </h2>
          <ol className={styles.stepList}>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Order in cases</h3>
              <p className={styles.stepText}>
                Build a purchase order per distributor in cases and extra bottles, check it
                against their minimum, and email it to your rep.
              </p>
            </li>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Receive in one count</h3>
              <p className={styles.stepText}>
                When the truck arrives, enter what came off it. Corkcount adds the right
                number of bottles to your Shopify stock and tracks anything still owed.
              </p>
            </li>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Reorder before you run out</h3>
              <p className={styles.stepText}>
                Set a reorder point and a target for each product. Corkcount lists what&apos;s
                low, grouped by distributor, with the number of cases to order.
              </p>
            </li>
          </ol>
        </section>
      </main>
    </SitePage>
  );
}
