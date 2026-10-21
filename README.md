# B2B Order Minimums & Case-Pack Validator (`b2b-order-validator`)

A production-ready Shopify B2B app built with **Remix (React Router)**, **Shopify Polaris**, **Prisma**, and **Shopify Cart & Checkout Validation Functions (`purchase.validation.run`)**.

## Configured Partner & Store Details
- **Partner Dashboard:** `https://partners.shopify.com/5246084/`
- **Development Store:** `dlegesse-store.myshopify.com` (`https://admin.shopify.com/store/dlegesse-store`)

---

## Project Architecture

1. **[shopify.app.toml](./shopify.app.toml)** — Pre-configured for `dlegesse-store.myshopify.com` with `read_products,read_customers,read_validations,write_validations` scopes.
2. **[prisma/schema.prisma](./prisma/schema.prisma)** — Stores Shopify OAuth sessions (`Session`) and merchant B2B validation rules (`B2bValidationRule`).
3. **[extensions/b2b-cart-validator/src/run.ts](./extensions/b2b-cart-validator/src/run.ts)** — The **Shopify Cart & Checkout Validation Function** (compiles to WebAssembly and runs in <5ms on Shopify's checkout servers). Enforces:
   - **Customer Tag Targeting:** Apply rules to `B2B` / `Wholesale` tagged accounts, Retail/Non-B2B shoppers, or all shoppers.
   - **Minimum Order Value (MOV):** e.g., $500.00 minimum wholesale subtotal.
   - **Minimum Order Quantity (MOQ):** e.g., 12 minimum total units.
   - **Per-SKU Case-Pack Multiples:** e.g., must order in multiples of 6 per SKU.
   - **Mix-and-Match Full Case Multiples:** e.g., total units across the cart must be divisible by 12.
4. **[app/routes/app._index.tsx](./app/routes/app._index.tsx)** — Embedded Shopify Admin Dashboard built with Polaris, featuring:
   - Rule table & creation form
   - 1-click **Sync to Shopify Checkout** (calls `validationCreate` / `validationUpdate` GraphQL mutations and writes the `$app:b2b_validator.rules_config` JSON metafield)
   - **Live B2B Cart & Checkout Simulator** so merchants can test their rules right inside the Admin UI.

---

## Quick Start (Connect to Your Partner Account & Run Locally)

1. **Install dependencies & initialize database:**
   ```bash
   npm install
   npx prisma generate
   npx prisma db push
   ```

2. **Link to your Shopify Partner Account (`5246084`) and run on `dlegesse-store.myshopify.com`:**
   ```bash
   npm run dev
   ```
   *(On first run, Shopify CLI will prompt you to log into your Partner account in the browser, create the app under Partner ID `5246084`, and generate a preview URL on `dlegesse-store.myshopify.com`.)*
