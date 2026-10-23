import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { intField, moneyField, requireApp } from "../lib/context.server";
import { formatCasesAndBottles, formatMoney, formatUnits, lineCost, lineOrderedUnits, toUnits } from "../lib/units";
import { poTotals } from "../models/purchase-orders.server";
import { receiveDelivery, remainingUnits } from "../models/receiving.server";
import { STATUS_LABEL, STATUS_TONE } from "../lib/status";

const KNOWN_INTENTS = ["add_line", "update_lines", "remove_line", "receive", "mark_ordered", "cancel", "delete", "receive_all"];
const QTY_ERROR = "Enter at least one case or bottle.";

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
      if (!isDraft) return { intent, error: "Only draft orders can be changed." };
      const setting = await db.productSetting.findFirst({
        where: { id: intField(form, "productSettingId", 0), shop },
      });
      if (!setting) return { intent, error: "Choose a product to add." };
      const cases = Math.max(0, intField(form, "cases", 0));
      const loose = Math.max(0, intField(form, "loose", 0));
      if (cases + loose === 0) return { intent, error: QTY_ERROR };
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
      if (!isDraft) return { intent, error: "Only draft orders can be changed." };
      for (const line of order.lines) {
        const cases = Math.max(0, intField(form, `cases_${line.id}`, line.casesOrdered));
        const loose = Math.max(0, intField(form, `loose_${line.id}`, line.looseOrdered));
        const cost = moneyField(form, `cost_${line.id}`);
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
      if (!isDraft) return { intent, error: "Only draft orders can be changed." };
      const lineId = intField(form, "lineId", 0);
      if (order.lines.some((l) => l.id === lineId)) {
        await db.purchaseOrderLine.delete({ where: { id: lineId } });
      }
      return redirect(here);
    }

    case "mark_ordered": {
      if (!isDraft) return { intent, error: "This order has already been placed." };
      if (order.lines.length === 0) return { intent, error: "Add at least one product first." };
      await db.purchaseOrder.update({
        where: { id: order.id },
        data: { status: "ORDERED", orderedAt: new Date() },
      });
      return redirect(here);
    }

    case "receive":
    case "receive_all": {
      if (!isOpen) return { intent, error: "Only placed orders can be received." };

      const units = new Map<number, number>();
      for (const line of order.lines) {
        units.set(
          line.id,
          intent === "receive_all"
            ? remainingUnits(line)
            : toUnits(
                intField(form, `recvCases_${line.id}`, 0),
                intField(form, `recvLoose_${line.id}`, 0),
                line.caseSize,
              ),
        );
      }
      const received = await receiveDelivery(admin, order, units);
      if (!received.ok) return { intent, error: received.error };
      return redirect(here);
    }

    case "cancel": {
      if (!isDraft && !isOpen) return { intent, error: "This order can't be cancelled." };
      await db.purchaseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      return redirect(here);
    }

    case "delete": {
      if (!isDraft) return { intent, error: "Only drafts can be deleted. Cancel placed orders instead." };
      await db.purchaseOrder.delete({ where: { id: order.id } });
      return redirect("/app/purchase-orders");
    }
  }
  return { intent, error: "Something went wrong. Reload the page and try again." };
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
  // Errors show next to the part of the page they came from.
  const errorFor = (...intents: string[]) =>
    result && "error" in result && result.error && intents.includes(result.intent)
      ? result.error
      : null;
  const addError = errorFor("add_line");
  const actionsError = errorFor("mark_ordered", "cancel", "delete", "receive_all");
  // Cancel and delete ask once before acting. The question is tied to the
  // order's status, so it disappears by itself once the order changes.
  const [asked, setAsked] = useState<{ kind: "cancel" | "delete"; status: string } | null>(null);
  const confirming = asked && asked.status === order.status ? asked.kind : null;
  const setConfirming = (kind: "cancel" | "delete" | null) =>
    setAsked(kind ? { kind, status: order.status } : null);

  return (
    <s-page heading={`Purchase order #${order.number}`}>
      <s-link slot="breadcrumb-actions" href="/app/purchase-orders">
        Purchase orders
      </s-link>

      {result && "error" in result && result.error && !KNOWN_INTENTS.includes(result.intent) && (
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
              {formatCasesAndBottles(totals.cases, totals.loose)} · {formatMoney(totals.cost)}
            </s-text>
          </s-stack>
        </s-stack>
        {order.notes && <s-paragraph>{order.notes}</s-paragraph>}
      </s-section>

      {belowMinimum && isDraft && (
        <s-banner tone="warning">
          {order.distributorName} has a {order.minOrderCases}-case minimum. This order has{" "}
          {totals.cases} full {totals.cases === 1 ? "case" : "cases"}.
        </s-banner>
      )}

      {/* ---------------- Draft: edit lines ---------------- */}
      {isDraft && (
        <s-section heading="Products">
          {order.lines.length === 0 ? (
            <s-paragraph>No products yet. Add some below.</s-paragraph>
          ) : (
            // data-save-bar shows Shopify's Save / Discard bar when a quantity changes.
            <Form method="post" data-save-bar data-discard-confirmation>
              <input type="hidden" name="intent" value="update_lines" />
              <s-stack direction="block" gap="base">
                {errorFor("update_lines", "remove_line") && (
                  <s-banner tone="critical">{errorFor("update_lines", "remove_line")}</s-banner>
                )}
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
                <s-text color="subdued">
                  Change a quantity, then save it from the bar at the top. Set both quantities to 0
                  to remove a product.
                </s-text>
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
                settings page and they&apos;ll show up here.
              </s-paragraph>
              <s-button href="/app/products">Go to case settings</s-button>
            </s-stack>
          ) : (
            // Keyed on every line's quantity, so the boxes reset after each add,
            // including when the product merges into a line that already exists.
            <Form
              method="post"
              key={order.lines.map((l) => `${l.id}:${l.casesOrdered}:${l.looseOrdered}`).join(",")}
            >
              <input type="hidden" name="intent" value="add_line" />
              {addError && addError !== QTY_ERROR && (
                <s-banner tone="critical">{addError}</s-banner>
              )}
              <s-stack direction="inline" gap="base">
                <s-select label="Product" name="productSettingId">
                  {addable.map((p) => (
                    <s-option key={p.id} value={String(p.id)}>
                      {p.title} ({p.caseSize}/cs)
                    </s-option>
                  ))}
                </s-select>
                <s-number-field
                  label="Cases"
                  name="cases"
                  defaultValue="1"
                  min={0}
                  {...(addError === QTY_ERROR ? { error: QTY_ERROR } : {})}
                />
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
          {/* The key changes after every delivery, which clears the boxes so the
              same delivery can't be added to stock twice by clicking again. */}
          <Form method="post" key={order.lines.map((l) => l.received).join("-")}>
            <input type="hidden" name="intent" value="receive" />
            <s-stack direction="block" gap="base">
              {errorFor("receive") && <s-banner tone="critical">{errorFor("receive")}</s-banner>}
              {isOpen && (
                <s-paragraph>
                  Count what arrived and enter it below. Corkcount converts cases to bottles and adds
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
        {actionsError && <s-banner tone="critical">{actionsError}</s-banner>}
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
          {(isDraft || isOpen) && confirming == null && (
            <s-button tone="critical" variant="tertiary" onClick={() => setConfirming("cancel")}>
              Cancel order
            </s-button>
          )}
          {isDraft && confirming == null && (
            <s-button tone="critical" variant="tertiary" onClick={() => setConfirming("delete")}>
              Delete draft
            </s-button>
          )}
        </s-stack>
        {confirming && (
          <s-banner tone="critical">
            <s-stack direction="block" gap="base">
              <s-text>
                {confirming === "cancel"
                  ? isOpen
                    ? `Cancel purchase order #${order.number}? Stock already received stays in Shopify. Tell ${order.distributorName} separately.`
                    : `Cancel draft #${order.number}? It stays in your order history as cancelled.`
                  : `Delete draft #${order.number}? This can't be undone.`}
              </s-text>
              <s-stack direction="inline" gap="base">
                <Form method="post">
                  <input type="hidden" name="intent" value={confirming} />
                  <s-button type="submit" tone="critical" variant="primary" {...loading(confirming)}>
                    {confirming === "cancel" ? "Cancel order" : "Delete draft"}
                  </s-button>
                </Form>
                <s-button onClick={() => setConfirming(null)}>
                  {confirming === "cancel" ? "Keep order" : "Keep draft"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        )}
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
