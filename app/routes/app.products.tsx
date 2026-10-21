import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { floatField, intField, requireApp, textField } from "../lib/context.server";
import { searchVariants } from "../lib/shopify-data.server";
import { formatUnits } from "../lib/units";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireApp(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const after = url.searchParams.get("after");

  const [page, distributors] = await Promise.all([
    searchVariants(admin, q, after),
    db.distributor.findMany({ where: { shop }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const settings = await db.productSetting.findMany({
    where: { shop, variantId: { in: page.rows.map((r) => r.variantId) } },
  });
  const byVariant = new Map(settings.map((s) => [s.variantId, s]));

  const rows = page.rows.map((r) => {
    const s = byVariant.get(r.variantId);
    return {
      ...r,
      caseSize: s?.caseSize ?? 12,
      costPerCase: s?.costPerCase ?? null,
      reorderPoint: s?.reorderPoint ?? 0,
      parLevel: s?.parLevel ?? 0,
      distributorId: s?.distributorId ?? null,
    };
  });

  return { rows, distributors, q, endCursor: page.endCursor, hasNextPage: page.hasNextPage };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireApp(request);
  const form = await request.formData();
  const count = intField(form, "rowCount", 0);
  const distributorIds = new Set(
    (await db.distributor.findMany({ where: { shop }, select: { id: true } })).map((d) => d.id),
  );

  let saved = 0;
  for (let i = 0; i < count; i++) {
    const variantId = textField(form, `variantId_${i}`);
    const inventoryItemId = textField(form, `inventoryItemId_${i}`);
    const title = textField(form, `title_${i}`);
    if (!variantId || !inventoryItemId || !title) continue;

    const distributorRaw = intField(form, `distributorId_${i}`, 0);
    const data = {
      inventoryItemId,
      title,
      sku: textField(form, `sku_${i}`),
      caseSize: Math.max(1, intField(form, `caseSize_${i}`, 12)),
      costPerCase: floatField(form, `costPerCase_${i}`),
      reorderPoint: Math.max(0, intField(form, `reorderPoint_${i}`, 0)),
      parLevel: Math.max(0, intField(form, `parLevel_${i}`, 0)),
      distributorId: distributorIds.has(distributorRaw) ? distributorRaw : null,
    };
    await db.productSetting.upsert({
      where: { shop_variantId: { shop, variantId } },
      create: { shop, variantId, ...data },
      update: data,
    });
    saved++;
  }
  return { saved };
};

export default function CaseSettings() {
  const { rows, distributors, q, endCursor, hasNextPage } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.saved) shopify.toast.show(`Saved ${result.saved} product${result.saved === 1 ? "" : "s"}`);
  }, [result, shopify]);

  return (
    <s-page heading="Case settings">
      <s-section>
        <s-paragraph>
          Shopify counts stock in bottles. Set how many bottles come in a case from your
          distributor, and when to reorder. Reorder point and par level are in bottles: when stock on
          hand plus stock on order drops to the reorder point, CaseFlow suggests enough cases to get
          back to par.
        </s-paragraph>
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-search-field
              label="Search products"
              labelAccessibilityVisibility="exclusive"
              name="q"
              defaultValue={q}
              placeholder="Search by name or SKU"
            />
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section>
        {rows.length === 0 ? (
          <s-paragraph>No products found.</s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="rowCount" value={rows.length} />
            <s-stack direction="block" gap="base">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header format="numeric">On hand</s-table-header>
                  <s-table-header>Bottles per case</s-table-header>
                  <s-table-header>Cost per case</s-table-header>
                  <s-table-header>Reorder point</s-table-header>
                  <s-table-header>Par level</s-table-header>
                  <s-table-header>Distributor</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((r, i) => (
                    <s-table-row key={r.variantId}>
                      <s-table-cell>
                        <input type="hidden" name={`variantId_${i}`} value={r.variantId} />
                        <input type="hidden" name={`inventoryItemId_${i}`} value={r.inventoryItemId} />
                        <input type="hidden" name={`title_${i}`} value={r.title} />
                        <input type="hidden" name={`sku_${i}`} value={r.sku ?? ""} />
                        <s-stack direction="block">
                          <s-text>{r.title}</s-text>
                          {r.sku && <s-text color="subdued">{r.sku}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{formatUnits(r.available, r.caseSize)}</s-table-cell>
                      <s-table-cell>
                        <s-number-field
                          label="Bottles per case"
                          labelAccessibilityVisibility="exclusive"
                          name={`caseSize_${i}`}
                          defaultValue={String(r.caseSize)}
                          min={1}
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-money-field
                          label="Cost per case"
                          labelAccessibilityVisibility="exclusive"
                          name={`costPerCase_${i}`}
                          defaultValue={r.costPerCase == null ? "" : String(r.costPerCase)}
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-number-field
                          label="Reorder point"
                          labelAccessibilityVisibility="exclusive"
                          name={`reorderPoint_${i}`}
                          defaultValue={String(r.reorderPoint)}
                          min={0}
                          suffix="btl"
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-number-field
                          label="Par level"
                          labelAccessibilityVisibility="exclusive"
                          name={`parLevel_${i}`}
                          defaultValue={String(r.parLevel)}
                          min={0}
                          suffix="btl"
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-select
                          label="Distributor"
                          labelAccessibilityVisibility="exclusive"
                          name={`distributorId_${i}`}
                        >
                          <s-option value="0" {...(r.distributorId == null ? { defaultSelected: true } : {})}>
                            None
                          </s-option>
                          {distributors.map((d) => (
                            <s-option
                              key={d.id}
                              value={String(d.id)}
                              {...(r.distributorId === d.id ? { defaultSelected: true } : {})}
                            >
                              {d.name}
                            </s-option>
                          ))}
                        </s-select>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <s-stack direction="inline" gap="base">
                <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
                  Save changes
                </s-button>
                {hasNextPage && endCursor && (
                  <s-button
                    href={`/app/products?${new URLSearchParams({ q, after: endCursor }).toString()}`}
                  >
                    Next 50 products
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </Form>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
