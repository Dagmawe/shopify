import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { intField, requireApp, textField } from "../lib/context.server";

async function findDistributor(shop: string, idParam: string | undefined) {
  const id = Number.parseInt(idParam ?? "", 10);
  if (!Number.isFinite(id)) throw new Response("Not found", { status: 404 });
  const distributor = await db.distributor.findFirst({
    where: { id, shop },
    include: { _count: { select: { purchaseOrders: true, products: true } } },
  });
  if (!distributor) throw new Response("Not found", { status: 404 });
  return distributor;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireApp(request);
  const distributor = await findDistributor(shop, params.id);
  return { distributor };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop } = await requireApp(request);
  const distributor = await findDistributor(shop, params.id);
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    if (distributor._count.purchaseOrders > 0) {
      return {
        error:
          "This distributor has purchase orders, so it can't be deleted.",
      };
    }
    await db.distributor.delete({ where: { id: distributor.id } });
    return redirect("/app/distributors");
  }

  const name = textField(form, "name");
  if (!name) return { nameError: "Give the distributor a name." };
  await db.distributor.update({
    where: { id: distributor.id },
    data: {
      name,
      repName: textField(form, "repName"),
      email: textField(form, "email"),
      phone: textField(form, "phone"),
      leadTimeDays: Math.max(0, intField(form, "leadTimeDays", 7)),
      minOrderCases: Math.max(0, intField(form, "minOrderCases", 0)),
      notes: textField(form, "notes"),
    },
  });
  return redirect("/app/distributors");
};

export default function EditDistributor() {
  const { distributor: d } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  return (
    <s-page heading={d.name}>
      <s-link slot="breadcrumb-actions" href="/app/distributors">
        Distributors
      </s-link>
      <s-section>
        {/* data-save-bar shows Shopify's Save / Discard bar as soon as a field changes. */}
        <Form method="post" data-save-bar data-discard-confirmation>
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Name"
              name="name"
              defaultValue={d.name}
              required
              {...(result && "nameError" in result ? { error: result.nameError } : {})}
            />
            <s-stack direction="inline" gap="base">
              <s-text-field label="Sales rep" name="repName" defaultValue={d.repName ?? ""} />
              <s-email-field label="Order email" name="email" defaultValue={d.email ?? ""} />
              <s-text-field label="Phone" name="phone" defaultValue={d.phone ?? ""} />
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-number-field
                label="Lead time"
                name="leadTimeDays"
                defaultValue={String(d.leadTimeDays)}
                min={0}
                suffix="days"
              />
              <s-number-field
                label="Minimum order"
                name="minOrderCases"
                defaultValue={String(d.minOrderCases)}
                min={0}
                suffix="cases"
              />
            </s-stack>
            <s-text-area
              label="Notes"
              name="notes"
              defaultValue={d.notes ?? ""}
              details="Delivery days, account number, anything your staff should know"
            />
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Delete distributor">
        {d._count.purchaseOrders > 0 ? (
          <s-paragraph>
            {d.name} has {d._count.purchaseOrders} purchase{" "}
            {d._count.purchaseOrders === 1 ? "order" : "orders"}, so it can&apos;t be deleted.
            Keeping it keeps your order history complete.
          </s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <s-stack direction="block" gap="base">
              {result && "error" in result && result.error && (
                <s-banner tone="critical">{result.error}</s-banner>
              )}
              <s-paragraph>
                {d._count.products > 0
                  ? `Its ${d._count.products} linked ${d._count.products === 1 ? "product" : "products"} will be unlinked, not deleted.`
                  : "No products are linked to it."}
              </s-paragraph>
              <s-button type="submit" tone="critical">
                Delete {d.name}
              </s-button>
            </s-stack>
          </Form>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
