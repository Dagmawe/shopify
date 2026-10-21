import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { floatField, intField, requireApp } from "../lib/context.server";
import { addReceivedStock } from "../lib/shopify-data.server";
import { formatMoney, formatUnits, lineCost, lineOrderedUnits, toUnits } from "../lib/units";
import {
  poTotals,
  statusAfterReceiving,
  STATUS_LABEL,
  STATUS_TONE,
} from "../models/purchase-orders.server";

async function findOrder(shop: string, idParam: string | undefined) {
  const id = Number.parseInt(idParam ?? "", 10);
  if (!Number.isFinite(id)) throw new Response("Not found", { status: 404 });
  const order = await db.purchaseOrder.findFirst({
    where: { id, shop },
    include: { distributor: true, lines: { orderBy: { id: "asc" } } },
  });
  if (!order) throw new Response("Not found", { status: 404 });
  return order;
}

function buildEmail(order: Awaited<ReturnType<typeof findOrder>>, shop: string): string | null {
  if (!order.distributor.email) return null;
  const lines = order.lines.map((l) => {
    const qty = [l.casesOrdered ? `${l.casesOrdered} case(s)` : "", l.looseOrdered ? `${l.looseOrdered} bottle(s)` : ""]
      .filter(Boolean)
      .join(" + ");
    return `- ${l.title}${l.sku ? ` (${l.sku})` : ""}: ${qty}`;
  });
  const body = [
    `Hi${order.distributor.repName ? ` ${order.distributor.repName}` : ""},`,
    "",
    `Please find purchase order #${order.number} below.`,
    "",
    ...lines,
    "",
    order.locationName ? `Deliver to: ${order.locationName}` : "",
    order.expectedAt ? `Requested delivery: ${order.expectedAt.toISOString().slice(0, 10)}` : "",
    order.notes ? `Notes: ${order.notes}` : "",
    "",
    "Thank you,",
    shop.replace(".myshopify.com", ""),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
  const subject = `Purchase order #${order.number}`;
  return `mailto:${order.distributor.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireApp(request);
  const order = await findOrder(shop, params.id);

  const addable =
    order.status === "DRAFT"
      ? await db.productSetting.findMany({
          where: { shop, distributorId: order.distributorId },
          orderBy: { title: "asc" },
          select: { id: true, title: true, sku: true, caseSize: true },
        })
      : [];

  const totals = poTotals(order.lines);
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      distributorName: order.distributor.name,
      distributorId: order.distributorId,
      minOrderCases: order.distributor.minOrderCases,
      locationName: order.locationName,
      notes: order.notes,
      expectedAt: order.expectedAt?.toISOString().slice(0, 10) ?? null,
      orderedAt: order.orderedAt?.toISOString().slice(0, 10) ?? null,
      lines: order.lines.map((l) => {
        const ordered = lineOrderedUnits(l);
        return {
          id: l.id,
          title: l.title,
          sku: l.sku,
          caseSize: l.caseSize,
          casesOrdered: l.casesOrdered,
          looseOrdered: l.looseOrdered,
          costPerCase: l.costPerCase,
          cost: lineCost(l),
          ordered,
          received: l.unitsReceived,
          remaining: Math.max(0, ordered - l.unitsReceived),
        };
      }),
    },
    totals,
    addable,
    emailHref: buildEmail(order, shop),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop } = await requireApp(request);
  const order = await findOrder(shop, params.id);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const here = `/app/purchase-orders/${order.id}`;
  const isDraft = order.status === "DRAFT";
  const isOpen = order.status === "ORDERED" || order.status === "PARTIAL";

  switch (intent) {
    case "add_line": {
      if (!isDraft) return { error: "Only draft orders can be changed." };
      const setting = await db.productSetting.findFirst({
        where: { id: intField(form, "productSettingId", 0), shop },
      });
      if (!setting) return { error: "Choose a product to add." };
      const cases = Math.max(0, intField(form, "cases", 0));
      const loose = Math.max(0, intField(form, "loose", 0));
      if (cases + loose === 0) return { error: "Enter at least one case or bottle." };
      const existing = order.lines.find((l) => l.variantId === setting.variantId);
      if (existing) {
        await db.purchaseOrderLine.update({
          where: { id: existing.id },
          data: { casesOrdered: existing.casesOrdered + cases, looseOrdered: existing.looseOrdered + loose },
        });
      } else {
        await db.purchaseOrderLine.create({
          data: {
            purchaseOrderId: order.id,
            variantId: setting.variantId,
            inventoryItemId: setting.inventoryItemId,
            title: setting.title,
            sku: setting.sku,
            caseSize: setting.caseSize,
            casesOrdered: cases,
            looseOrdered: loose,
            costPerCase: setting.costPerCase,
          },
        });
      }
      return redirect(here);
    }

    case "update_lines": {
      if (!isDraft) return { error: "Only draft orders can be changed." };
      for (const line of order.lines) {
        const cases = Math.max(0, intField(form, `cases_${line.id}`, line.casesOrdered));
        const loose = Math.max(0, intField(form, `loose_${line.id}`, line.looseOrdered));
        const cost = floatField(form, `cost_${line.id}`);
        if (cases + loose === 0) {
          await db.purchaseOrderLine.delete({ where: { id: line.id } });
        } else {
          await db.purchaseOrderLine.update({
            where: { id: line.id },
            data: { casesOrdered: cases, looseOrdered: loose, costPerCase: cost },
          });
        }
      }
      return redirect(here);
    }

    case "remove_line": {
      if (!isDraft) return { error: "Only draft orders can be changed." };
      const lineId = intField(form, "lineId", 0);
      if (order.lines.some((l) => l.id === lineId)) {
        await db.purchaseOrderLine.delete({ where: { id: lineId } });
      }
      return redirect(here);
    }

    case "mark_ordered": {
      if (!isDraft) return { error: "This order has already been placed." };
      if (order.lines.length === 0) return { error: "Add at least one product first." };
      await db.purchaseOrder.update({
        where: { id: order.id },
        data: { status: "ORDERED", orderedAt: new Date() },
      });
      return redirect(here);
    }

    case "receive":
    case "receive_all": {
      if (!isOpen) return { error: "Only placed orders can be received." };
      if (!order.locationId) return { error: "This order has no delivery location." };

      const deltas = order.lines.map((line) => {
        const remaining = Math.max(0, lineOrderedUnits(line) - line.unitsReceived);
        const units =
          intent === "receive_all"
            ? remaining
            : toUnits(
                intField(form, `recvCases_${line.id}`, 0),
                intField(form, `recvLoose_${line.id}`, 0),
                line.caseSize,
              );
        return { line, units };
      });
      const changes = deltas.filter((d) => d.units > 0);
      if (!changes.length) return { error: "Enter what arrived before receiving." };

      try {
        await addReceivedStock(admin, {
          locationId: order.locationId,
          reference: `caseflow://purchase-order/${order.number}`,
          changes: changes.map((d) => ({ inventoryItemId: d.line.inventoryItemId, delta: d.units })),
        });
      } catch (err) {
        return {
          error: `Shopify didn't accept the stock update, so nothing was changed. ${
            err instanceof Error ? err.message : ""
          }`,
        };
      }

      const updated = order.lines.map((line) => {
        const add = changes.find((d) => d.line.id === line.id)?.units ?? 0;
        return { ...line, unitsReceived: line.unitsReceived + add };
      });
      const status = statusAfterReceiving(updated);
      await db.$transaction([
        ...changes.map((d) =>
          db.purchaseOrderLine.update({
            where: { id: d.line.id },
            data: { unitsReceived: { increment: d.units } },
          }),
        ),
        db.purchaseOrder.update({
          where: { id: order.id },
          data: { status, receivedAt: status === "RECEIVED" ? new Date() : null },
        }),
      ]);
      return redirect(here);
    }

    case "cancel": {
      if (!isDraft && !isOpen) return { error: "This order can't be cancelled." };
      await db.purchaseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      return redirect(here);
    }

    case "delete": {
      if (!isDraft) return { error: "Only drafts can be deleted. Cancel placed orders instead." };
      await db.purchaseOrder.delete({ where: { id: order.id } });
      return redirect("/app/purchase-orders");
    }
  }
  return { error: "Unknown action." };
};

export default function PurchaseOrderDetail() {
  const { order, totals, addable, emailHref } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busyIntent = nav.state === "submitting" ? String(nav.formData?.get("intent") ?? "") : "";
  const isDraft = order.status === "DRAFT";
  const isOpen = order.status === "ORDERED" || order.status === "PARTIAL";
  const belowMinimum = order.minOrderCases > 0 && totals.cases < order.minOrderCases;
  const loading = (intent: string) => (busyIntent === intent ? { loading: true } : {});

  return (
    <s-page heading={`Purchase order #${order.number}`}>
      <s-link slot="breadcrumb-actions" href="/app/purchase-orders">
        Purchase orders
      </s-link>

      {result && "error" in result && result.error && (
        <s-banner tone="critical">{result.error}</s-banner>
      )}

      <s-section>
        <s-stack direction="inline" gap="large">
          <s-stack direction="block">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={STATUS_TONE[order.status] ?? "neutral"}>
              {STATUS_LABEL[order.status] ?? order.status}
            </s-badge>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Distributor</s-text>
            <s-link href={`/app/distributors/${order.distributorId}`}>{order.distributorName}</s-link>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Deliver to</s-text>
            <s-text>{order.locationName ?? "—"}</s-text>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Expected</s-text>
            <s-text>{order.expectedAt ?? "—"}</s-text>
          </s-stack>
          <s-stack direction="block">
            <s-text color="subdued">Total</s-text>
            <s-text>
              {totals.cases} cs · {formatMoney(totals.cost)}
            </s-text>
          </s-stack>
        </s-stack>
        {order.notes && <s-paragraph>{order.notes}</s-paragraph>}
      </s-section>

      {belowMinimum && isDraft && (
        <s-banner tone="warning">
          {order.distributorName} has a {order.minOrderCases}-case minimum. This order has {totals.cases}.
        </s-banner>
      )}

      {/* ---------------- Draft: edit lines ---------------- */}
      {isDraft && (
        <s-section heading="Products">
          {order.lines.length === 0 ? (
            <s-paragraph>No products yet. Add some below.</s-paragraph>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="update_lines" />
              <s-stack direction="block" gap="base">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header>Cases</s-table-header>
                    <s-table-header>Extra bottles</s-table-header>
                    <s-table-header>Cost per case</s-table-header>
                    <s-table-header format="currency">Line total</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {order.lines.map((l) => (
                      <s-table-row key={l.id}>
                        <s-table-cell>
                          <s-stack direction="block">
                            <s-text>{l.title}</s-text>
                            <s-text color="subdued">
                              {l.caseSize} per case{l.sku ? ` · ${l.sku}` : ""}
                            </s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-number-field
                            label="Cases"
                            labelAccessibilityVisibility="exclusive"
                            name={`cases_${l.id}`}
                            defaultValue={String(l.casesOrdered)}
                            min={0}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-number-field
                            label="Extra bottles"
                            labelAccessibilityVisibility="exclusive"
                            name={`loose_${l.id}`}
                            defaultValue={String(l.looseOrdered)}
                            min={0}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-money-field
                            label="Cost per case"
                            labelAccessibilityVisibility="exclusive"
                            name={`cost_${l.id}`}
                            defaultValue={l.costPerCase == null ? "" : String(l.costPerCase)}
                          />
                        </s-table-cell>
                        <s-table-cell>{formatMoney(l.cost)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                <s-text color="subdued">Set both quantities to 0 to remove a product.</s-text>
                <s-button type="submit" {...loading("update_lines")}>
                  Save quantities
                </s-button>
              </s-stack>
            </Form>
          )}
        </s-section>
      )}

      {isDraft && (
        <s-section heading="Add a product">
          {addable.length === 0 ? (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                No products are linked to {order.distributorName} yet. Link them on the Case
                settings page and they'll show up here.
              </s-paragraph>
              <s-button href="/app/products">Go to case settings</s-button>
            </s-stack>
          ) : (
            <Form method="post" key={order.lines.length}>
              <input type="hidden" name="intent" value="add_line" />
              <s-stack direction="inline" gap="base">
                <s-select label="Product" name="productSettingId">
                  {addable.map((p) => (
                    <s-option key={p.id} value={String(p.id)}>
                      {p.title} ({p.caseSize}/cs)
                    </s-option>
                  ))}
                </s-select>
                <s-number-field label="Cases" name="cases" defaultValue="1" min={0} />
                <s-number-field label="Extra bottles" name="loose" defaultValue="0" min={0} />
                <s-button type="submit" {...loading("add_line")}>
                  Add
                </s-button>
              </s-stack>
            </Form>
          )}
        </s-section>
      )}

      {/* ---------------- Placed: receiving ---------------- */}
      {!isDraft && (
        <s-section heading={isOpen ? "Receive delivery" : "Products"}>
          <Form method="post">
            <input type="hidden" name="intent" value="receive" />
            <s-stack direction="block" gap="base">
              {isOpen && (
                <s-paragraph>
                  Count what arrived and enter it below. CaseFlow converts cases to bottles and adds
                  them to your Shopify stock at {order.locationName}.
                </s-paragraph>
              )}
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Ordered</s-table-header>
                  <s-table-header>Received</s-table-header>
                  {isOpen && <s-table-header>Cases arrived</s-table-header>}
                  {isOpen && <s-table-header>Bottles arrived</s-table-header>}
                </s-table-header-row>
                <s-table-body>
                  {order.lines.map((l) => (
                    <s-table-row key={l.id}>
                      <s-table-cell>
                        <s-stack direction="block">
                          <s-text>{l.title}</s-text>
                          <s-text color="subdued">
                            {l.caseSize} per case{l.sku ? ` · ${l.sku}` : ""}
                          </s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{formatUnits(l.ordered, l.caseSize)}</s-table-cell>
                      <s-table-cell>
                        {l.remaining === 0 ? (
                          <s-badge tone="success">{formatUnits(l.received, l.caseSize)}</s-badge>
                        ) : (
                          formatUnits(l.received, l.caseSize)
                        )}
                      </s-table-cell>
                      {isOpen && (
                        <s-table-cell>
                          <s-number-field
                            label="Cases arrived"
                            labelAccessibilityVisibility="exclusive"
                            name={`recvCases_${l.id}`}
                            defaultValue="0"
                            min={0}
                            {...(l.remaining === 0 ? { disabled: true } : {})}
                          />
                        </s-table-cell>
                      )}
                      {isOpen && (
                        <s-table-cell>
                          <s-number-field
                            label="Bottles arrived"
                            labelAccessibilityVisibility="exclusive"
                            name={`recvLoose_${l.id}`}
                            defaultValue="0"
                            min={0}
                            {...(l.remaining === 0 ? { disabled: true } : {})}
                          />
                        </s-table-cell>
                      )}
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              {isOpen && (
                <s-button type="submit" variant="primary" {...loading("receive")}>
                  Add to stock
                </s-button>
              )}
            </s-stack>
          </Form>
        </s-section>
      )}

      {/* ---------------- Actions ---------------- */}
      <s-section heading="Actions">
        <s-stack direction="inline" gap="base">
          {isDraft && (
            <Form method="post">
              <input type="hidden" name="intent" value="mark_ordered" />
              <s-button type="submit" variant="primary" {...loading("mark_ordered")}>
                Mark as ordered
              </s-button>
            </Form>
          )}
          {emailHref && order.lines.length > 0 && (
            <s-button href={emailHref} target="_blank">
              Email to distributor
            </s-button>
          )}
          {isOpen && (
            <Form method="post">
              <input type="hidden" name="intent" value="receive_all" />
              <s-button type="submit" {...loading("receive_all")}>
                Everything arrived
              </s-button>
            </Form>
          )}
          {(isDraft || isOpen) && (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <s-button type="submit" tone="critical" variant="tertiary" {...loading("cancel")}>
                Cancel order
              </s-button>
            </Form>
          )}
          {isDraft && (
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" tone="critical" variant="tertiary" {...loading("delete")}>
                Delete draft
              </s-button>
            </Form>
          )}
        </s-stack>
        {!emailHref && (
          <s-paragraph>
            Add an order email to {order.distributorName} to send this order with one click.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
