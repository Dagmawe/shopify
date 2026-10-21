import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify sends this 48 hours after a store uninstalls the app. Delete
// everything Corkcount stored for that store.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}: deleting all Corkcount data.`);

  await db.$transaction([
    db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { shop } } }),
    db.purchaseOrder.deleteMany({ where: { shop } }),
    db.productSetting.deleteMany({ where: { shop } }),
    db.distributor.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
