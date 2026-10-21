import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Required by Shopify for every App Store app. CaseFlow stores no customer
// data (only distributors, products and purchase orders), so there is nothing
// to send. authenticate.webhook rejects requests that aren't from Shopify.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}: CaseFlow holds no customer data.`);
  return new Response();
};
