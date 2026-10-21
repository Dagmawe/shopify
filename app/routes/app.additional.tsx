import {
  Box,
  Card,
  Layout,
  List,
  Page,
  Text,
  BlockStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function SetupGuidePage() {
  return (
    <Page>
      <TitleBar title="B2B Setup & Checkout Activation Guide" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How B2B Order Minimums & Case-Pack Validation Works
              </Text>
              <Text as="p" variant="bodyMd">
                Unlike legacy apps that rely on fragile storefront JavaScript,
                this app uses native{" "}
                <strong>Shopify Cart & Checkout Validation Functions</strong>{" "}
                compiled to WebAssembly.
              </Text>
              <List type="number">
                <List.Item>
                  <strong>Tag your B2B customers:</strong> In Shopify Admin →
                  Customers, add the <Code>B2B</Code> or <Code>Wholesale</Code>{" "}
                  tag to approved wholesale accounts.
                </List.Item>
                <List.Item>
                  <strong>Configure your rules:</strong> On the home dashboard,
                  set your Minimum Order Value (MOV), Minimum Order Quantity
                  (MOQ), per-SKU Case-Pack multiples (e.g. 6, 12, 24), and
                  Mix-and-Match full case multiples.
                </List.Item>
                <List.Item>
                  <strong>Sync to Shopify Checkout:</strong> Click{" "}
                  <strong>Sync to Shopify Checkout</strong> to activate the
                  server-side validation rule under{" "}
                  <em>Settings → Checkout → Checkout rules</em>.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="span"
      padding="025"
      paddingInlineStart="100"
      paddingInlineEnd="100"
      background="bg-surface-active"
      borderWidth="025"
      borderColor="border"
      borderRadius="100"
    >
      <code>{children}</code>
    </Box>
  );
}
