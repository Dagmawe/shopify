import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { requireApp } from "../lib/context.server";
import { getReorderRows } from "../models/reorder.server";
import { OPEN_STATUSES } from "../models/purchase-orders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, plan } = await requireApp(request);

  const [distributorCount, settingCount, drafts, open, expectedSoon, reorder] = await Promise.all([
    db.distributor.count({ where: { shop } }),
    db.productSetting.count({
      where: { shop, OR: [{ reorderPoint: { gt: 0 } }, { parLevel: { gt: 0 } }] },
    }),
    db.purchaseOrder.count({ where: { shop, status: "DRAFT" } }),
    db.purchaseOrder.count({ where: { shop, status: { in: OPEN_STATUSES } } }),
    db.purchaseOrder.findMany({
      where: {
        shop,
        status: { in: OPEN_STATUSES },
        expectedAt: { lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
      },
      orderBy: { expectedAt: "asc" },
      take: 5,
      include: { distributor: { select: { name: true } } },
    }),
    getReorderRows(admin, shop),
  ]);

  return {
    plan: plan.name,
    setupDone: distributorCount > 0 && settingCount > 0,
    distributorCount,
    settingCount,
    drafts,
    open,
    lowCount: reorder.length,
    outCount: reorder.filter((r) => r.available <= 0).length,
    expectedSoon: expectedSoon.map((o) => ({
      id: o.id,
      number: o.number,
      distributor: o.distributor.name,
      expectedAt: o.expectedAt?.toISOString().slice(0, 10) ?? "",
      late: o.expectedAt ? o.expectedAt.getTime() < Date.now() - 24 * 3600 * 1000 : false,
    })),
  };
};

export default function Home() {
  const d = useLoaderData<typeof loader>();

  return (
    <s-page heading="CaseFlow">
      {!d.setupDone && (
        <s-section heading="Get set up in three steps">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-badge tone={d.distributorCount > 0 ? "success" : "neutral"}>
                {d.distributorCount > 0 ? "Done" : "Step 1"}
              </s-badge>
              <s-link href="/app/distributors">Add the distributors you buy from</s-link>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-badge tone={d.settingCount > 0 ? "success" : "neutral"}>
                {d.settingCount > 0 ? "Done" : "Step 2"}
              </s-badge>
              <s-link href="/app/products">
                Set bottles per case, reorder points and distributors for your products
              </s-link>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-badge tone="neutral">Step 3</s-badge>
              <s-link href="/app/reorder">Check what needs reordering</s-link>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Today">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block">
            <s-text color="subdued">Need reordering</s-text>
            <s-heading>{d.lowCount}</s-heading>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Out of stock</s-text>
            <s-heading>{d.outCount}</s-heading>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Draft orders</s-text>
            <s-heading>{d.drafts}</s-heading>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Orders on the way</s-text>
            <s-heading>{d.open}</s-heading>
          </s-stack>
        </s-stack>
        {d.lowCount > 0 && (
          <s-button href="/app/reorder" variant="primary">
            Review reorders
          </s-button>
        )}
      </s-section>

      <s-section heading="Arriving this week">
        {d.expectedSoon.length === 0 ? (
          <s-paragraph>No deliveries expected in the next seven days.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">PO</s-table-header>
              <s-table-header>Distributor</s-table-header>
              <s-table-header>Expected</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.expectedSoon.map((o) => (
                <s-table-row key={o.id} clickDelegate={`home-po-${o.id}`}>
                  <s-table-cell>
                    <s-link id={`home-po-${o.id}`} href={`/app/purchase-orders/${o.id}`}>
                      #{o.number}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{o.distributor}</s-table-cell>
                  <s-table-cell>
                    {o.late ? <s-badge tone="warning">Late · {o.expectedAt}</s-badge> : o.expectedAt}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Your plan">
        <s-paragraph>You're on the {d.plan} plan.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
