import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { intField, requireApp, textField } from "../lib/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireApp(request);
  const distributors = await db.distributor.findMany({
    where: { shop },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  return { distributors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireApp(request);
  const form = await request.formData();
  const name = textField(form, "name");
  if (!name) return { error: "Give the distributor a name." };

  await db.distributor.create({
    data: {
      shop,
      name,
      repName: textField(form, "repName"),
      email: textField(form, "email"),
      phone: textField(form, "phone"),
      leadTimeDays: Math.max(0, intField(form, "leadTimeDays", 7)),
      minOrderCases: Math.max(0, intField(form, "minOrderCases", 0)),
    },
  });
  return { ok: true };
};

export default function Distributors() {
  const { distributors } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  return (
    <s-page heading="Distributors">
      <s-section heading="Your distributors">
        {distributors.length === 0 ? (
          <s-paragraph>
            Add the wholesalers and distributors you buy from. Each product can then be linked to
            one, so reorders are grouped into one purchase order per distributor.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Sales rep</s-table-header>
              <s-table-header format="numeric">Lead time</s-table-header>
              <s-table-header format="numeric">Min. order</s-table-header>
              <s-table-header format="numeric">Products</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {distributors.map((d) => (
                <s-table-row key={d.id} clickDelegate={`dist-${d.id}`}>
                  <s-table-cell>
                    <s-link id={`dist-${d.id}`} href={`/app/distributors/${d.id}`}>
                      {d.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{d.repName ?? "—"}</s-table-cell>
                  <s-table-cell>{d.leadTimeDays} days</s-table-cell>
                  <s-table-cell>
                    {d.minOrderCases ? `${d.minOrderCases} cs` : "None"}
                  </s-table-cell>
                  <s-table-cell>{d._count.products}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Add a distributor">
        <Form method="post" key={distributors.length}>
          <s-stack direction="block" gap="base">
            {result && "error" in result && (
              <s-banner tone="critical">{result.error}</s-banner>
            )}
            <s-text-field label="Name" name="name" required />
            <s-stack direction="inline" gap="base">
              <s-text-field label="Sales rep" name="repName" />
              <s-email-field label="Order email" name="email" />
              <s-text-field label="Phone" name="phone" />
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-number-field
                label="Lead time"
                name="leadTimeDays"
                defaultValue="7"
                min={0}
                suffix="days"
                details="Days from order to delivery"
              />
              <s-number-field
                label="Minimum order"
                name="minOrderCases"
                defaultValue="0"
                min={0}
                suffix="cases"
                details="Leave at 0 if there's no minimum"
              />
            </s-stack>
            <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
              Add distributor
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
