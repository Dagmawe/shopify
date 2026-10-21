import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { requireApp } from "../lib/context.server";
import { getAppHandle, planSelectionUrl } from "../lib/plan.server";
import { getLocations } from "../lib/shopify-data.server";
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
      (onlyDistributor == null || String(r.distributorId) === String(onlyDistributor)),
  );
  if (!rows.length) return { error: "Nothing to reorder from a linked distributor." };

  const location = (await getLocations(admin))[0];
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

export default function Reorder() {
  const { groups, canAutoDraft, upgradeUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const linkedGroups = groups.filter((g) => g.distributorId != null);

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
          The Pro plan creates a draft purchase order for each distributor from this list.{" "}
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
          const cases = g.rows.reduce((sum, r) => sum + r.cases, 0);
          const costKnown = g.rows.every((r) => r.costPerCase != null);
          const cost = g.rows.reduce((sum, r) => sum + (r.costPerCase ?? 0) * r.cases, 0);
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
                        <s-table-cell>Order {r.cases} cs</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {g.distributorId != null && (
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
                      <s-button href="/app/purchase-orders/new">New purchase order</s-button>
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
