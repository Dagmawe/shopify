import db from "../db.server";
import { lineCost, lineOrderedUnits } from "../lib/units";

export const OPEN_STATUSES = ["ORDERED", "PARTIAL"];

export { STATUS_LABEL, STATUS_TONE } from "../lib/status";

export async function nextPoNumber(shop: string): Promise<number> {
  const last = await db.purchaseOrder.findFirst({
    where: { shop },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 1000) + 1;
}

// Bottles already on order (ordered but not yet received), per variant.
export async function incomingByVariant(shop: string): Promise<Map<string, number>> {
  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrder: { shop, status: { in: OPEN_STATUSES } } },
    select: {
      variantId: true,
      casesOrdered: true,
      looseOrdered: true,
      caseSize: true,
      unitsReceived: true,
    },
  });
  const map = new Map<string, number>();
  for (const line of lines) {
    const outstanding = Math.max(0, lineOrderedUnits(line) - line.unitsReceived);
    map.set(line.variantId, (map.get(line.variantId) ?? 0) + outstanding);
  }
  return map;
}

export function poTotals(
  lines: Array<{
    casesOrdered: number;
    looseOrdered: number;
    caseSize: number;
    costPerCase: number | null;
    unitsReceived: number;
  }>,
) {
  let cases = 0;
  let units = 0;
  let received = 0;
  let cost = 0;
  let costKnown = true;
  for (const line of lines) {
    cases += line.casesOrdered;
    units += lineOrderedUnits(line);
    received += line.unitsReceived;
    const c = lineCost(line);
    if (c == null) costKnown = false;
    else cost += c;
  }
  return { cases, units, received, cost: costKnown ? cost : null };
}

// Sets PARTIAL or RECEIVED based on what has arrived so far.
export function statusAfterReceiving(
  lines: Array<{ casesOrdered: number; looseOrdered: number; caseSize: number; unitsReceived: number }>,
): "PARTIAL" | "RECEIVED" {
  const allIn = lines.every((l) => l.unitsReceived >= lineOrderedUnits(l));
  return allIn ? "RECEIVED" : "PARTIAL";
}
