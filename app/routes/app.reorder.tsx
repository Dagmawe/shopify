import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { requireApp } from "../lib/context.server";
import { getAppHandle, planSelectionUrl } from "../lib/plan.server";
import { getAvailable, getLocations } from "../lib/shopify-data.server";
import { formatMoney, formatUnits } from "../lib/units";
import { nextPoNumber } from "../models/purchase-orders.server";
import { getReorderRows, type ReorderRow } from "../models/reorder.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, plan } = await requireApp(request);
  const rows = await getReorderRows(admin, shop);

  const groups = new Map<string, { distributorId: number | null; name: string; rows: ReorderRow[] }>();
  for (const row of rows) {
    const key = row.distributorId == null ? "none" : String(row.distributorId);
    if (!groups.has(key)) {
      groups.set(key, {
        distributorId: row.distributorId,
        name: row.distributorName ?? "No distributor linked",
        rows: [],
      });
    }
    groups.get(key)!.rows.push(row);
  }

  return {
    groups: Array.from(groups.values()).sort((a, b) =>
      a.distributorId == null ? 1 : b.distributorId == null ? -1 : a.name.localeCompare(b.name),
    ),
    canAutoDraft: plan.autoDraftOrders,
    upgradeUrl: planSelectionUrl(shop, await getAppHandle(admin)),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, plan } = await requireApp(request);
  if (!plan.autoDraftOrders) {
    return { error: "One-click draft orders are included in the Pro plan." };
  }

  const form = await request.formData();
  const onlyDistributor = form.get("distributorId");
  const rows = (await getReorderRows(admin, shop)).filter(
    (r) =>
      r.distributorId != null &&
      r.draft == null &&
      (onlyDistributor == null || String(r.distributorId) === String(onlyDistributor)),
  );
  if (!rows.length) {
    return { error: "These products are already on a draft order. Open it from Purchase orders." };
  }

  const locations = await getLocations(admin);
  const byDistributor = new Map<number, ReorderRow[]>();
  for (const r of rows) {
    const list = byDistributor.get(r.distributorId!) ?? [];
    list.push(r);
    byDistributor.set(r.distributorId!, list);
  }

  const settingIds = rows.map((r) => r.settingId);
  const settings = new Map(
    (await db.productSetting.findMany({ where: { id: { in: settingIds }, shop } })).map((s) => [s.id, s]),
  );

  let created = 0;
  let lastId = 0;
  for (const [distributorId, list] of byDistributor) {
    const location = await busiestLocation(
      admin,
      locations,
      list.map((r) => r.inventoryItemId),
    );
    const order = await db.purchaseOrder.create({
      data: {
        shop,
        number: await nextPoNumber(shop),
        distributorId,
        locationId: location?.id ?? null,
        locationName: location?.name ?? null,
        lines: {
          create: list.map((r) => ({
            variantId: r.variantId,
            inventoryItemId: settings.get(r.settingId)!.inventoryItemId,
            title: r.title,
            sku: r.sku,
            caseSize: r.caseSize,
            casesOrdered: r.cases,
            looseOrdered: 0,
            costPerCase: r.costPerCase,
          })),
        },
      },
    });
    created++;
    lastId = order.id;
  }

  if (created === 1) return redirect(`/app/purchase-orders/${lastId}`);
  return redirect("/app/purchase-orders");
};

// Deliver to the location that already holds most of these products, so
// stock lands where it's sold. Falls back to the first location.
async function busiestLocation(
  admin: Parameters<typeof getAvailable>[0],
  locations: Awaited<ReturnType<typeof getLocations>>,
  inventoryItemIds: string[],
) {
  if (locations.length <= 1) return locations[0];
  let best = locations[0];
  let bestTotal = -1;
  for (const loc of locations) {
    const levels = await getAvailable(admin, inventoryItemIds, loc.id);
    const total = Array.from(levels.values()).reduce((sum, q) => sum + Math.max(0, q), 0);
    if (total > bestTotal) {
      best = loc;
      bestTotal = total;
    }
  }
  return best;
}

export default function Reorder() {
  const { groups, canAutoDraft, upgradeUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const linkedGroups = groups.filter(
    (g) => g.distributorId != null && g.rows.some((r) => r.draft == null),
  );

  return (
    <s-page heading="Reorder">
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      {canAutoDraft && linkedGroups.length > 1 && (
        <s-section>
          <Form method="post">
            <s-stack direction="inline" gap="base">
              <s-text>
                {linkedGroups.length} distributors have products to reorder.
              </s-text>
              <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
                Draft all {linkedGroups.length} orders
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      )}

      {!canAutoDraft && groups.length > 0 && (
        <s-banner tone="info" heading="Turn these into orders in one click">
          One-click draft orders are included in the Pro plan. On Starter, create orders with New
          purchase order.{" "}
          <s-link href={upgradeUrl} target="_top">
            See plans
          </s-link>
        </s-banner>
      )}

      {groups.length === 0 ? (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Nothing needs reordering right now. Products show up here when stock on hand plus stock
              on order drops to their reorder point.
            </s-paragraph>
            <s-button href="/app/products">Set reorder points</s-button>
          </s-stack>
        </s-section>
      ) : (
        groups.map((g) => {
          const toOrder = g.rows.filter((r) => r.draft == null);
          const cases = toOrder.reduce((sum, r) => sum + r.cases, 0);
          const costKnown = toOrder.every((r) => r.costPerCase != null);
          const cost = toOrder.reduce((sum, r) => sum + (r.costPerCase ?? 0) * r.cases, 0);
          return (
            <s-section key={g.distributorId ?? "none"} heading={g.name}>
              <s-stack direction="block" gap="base">
                {g.distributorId == null && (
                  <s-paragraph>
                    Link these products to a distributor on the Case settings page to order them.
                  </s-paragraph>
                )}
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header>On hand</s-table-header>
                    <s-table-header>On order</s-table-header>
                    <s-table-header>Reorder at</s-table-header>
                    <s-table-header format="numeric">Suggested</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {g.rows.map((r) => (
                      <s-table-row key={r.settingId}>
                        <s-table-cell>
                          <s-stack direction="block">
                            <s-text>{r.title}</s-text>
                            {r.sku && <s-text color="subdued">{r.sku}</s-text>}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          {r.available <= 0 ? (
                            <s-badge tone="critical">Out of stock</s-badge>
                          ) : (
                            formatUnits(r.available, r.caseSize)
                          )}
                        </s-table-cell>
                        <s-table-cell>{r.incoming ? formatUnits(r.incoming, r.caseSize) : "—"}</s-table-cell>
                        <s-table-cell>{formatUnits(r.reorderPoint, r.caseSize)}</s-table-cell>
                        <s-table-cell>
                          {r.draft ? (
                            <s-link href={`/app/purchase-orders/${r.draft.orderId}`}>
                              In draft #{r.draft.number}
                            </s-link>
                          ) : (
                            `Order ${r.cases} cs`
                          )}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {g.distributorId != null && toOrder.length === 0 && (
                  <s-paragraph>
                    Already on a draft order. Place it with {g.name}, then mark it as ordered.
                  </s-paragraph>
                )}
                {g.distributorId != null && toOrder.length > 0 && (
                  <s-stack direction="inline" gap="base">
                    <s-text>
                      {cases} cases{costKnown ? ` · about ${formatMoney(cost)}` : ""}
                    </s-text>
                    {canAutoDraft ? (
                      <Form method="post">
                        <input type="hidden" name="distributorId" value={String(g.distributorId)} />
                        <s-button type="submit" {...(saving ? { loading: true } : {})}>
                          Create draft order
                        </s-button>
                      </Form>
                    ) : (
                      <>
                        <s-button disabled>Create draft order</s-button>
                        <s-text color="subdued">Pro plan</s-text>
                        <s-button href="/app/purchase-orders/new">New purchase order</s-button>
                      </>
                    )}
                  </s-stack>
                )}
              </s-stack>
            </s-section>
          );
        })
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
