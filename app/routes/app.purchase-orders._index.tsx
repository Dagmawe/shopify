import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { requireApp, shopCurrency } from "../lib/context.server";
import { formatCasesAndBottles, formatMoney } from "../lib/units";
import { poTotals } from "../models/purchase-orders.server";
import { STATUS_LABEL, STATUS_TONE } from "../lib/status";

const LIST_LIMIT = 200;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireApp(request);
  const url = new URL(request.url);
  const show = url.searchParams.get("show") === "all" ? "all" : "open";

  const orders = await db.purchaseOrder.findMany({
    where: {
      shop,
      ...(show === "open" ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL"] } } : {}),
    },
    orderBy: { number: "desc" },
    take: LIST_LIMIT,
    include: { distributor: { select: { name: true } }, lines: true },
  });

  const anyOrders = orders.length > 0 || (await db.purchaseOrder.count({ where: { shop } })) > 0;

  return {
    currency: await shopCurrency(admin, shop),
    show,
    anyOrders,
    truncated: orders.length === LIST_LIMIT,
    orders: orders.map((o) => {
      const totals = poTotals(o.lines);
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        distributor: o.distributor.name,
        quantity: formatCasesAndBottles(totals.cases, totals.loose),
        cost: totals.cost,
        expectedAt: o.expectedAt?.toISOString().slice(0, 10) ?? null,
        createdAt: o.createdAt.toISOString().slice(0, 10),
      };
    }),
  };
};

export default function PurchaseOrders() {
  const { orders, show, anyOrders, truncated, currency } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Purchase orders">
      <s-button slot="primary-action" variant="primary" href="/app/purchase-orders/new">
        New purchase order
      </s-button>
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-button variant={show === "open" ? "primary" : "secondary"} href="/app/purchase-orders">
            Open
          </s-button>
          <s-button
            variant={show === "all" ? "primary" : "secondary"}
            href="/app/purchase-orders?show=all"
          >
            All
          </s-button>
        </s-stack>
      </s-section>
      <s-section>
        {orders.length === 0 && anyOrders ? (
          <s-paragraph>
            No open purchase orders. Received and cancelled orders are under All.
          </s-paragraph>
        ) : orders.length === 0 ? (
          <s-paragraph>
            No purchase orders yet. Create one here, or let the Reorder page build drafts for you
            from products that are running low.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">PO</s-table-header>
              <s-table-header>Distributor</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Quantity</s-table-header>
              <s-table-header format="currency">Cost</s-table-header>
              <s-table-header>Expected</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((o) => (
                <s-table-row key={o.id} clickDelegate={`po-${o.id}`}>
                  <s-table-cell>
                    <s-link id={`po-${o.id}`} href={`/app/purchase-orders/${o.id}`}>
                      #{o.number}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{o.distributor}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[o.status] ?? "neutral"}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{o.quantity}</s-table-cell>
                  <s-table-cell>{formatMoney(o.cost, currency)}</s-table-cell>
                  <s-table-cell>{o.expectedAt ? `Due ${o.expectedAt}` : "No delivery date"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {truncated && (
          <s-paragraph>
            <s-text color="subdued">Showing your {LIST_LIMIT} most recent orders.</s-text>
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
