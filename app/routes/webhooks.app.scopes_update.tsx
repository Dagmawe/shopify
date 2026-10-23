import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify sends this when a store approves new permissions for the app.
// Record the new list on the store's session so the app knows what it can do.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = Array.isArray(payload?.current) ? (payload.current as string[]) : null;
  if (session && current) {
    // updateMany: no error if the session was removed in the meantime.
    await db.session.updateMany({
      where: { id: session.id },
      data: { scope: current.join(",") },
    });
  }
  return new Response();
};
