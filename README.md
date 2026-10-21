# CaseFlow

**Order by the case. Sell by the bottle.**
Purchase ordering, receiving and reorder alerts for wine and liquor stores on Shopify.

Shopify counts stock in single bottles, but distributors sell in cases of 6, 12 or 24. CaseFlow sits in between: stores order and receive in cases, and CaseFlow converts to bottles and updates their Shopify stock.

---

## What the app does

| Page | What it's for |
|---|---|
| **Home** | Setup checklist, what needs reordering, deliveries due this week |
| **Reorder** | Products at or below their reorder point, grouped by distributor, with suggested cases. Pro: one click turns each group into a draft purchase order |
| **Purchase orders** | Draft → Ordered → Partly received → Received. Order in cases plus extra bottles, email the order to the distributor, then receive what arrived |
| **Case settings** | For each product: bottles per case, cost per case, reorder point, par level, distributor |
| **Distributors** | Contacts, lead time and minimum order (warns when an order is under the minimum) |

**How reorder suggestions work.** When *bottles on hand + bottles already on order* drops to the reorder point, CaseFlow suggests enough whole cases to get back to the par level. Example: reorder point 12, par 48, 10 on hand, nothing on order → 38 bottles short → **4 cases** of 12.

**Plans** (set up in Shopify, see step 6 below):

| | Starter $29 | Pro $59 | Premium $99 |
|---|---|---|---|
| Distributors, purchase orders, receiving, reorder alerts | ✓ | ✓ | ✓ |
| Receive into more than one location | | ✓ | ✓ |
| One-click draft orders from Reorder page | | ✓ | ✓ |
| Priority support (you provide this) | | | ✓ |

Premium currently unlocks the same app features as Pro. Use it for priority support, and for wine-specific features you add later (vintages, allocations, mixed cases).

---

## Step-by-step: run it on your computer

You'll type commands into a **terminal** (Terminal on Mac, PowerShell on Windows). Copy each command exactly.

### 1. Install the tools (one time)

1. **Node.js 22.12 or newer** — download the "LTS" version from [nodejs.org](https://nodejs.org) and install it. Check it worked: `node -v` should print `v22.12` or higher.
2. **Shopify CLI** — run:
   ```
   npm install -g @shopify/cli@latest
   ```
3. **Git** (Mac: run `git --version` and accept the install prompt; Windows: [git-scm.com](https://git-scm.com)).

### 2. Create your Shopify accounts (one time, free)

1. Sign up at [shopify.com/partners](https://www.shopify.com/partners). This is your developer account.
2. In the Partner Dashboard, go to **Stores → Add store → Create development store**. Pick "Create a store to test and build". Add a few wine products with stock so you have something to test with.

### 3. Open the project and install it

Unzip CaseFlow, then in the terminal:

```
cd path/to/caseflow
npm install
cp .env.example .env
```

(On Windows PowerShell use `copy .env.example .env` for the last line.)

`npm install` downloads everything the app needs; it takes a few minutes.

### 4. Connect it to Shopify and start it

```
npm run config:link
```

Choose **"Yes, create it as a new app"** and name it **CaseFlow**. This fills in `shopify.app.toml` for you.

Then start the app:

```
npm run dev
```

The first time, it asks you to log in to your Partner account and pick your development store. When it's running, press **P** to open the app in your store. Approve the install screen.

Stop the app any time with **Ctrl + C**; start it again with `npm run dev`.

### 5. Try the whole flow (10 minutes)

1. **Distributors** → add one, with your own email as the order email.
2. **Case settings** → for a few products set bottles per case (e.g. 12), a cost per case, reorder point (e.g. 12), par level (e.g. 48), and choose the distributor. Click **Save changes**.
3. In Shopify admin, lower one of those products' stock below 12.
4. **Reorder** → the product appears with a suggested number of cases. Click **Create draft order**.
5. On the purchase order: adjust quantities, click **Email to distributor** (opens your email app), then **Mark as ordered**.
6. Enter what "arrived" (e.g. 2 cases + 3 bottles) and click **Add to stock**. Check the product in Shopify admin: stock went up by 27.

### 6. Set up your pricing plans (before launch)

CaseFlow uses Shopify **managed pricing**: Shopify shows the plan picker, runs the free trial and bills the merchant. You don't write billing code.

1. Partner Dashboard → **Apps → CaseFlow → Distribution** → choose **Shopify App Store**.
2. In the listing, go to **Pricing** and choose **Managed pricing**.
3. Create three monthly plans with a **14-day free trial**. The names must contain these words, because the app reads them:
   - `Starter` — $29/month
   - `Pro` — $59/month
   - `Premium` — $99/month
4. In `.env`, delete the line `CASEFLOW_BILLING_BYPASS=true` and set `SHOPIFY_APP_HANDLE` to your app's handle (the last part of the app's Partner Dashboard URL).
5. Restart with `npm run dev`. Opening the app now sends you to Shopify's plan page. Development stores aren't charged.

---

## Launching on the Shopify App Store

### Put the app on a server

`npm run dev` only runs while your computer is on. For real merchants the app needs a server:

- Shopify's guide lists hosts that work well (Fly.io, Render, Railway, Google Cloud Run): [shopify.dev/docs/apps/launch/deployment](https://shopify.dev/docs/apps/launch/deployment). Expect roughly $5–25/month at the start.
- **Switch the database to PostgreSQL** before launch. The included SQLite database is a single file, which is fine for testing but not for a live app. Most hosts offer a managed Postgres; change `provider = "sqlite"` to `"postgresql"` in `prisma/schema.prisma`, set `url = env("DATABASE_URL")`, delete the `prisma/migrations` folder, and run `npx prisma migrate dev --name init` once.
- Set `NODE_ENV=production`, and make sure `CASEFLOW_BILLING_BYPASS` is **not** set on the server.
- Run `npm run deploy` to push your app configuration (scopes, webhooks) to Shopify.

### Submit for review

1. Partner Dashboard → your app → **Distribution → Shopify App Store → App Store review**.
2. Fill in the listing: name, icon (1200×1200 PNG/JPG), screenshots, description. Don't use Shopify's logo, don't promise revenue results, and don't put "Shopify" in your app's URL.
3. **Protected customer data:** choose **opt out**. CaseFlow doesn't read customer information, which keeps your review simpler.
4. Add an emergency contact email and phone.
5. Run the **automated checks** on that page and fix anything they flag.
6. Provide a **screencast** (2–5 minutes, screen recording of the step 5 flow above) and **test-store login instructions** for the reviewer.
7. Submit. Shopify says 5–10 business days; in 2026 many developers have waited 2–6 weeks. Reply to reviewer emails promptly: repeated unanswered or unfixed issues can get a submission temporarily suspended.

### What's already handled for review

- Embedded in Shopify admin with Polaris components and App Bridge
- Required privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are verified and answered; `shop/redact` deletes all of a store's data
- Minimal permissions: read products, read/write inventory, read locations
- Stock updates use Shopify's compare-and-set and idempotency keys, so a sale at the same moment, or a double click, can't corrupt inventory counts

---

## Where things live (for when you change the code)

```
app/
  lib/units.ts                 Case ↔ bottle math and reorder suggestions
  lib/shopify-data.server.ts   Every Shopify API call (products, stock, locations)
  lib/plan.server.ts           Which plan a store is on and what it unlocks
  lib/context.server.ts        Sign-in + plan check every page runs first
  models/                      Purchase order and reorder logic
  routes/app.*.tsx             The pages (one file per page)
  routes/webhooks.*.tsx        Messages Shopify sends the app
prisma/schema.prisma           Database tables
shopify.app.toml               App permissions and webhooks
```

`docs/TEMPLATE_README.md` is Shopify's original template guide, with troubleshooting for common setup errors.

## Ideas for later versions

- **Wine & spirits features for Premium:** vintage tracking, allocated items, mixed cases, deposit/bottle-fee handling
- **Barcode receiving:** scan case barcodes in Shopify POS while receiving
- **Sales-velocity reorder points:** suggest reorder points from the last 60 days of sales instead of entering them by hand
- **Import from spreadsheet:** upload a distributor's price list to fill costs and case sizes
- **PDF purchase orders** sent directly from the app
