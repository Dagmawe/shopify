import { createHash } from "node:crypto";
import db from "../db.server";
import { addReceivedStock, type AdminGraphql } from "../lib/shopify-data.server";
import { lineOrderedUnits } from "../lib/units";
import { statusAfterReceiving } from "./purchase-orders.server";

export interface ReceivableLine {
  id: number;
  inventoryItemId: string;
  casesOrdered: number;
  looseOrdered: number;
  caseSize: number;
  unitsReceived: number;
}

export interface ReceivableOrder {
  id: number;
  number: number;
  locationId: string | null;
  lines: ReceivableLine[];
}

export type ReceiveResult =
  | { ok: true; status: "PARTIAL" | "RECEIVED" }
  | { ok: false; error: string };

export class AlreadyRecordedError extends Error {}

// The same delivery, submitted twice (a double click, a retried request),
// produces the same key, so Shopify applies it only once. A later delivery
// starts from different "received so far" numbers, so it gets a new key.
export function deliveryKey(order: ReceivableOrder, units: Map<number, number>): string {
  const parts = order.lines
    .filter((l) => (units.get(l.id) ?? 0) > 0)
    .map((l) => `${l.id}:${l.unitsReceived}+${units.get(l.id)}`)
    .join(",");
  const hash = createHash("sha256").update(`${order.id}|${parts}`).digest("hex").slice(0, 32);
  return `corkcount-receive-${hash}`;
}

// Records a delivery: claims it in Corkcount's database first, then adds the
// stock in Shopify. If Shopify refuses, the claim is undone, so the two never
// disagree. `units` maps line id -> bottles that arrived.
export async function receiveDelivery(
  admin: AdminGraphql,
  order: ReceivableOrder,
  units: Map<number, number>,
): Promise<ReceiveResult> {
  if (!order.locationId) return { ok: false, error: "This order has no delivery location." };

  const changes = order.lines
    .map((line) => ({ line, units: Math.max(0, Math.floor(units.get(line.id) ?? 0)) }))
    .filter((c) => c.units > 0);
  if (!changes.length) return { ok: false, error: "Enter what arrived before receiving." };

  // 1. Claim the delivery. Each line only moves on from the exact number we
  //    read, so a second copy of the same submission finds it already moved.
  try {
    await db.$transaction(async (tx) => {
      for (const c of changes) {
        const res = await tx.purchaseOrderLine.updateMany({
          where: { id: c.line.id, unitsReceived: c.line.unitsReceived },
          data: { unitsReceived: c.line.unitsReceived + c.units },
        });
        if (res.count !== 1) throw new AlreadyRecordedError();
      }
    });
  } catch (err) {
    if (err instanceof AlreadyRecordedError) {
      return {
        ok: false,
        error: "This delivery was already recorded. Reload the page to see the latest counts.",
      };
    }
    throw err;
  }

  // 2. Add the stock in Shopify.
  try {
    await addReceivedStock(admin, {
      locationId: order.locationId,
      reference: `corkcount://purchase-order/${order.number}`,
      idempotencyKey: deliveryKey(order, units),
      changes: changes.map((c) => ({ inventoryItemId: c.line.inventoryItemId, delta: c.units })),
    });
  } catch (err) {
    // 3. Shopify refused: undo the claim so the order still shows what's owed.
    await db.$transaction(
      changes.map((c) =>
        db.purchaseOrderLine.updateMany({
          where: { id: c.line.id, unitsReceived: c.line.unitsReceived + c.units },
          data: { unitsReceived: c.line.unitsReceived },
        }),
      ),
    );
    return {
      ok: false,
      error: `Shopify didn't accept the stock update, so nothing was changed. ${
        err instanceof Error ? err.message : ""
      }`.trim(),
    };
  }

  // 4. Update the order's status from what has now arrived.
  const updated = order.lines.map((line) => ({
    ...line,
    unitsReceived: line.unitsReceived + (changes.find((c) => c.line.id === line.id)?.units ?? 0),
  }));
  const status = statusAfterReceiving(updated);
  await db.purchaseOrder.update({
    where: { id: order.id },
    data: { status, receivedAt: status === "RECEIVED" ? new Date() : null },
  });
  return { ok: true, status };
}

// What's still owed on each line, in bottles.
export function remainingUnits(line: ReceivableLine): number {
  return Math.max(0, lineOrderedUnits(line) - line.unitsReceived);
}
