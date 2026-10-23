import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { dateField, intField, requireApp, textField } from "../lib/context.server";
import { getLocations } from "../lib/shopify-data.server";
import { getAppHandle, planSelectionUrl } from "../lib/plan.server";
import { createPurchaseOrder } from "../models/purchase-orders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, plan } = await requireApp(request);
  const [distributors, allLocations] = await Promise.all([
    db.distributor.findMany({ where: { shop }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getLocations(admin),
  ]);
  // Starter receives into the first location only. Other locations stay
  // visible but disabled, so merchants can see what Pro adds.
  const locations = allLocations.map((l, i) => ({ ...l, locked: !plan.multiLocation && i > 0 }));
  return {
    distributors,
    locations,
    limited: !plan.multiLocation && allLocations.length > 1,
    planUrl: planSelectionUrl(shop, await getAppHandle(admin)),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, plan } = await requireApp(request);
  const form = await request.formData();

  const distributorId = intField(form, "distributorId", 0);
  const distributor = await db.distributor.findFirst({ where: { id: distributorId, shop } });
  if (!distributor) return { distributorError: "Choose a distributor." };

  const allLocations = await getLocations(admin);
  const allowed = plan.multiLocation ? allLocations : allLocations.slice(0, 1);
  const location = allowed.find((l) => l.id === form.get("locationId")) ?? allowed[0];
  if (!location) return { error: "Your store has no active locations." };

  const expected = dateField(form, "expectedAt");
  if (expected === "invalid") return { dateError: "Enter a date like 2026-11-05." };

  const order = await createPurchaseOrder(shop, {
      distributorId: distributor.id,
      locationId: location.id,
      locationName: location.name,
      notes: textField(form, "notes"),
      expectedAt: expected,
  });
  return redirect(`/app/purchase-orders/${order.id}`);
};

export default function NewPurchaseOrder() {
  const { distributors, locations, limited, planUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";

  if (distributors.length === 0) {
    return (
      <s-page heading="New purchase order">
        <s-link slot="breadcrumb-actions" href="/app/purchase-orders">
          Purchase orders
        </s-link>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>Add a distributor first, then you can create purchase orders for it.</s-paragraph>
            <s-button href="/app/distributors" variant="primary">
              Add a distributor
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="New purchase order">
      <s-link slot="breadcrumb-actions" href="/app/purchase-orders">
        Purchase orders
      </s-link>
      <s-section>
        <Form method="post">
          <s-stack direction="block" gap="base">
            {result && "error" in result && result.error && (
              <s-banner tone="critical">{result.error}</s-banner>
            )}
            <s-select
              label="Distributor"
              name="distributorId"
              required
              {...(result && "distributorError" in result ? { error: result.distributorError } : {})}
            >
              {distributors.map((d) => (
                <s-option key={d.id} value={String(d.id)}>
                  {d.name}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Deliver to"
              name="locationId"
              details={limited ? "Delivering to other locations is included in the Pro plan." : undefined}
            >
              {locations.map((l) => (
                <s-option key={l.id} value={l.id} {...(l.locked ? { disabled: true } : {})}>
                  {l.locked ? `${l.name} (Pro plan)` : l.name}
                </s-option>
              ))}
            </s-select>
            {limited && (
              <s-link href={planUrl} target="_top">
                See plans
              </s-link>
            )}
            <s-date-field
              label="Expected delivery"
              name="expectedAt"
              {...(result && "dateError" in result ? { error: result.dateError } : {})}
            />
            <s-text-area label="Notes for the distributor" name="notes" />
            <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
              Create draft
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
