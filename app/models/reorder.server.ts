import db from "../db.server";
import { getAvailable, type AdminGraphql } from "../lib/shopify-data.server";
import { suggestedCases } from "../lib/units";
import { draftsByVariant, incomingByVariant } from "./purchase-orders.server";

export interface ReorderRow {
  settingId: number;
  variantId: string;
  title: string;
  sku: string | null;
  caseSize: number;
  available: number;
  incoming: number;
  reorderPoint: number;
  parLevel: number;
  cases: number;
  costPerCase: number | null;
  distributorId: number | null;
  distributorName: string | null;
  inventoryItemId: string;
  // Set when the product is already on a draft order that hasn't been placed.
  draft: { orderId: number; number: number } | null;
}

// Every product with a reorder point or par level that is at or below its
// reorder point once stock on order is counted.
export async function getReorderRows(admin: AdminGraphql, shop: string): Promise<ReorderRow[]> {
  const settings = await db.productSetting.findMany({
    where: { shop, OR: [{ reorderPoint: { gt: 0 } }, { parLevel: { gt: 0 } }] },
    include: { distributor: { select: { id: true, name: true } } },
    orderBy: { title: "asc" },
  });
  if (!settings.length) return [];

  const [available, incoming, drafts] = await Promise.all([
    getAvailable(admin, settings.map((s) => s.inventoryItemId), null, { trackedOnly: true }),
    incomingByVariant(shop),
    draftsByVariant(shop),
  ]);

  const rows: ReorderRow[] = [];
  for (const s of settings) {
    // Deleted in Shopify, or Shopify isn't counting its stock: nothing to reorder.
    if (!available.has(s.inventoryItemId)) continue;
    const onHand = available.get(s.inventoryItemId) ?? 0;
    const onOrder = incoming.get(s.variantId) ?? 0;
    const cases = suggestedCases({
      available: onHand,
      incoming: onOrder,
      reorderPoint: s.reorderPoint,
      parLevel: s.parLevel,
      caseSize: s.caseSize,
    });
    if (cases <= 0) continue;
    rows.push({
      settingId: s.id,
      variantId: s.variantId,
      title: s.title,
      sku: s.sku,
      caseSize: s.caseSize,
      available: onHand,
      incoming: onOrder,
      reorderPoint: s.reorderPoint,
      parLevel: s.parLevel,
      cases,
      costPerCase: s.costPerCase,
      distributorId: s.distributor?.id ?? null,
      distributorName: s.distributor?.name ?? null,
      inventoryItemId: s.inventoryItemId,
      draft: drafts.get(s.variantId) ?? null,
    });
  }
  return rows;
}
