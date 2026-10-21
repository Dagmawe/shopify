import { useState, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  Badge,
  TextField,
  Select,
  Banner,
  Divider,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { run as evaluateCartRules } from "../../extensions/b2b-cart-validator/src/run";

/**
 * Helper: Syncs all active rules for a shop into the Shopify Checkout Validation Function
 * via the Admin GraphQL API (`shopifyFunctions`, `validationCreate` / `validationUpdate`).
 */
async function syncRulesToShopifyValidation(admin: any, shop: string) {
  const rules = await prisma.b2bValidationRule.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });

  const rulesPayload = JSON.stringify({ rules });

  try {
    // 1. Check existing validations and available functions on the store
    const queryResponse = await admin.graphql(
      `#graphql
      query GetValidationsAndFunctions {
        shopifyFunctions(first: 25) {
          nodes {
            id
            title
            apiType
          }
        }
        validations(first: 25) {
          nodes {
            id
            title
            enabled
            shopifyFunction {
              id
            }
          }
        }
      }`,
    );

    const queryData = await queryResponse.json();
    const functions = queryData?.data?.shopifyFunctions?.nodes || [];
    const validations = queryData?.data?.validations?.nodes || [];

    const validatorFn = functions.find(
      (fn: any) =>
        fn.apiType === "cart_checkout_validation" ||
        fn.title?.toLowerCase().includes("b2b") ||
        fn.title?.toLowerCase().includes("case"),
    );

    if (!validatorFn) {
      return {
        synced: false,
        message:
          "Saved rules to database. Run `npm run dev` or `npm run deploy` with Shopify CLI to deploy the `b2b-cart-validator` Function extension to your store.",
      };
    }

    const existingValidation = validations.find(
      (v: any) => v.shopifyFunction?.id === validatorFn.id,
    );

    if (existingValidation) {
      const updateRes = await admin.graphql(
        `#graphql
        mutation UpdateB2bValidation($id: ID!, $validation: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $validation) {
            validation {
              id
              enabled
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: existingValidation.id,
            validation: {
              enable: true,
              blockOnFailure: true,
              metafields: [
                {
                  namespace: "$app:b2b_validator",
                  key: "rules_config",
                  type: "json",
                  value: rulesPayload,
                },
              ],
            },
          },
        },
      );
      const updateJson = await updateRes.json();
      const errors = updateJson?.data?.validationUpdate?.userErrors || [];
      if (errors.length > 0) {
        return { synced: false, message: errors[0].message };
      }
      return {
        synced: true,
        message: "Synced rules to active Shopify Checkout Validation Function!",
      };
    } else {
      const createRes = await admin.graphql(
        `#graphql
        mutation CreateB2bValidation($validation: ValidationCreateInput!) {
          validationCreate(validation: $validation) {
            validation {
              id
              enabled
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            validation: {
              title: "B2B Order Minimums & Case-Pack Validator",
              enable: true,
              blockOnFailure: true,
              functionId: validatorFn.id,
              metafields: [
                {
                  namespace: "$app:b2b_validator",
                  key: "rules_config",
                  type: "json",
                  value: rulesPayload,
                },
              ],
            },
          },
        },
      );
      const createJson = await createRes.json();
      const errors = createJson?.data?.validationCreate?.userErrors || [];
      if (errors.length > 0) {
        return { synced: false, message: errors[0].message };
      }
      return {
        synced: true,
        message: "Activated & synced B2B Checkout Validation Function on store!",
      };
    }
  } catch (err: any) {
    return {
      synced: false,
      message: `Saved locally (${err?.message || "Function sync pending CLI deployment"}).`,
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let rules = await prisma.b2bValidationRule.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });

  // Seed default starter B2B rule on first visit so merchant can test immediately
  if (rules.length === 0) {
    await prisma.b2bValidationRule.create({
      data: {
        shop,
        title: "Wholesale Tier 1 ($500 MOV + Case Packs of 6)",
        enabled: true,
        targetAudience: "B2B_TAGGED",
        customerTag: "B2B",
        minOrderSubtotal: 500,
        minTotalQuantity: 12,
        casePackMultiple: 6,
        mixMatchCaseMultiple: 12,
        customErrorPrefix: "Wholesale Requirement:",
      },
    });
    rules = await prisma.b2bValidationRule.findMany({
      where: { shop },
      orderBy: { createdAt: "asc" },
    });
  }

  return json({
    shop,
    rules,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "create_rule") {
    const title = String(formData.get("title") || "B2B Wholesale Rule").trim();
    const targetAudience = String(formData.get("targetAudience") || "B2B_TAGGED");
    const customerTag = String(formData.get("customerTag") || "B2B").trim();
    const minOrderSubtotal = Math.max(
      0,
      parseFloat(String(formData.get("minOrderSubtotal") || "0")) || 0,
    );
    const minTotalQuantity = Math.max(
      0,
      parseInt(String(formData.get("minTotalQuantity") || "0"), 10) || 0,
    );
    const casePackMultiple = Math.max(
      1,
      parseInt(String(formData.get("casePackMultiple") || "1"), 10) || 1,
    );
    const mixMatchCaseMultiple = Math.max(
      1,
      parseInt(String(formData.get("mixMatchCaseMultiple") || "1"), 10) || 1,
    );
    const customErrorPrefix = String(
      formData.get("customErrorPrefix") || "Wholesale Requirement:",
    ).trim();

    await prisma.b2bValidationRule.create({
      data: {
        shop,
        title,
        enabled: true,
        targetAudience,
        customerTag,
        minOrderSubtotal,
        minTotalQuantity,
        casePackMultiple,
        mixMatchCaseMultiple,
        customErrorPrefix,
      },
    });

    const syncResult = await syncRulesToShopifyValidation(admin, shop);
    return json({ ok: true, ...syncResult });
  }

  if (intent === "toggle_rule") {
    const id = String(formData.get("id") || "");
    const currentEnabled = String(formData.get("enabled")) === "true";
    await prisma.b2bValidationRule.updateMany({
      where: { id, shop },
      data: { enabled: !currentEnabled },
    });
    const syncResult = await syncRulesToShopifyValidation(admin, shop);
    return json({ ok: true, ...syncResult });
  }

  if (intent === "delete_rule") {
    const id = String(formData.get("id") || "");
    await prisma.b2bValidationRule.deleteMany({
      where: { id, shop },
    });
    const syncResult = await syncRulesToShopifyValidation(admin, shop);
    return json({ ok: true, ...syncResult });
  }

  if (intent === "sync_to_shopify") {
    const syncResult = await syncRulesToShopifyValidation(admin, shop);
    return json({ ok: true, ...syncResult });
  }

  return json({ ok: false, synced: false, message: "Unknown action" }, { status: 400 });
};

export default function Index() {
  const { shop, rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Form state for creating a new B2B Validation Rule
  const [title, setTitle] = useState("Standard Wholesale Case Rule");
  const [targetAudience, setTargetAudience] = useState("B2B_TAGGED");
  const [customerTag, setCustomerTag] = useState("B2B");
  const [minOrderSubtotal, setMinOrderSubtotal] = useState("500");
  const [minTotalQuantity, setMinTotalQuantity] = useState("12");
  const [casePackMultiple, setCasePackMultiple] = useState("6");
  const [mixMatchCaseMultiple, setMixMatchCaseMultiple] = useState("12");
  const [customErrorPrefix, setCustomErrorPrefix] = useState(
    "Wholesale Order Requirement:",
  );

  // State for the Interactive B2B Cart & Checkout Simulator
  const [simIsB2bCustomer, setSimIsB2bCustomer] = useState("true");
  const [simSubtotal, setSimSubtotal] = useState("320");
  const [simSku1Qty, setSimSku1Qty] = useState("4");
  const [simSku2Qty, setSimSku2Qty] = useState("6");

  const simulationOutput = useMemo(() => {
    const sku1 = Math.max(0, parseInt(simSku1Qty || "0", 10) || 0);
    const sku2 = Math.max(0, parseInt(simSku2Qty || "0", 10) || 0);
    return evaluateCartRules({
      cart: {
        buyerIdentity: {
          customer: {
            id: "gid://shopify/Customer/1",
            hasB2bTag: simIsB2bCustomer === "true",
          },
        },
        cost: {
          subtotalAmount: {
            amount: String(parseFloat(simSubtotal || "0") || 0),
            currencyCode: "USD",
          },
        },
        lines: [
          ...(sku1 > 0
            ? [
                {
                  id: "line-1",
                  quantity: sku1,
                  merchandise: {
                    __typename: "ProductVariant",
                    id: "var-1",
                    title: "Case / 750ml",
                    product: { id: "prod-1", title: "Organic Espresso Syrup" },
                  },
                },
              ]
            : []),
          ...(sku2 > 0
            ? [
                {
                  id: "line-2",
                  quantity: sku2,
                  merchandise: {
                    __typename: "ProductVariant",
                    id: "var-2",
                    title: "Default Title",
                    product: { id: "prod-2", title: "Ceramic Tasting Mug" },
                  },
                },
              ]
            : []),
        ],
      },
      validation: {
        metafield: {
          value: JSON.stringify({ rules }),
        },
      },
    });
  }, [rules, simIsB2bCustomer, simSubtotal, simSku1Qty, simSku2Qty]);

  const handleCreateRule = () => {
    const formData = new FormData();
    formData.set("intent", "create_rule");
    formData.set("title", title);
    formData.set("targetAudience", targetAudience);
    formData.set("customerTag", customerTag);
    formData.set("minOrderSubtotal", minOrderSubtotal);
    formData.set("minTotalQuantity", minTotalQuantity);
    formData.set("casePackMultiple", casePackMultiple);
    formData.set("mixMatchCaseMultiple", mixMatchCaseMultiple);
    formData.set("customErrorPrefix", customErrorPrefix);
    submit(formData, { method: "post" });
  };

  const handleSyncToShopify = () => {
    const formData = new FormData();
    formData.set("intent", "sync_to_shopify");
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="B2B Order Minimums & Case-Pack Validator">
        <button variant="primary" onClick={handleSyncToShopify}>
          Sync Rules to Checkout
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {actionData?.message && (
          <Banner
            title={actionData.synced ? "Checkout Function Synced" : "Rules Saved"}
            tone={actionData.synced ? "success" : "info"}
          >
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Layout>
          {/* Active Rules Section */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Active B2B & Case-Pack Rules ({rules.length})
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Enforced server-side on <strong>{shop}</strong> via Shopify
                      Checkout Validation Functions (cannot be bypassed by Apple
                      Pay, Shop Pay, or direct checkout links).
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    loading={isSubmitting}
                    onClick={handleSyncToShopify}
                  >
                    Sync to Shopify Checkout
                  </Button>
                </InlineStack>
              </Box>

              <IndexTable
                resourceName={{ singular: "rule", plural: "rules" }}
                itemCount={rules.length}
                selectable={false}
                headings={[
                  { title: "Rule Title" },
                  { title: "Target Audience" },
                  { title: "Min Subtotal (MOV)" },
                  { title: "Min Units (MOQ)" },
                  { title: "SKU Case Pack" },
                  { title: "Mix-Match Case" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
              >
                {rules.map((rule, index) => (
                  <IndexTable.Row id={rule.id} key={rule.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="bold" as="span">
                        {rule.title}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          rule.targetAudience === "B2B_TAGGED"
                            ? "info"
                            : rule.targetAudience === "NON_B2B"
                              ? "warning"
                              : "attention"
                        }
                      >
                        {rule.targetAudience === "B2B_TAGGED"
                          ? `Tag: ${rule.customerTag}`
                          : rule.targetAudience === "NON_B2B"
                            ? "Retail (Non-B2B)"
                            : "All Shoppers"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.minOrderSubtotal > 0
                        ? `$${rule.minOrderSubtotal.toFixed(2)}`
                        : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.minTotalQuantity > 0
                        ? `${rule.minTotalQuantity} units`
                        : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.casePackMultiple > 1
                        ? `Multiples of ${rule.casePackMultiple}`
                        : "Any qty"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.mixMatchCaseMultiple > 1
                        ? `Cases of ${rule.mixMatchCaseMultiple}`
                        : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={rule.enabled ? "success" : undefined}>
                        {rule.enabled ? "Active" : "Paused"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("intent", "toggle_rule");
                            fd.set("id", rule.id);
                            fd.set("enabled", String(rule.enabled));
                            submit(fd, { method: "post" });
                          }}
                        >
                          {rule.enabled ? "Pause" : "Enable"}
                        </Button>
                        <Button
                          size="slim"
                          tone="critical"
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("intent", "delete_rule");
                            fd.set("id", rule.id);
                            submit(fd, { method: "post" });
                          }}
                        >
                          Delete
                        </Button>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          </Layout.Section>

          {/* Left Column: Create New B2B Rule */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Create New B2B / Case-Pack Rule
                </Text>
                <TextField
                  label="Rule Name"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  helpText="Internal name for your team (e.g., Wholesale Beverage Tier)"
                />
                <InlineStack gap="300" wrap={false}>
                  <Box width="60%">
                    <Select
                      label="Apply Rule To"
                      options={[
                        {
                          label: "B2B Tagged Customers Only (B2B / Wholesale)",
                          value: "B2B_TAGGED",
                        },
                        {
                          label: "Retail / Non-B2B Customers Only",
                          value: "NON_B2B",
                        },
                        {
                          label: "All Store Customers (B2B + Retail)",
                          value: "ALL",
                        },
                      ]}
                      value={targetAudience}
                      onChange={setTargetAudience}
                    />
                  </Box>
                  <Box width="40%">
                    <TextField
                      label="Customer Tag"
                      value={customerTag}
                      onChange={setCustomerTag}
                      disabled={targetAudience !== "B2B_TAGGED"}
                      autoComplete="off"
                    />
                  </Box>
                </InlineStack>

                <Divider />

                <InlineStack gap="300" wrap={false}>
                  <Box width="50%">
                    <TextField
                      label="Min Order Value (MOV $)"
                      type="number"
                      value={minOrderSubtotal}
                      onChange={setMinOrderSubtotal}
                      prefix="$"
                      autoComplete="off"
                      helpText="0 = no minimum dollar amount"
                    />
                  </Box>
                  <Box width="50%">
                    <TextField
                      label="Min Total Units (MOQ)"
                      type="number"
                      value={minTotalQuantity}
                      onChange={setMinTotalQuantity}
                      suffix="units"
                      autoComplete="off"
                      helpText="0 = no minimum unit count"
                    />
                  </Box>
                </InlineStack>

                <InlineStack gap="300" wrap={false}>
                  <Box width="50%">
                    <TextField
                      label="Per-SKU Case Pack Multiple"
                      type="number"
                      value={casePackMultiple}
                      onChange={setCasePackMultiple}
                      suffix="per SKU"
                      autoComplete="off"
                      helpText="e.g. 6 = must buy 6, 12, 18 of each SKU (1 = off)"
                    />
                  </Box>
                  <Box width="50%">
                    <TextField
                      label="Mix & Match Full Case Multiple"
                      type="number"
                      value={mixMatchCaseMultiple}
                      onChange={setMixMatchCaseMultiple}
                      suffix="total units"
                      autoComplete="off"
                      helpText="e.g. 12 = total cart units must be divisible by 12"
                    />
                  </Box>
                </InlineStack>

                <TextField
                  label="Checkout Error Prefix"
                  value={customErrorPrefix}
                  onChange={setCustomErrorPrefix}
                  autoComplete="off"
                />

                <Button
                  variant="primary"
                  onClick={handleCreateRule}
                  loading={isSubmitting}
                >
                  Add B2B Validation Rule
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Right Column: Live B2B Checkout Simulator */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Live B2B Cart & Checkout Simulator
                  </Text>
                  <Badge
                    tone={
                      simulationOutput.errors.length === 0
                        ? "success"
                        : "critical"
                    }
                  >
                    {simulationOutput.errors.length === 0
                      ? "Checkout Allowed"
                      : `${simulationOutput.errors.length} Blocking Error(s)`}
                  </Badge>
                </InlineStack>

                <Text as="p" variant="bodySm" tone="subdued">
                  Test how your active rules evaluate a simulated cart using the
                  exact same WebAssembly Function logic that runs at Shopify
                  Checkout.
                </Text>

                <Select
                  label="Simulated Buyer Account"
                  options={[
                    {
                      label: "Logged-in B2B Customer (has 'B2B' / 'Wholesale' tag)",
                      value: "true",
                    },
                    {
                      label: "Regular Retail Shopper / Guest (no B2B tag)",
                      value: "false",
                    },
                  ]}
                  value={simIsB2bCustomer}
                  onChange={setSimIsB2bCustomer}
                />

                <InlineStack gap="300" wrap={false}>
                  <Box width="34%">
                    <TextField
                      label="Cart Subtotal ($)"
                      type="number"
                      value={simSubtotal}
                      onChange={setSimSubtotal}
                      prefix="$"
                      autoComplete="off"
                    />
                  </Box>
                  <Box width="33%">
                    <TextField
                      label="SKU #1 Qty (Syrup)"
                      type="number"
                      value={simSku1Qty}
                      onChange={setSimSku1Qty}
                      autoComplete="off"
                    />
                  </Box>
                  <Box width="33%">
                    <TextField
                      label="SKU #2 Qty (Mug)"
                      type="number"
                      value={simSku2Qty}
                      onChange={setSimSku2Qty}
                      autoComplete="off"
                    />
                  </Box>
                </InlineStack>

                <Divider />

                {simulationOutput.errors.length === 0 ? (
                  <Banner title="Cart Passes All B2B Validation Rules!" tone="success">
                    <p>
                      This buyer can proceed through Shopify Checkout, Shop Pay,
                      or Apple Pay without restriction.
                    </p>
                  </Banner>
                ) : (
                  <Banner
                    title="Checkout Blocked by B2B Validation Function:"
                    tone="critical"
                  >
                    <BlockStack gap="200">
                      {simulationOutput.errors.map((err, idx) => (
                        <Text as="p" variant="bodySm" key={idx}>
                          • {err.localizedMessage}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
