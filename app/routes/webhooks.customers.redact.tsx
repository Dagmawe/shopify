import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Required by Shopify. Corkcount stores no customer data, so there is nothing
// to erase.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}: Corkcount holds no customer data.`);
  return new Response();
};
