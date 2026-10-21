// Shopify counts stock in single units (bottles). Distributors sell in cases.
// These helpers convert between the two so the rest of the app never has to.

export function toUnits(cases: number, loose: number, caseSize: number): number {
  const size = Math.max(1, Math.floor(caseSize || 1));
  return Math.max(0, Math.floor(cases || 0)) * size + Math.max(0, Math.floor(loose || 0));
}

export function splitUnits(units: number, caseSize: number): { cases: number; loose: number } {
  const size = Math.max(1, Math.floor(caseSize || 1));
  const total = Math.max(0, Math.floor(units || 0));
  return { cases: Math.floor(total / size), loose: total % size };
}

// "3 cs + 4 btl", "2 cs", "5 btl", "0"
export function formatUnits(units: number, caseSize: number, unitLabel = "btl"): string {
  const { cases, loose } = splitUnits(units, caseSize);
  if (caseSize <= 1) return `${units} ${unitLabel}`;
  const parts: string[] = [];
  if (cases) parts.push(`${cases} cs`);
  if (loose) parts.push(`${loose} ${unitLabel}`);
  return parts.length ? parts.join(" + ") : "0";
}

export interface ReorderInput {
  available: number; // bottles on hand
  incoming: number; // bottles on open purchase orders, not yet received
  reorderPoint: number; // reorder when on hand + incoming falls to this
  parLevel: number; // target stock after the order arrives
  caseSize: number;
}

// Returns how many full cases to order, or 0 if no reorder is needed.
// Rounds up to whole cases because distributors ship whole cases.
export function suggestedCases(input: ReorderInput): number {
  const { available, incoming, reorderPoint, parLevel, caseSize } = input;
  if (reorderPoint <= 0 && parLevel <= 0) return 0;
  const projected = available + incoming;
  if (projected > reorderPoint) return 0;
  const target = Math.max(parLevel, reorderPoint + 1);
  const shortBy = target - projected;
  if (shortBy <= 0) return 0;
  return Math.ceil(shortBy / Math.max(1, caseSize));
}

export function lineOrderedUnits(line: {
  casesOrdered: number;
  looseOrdered: number;
  caseSize: number;
}): number {
  return toUnits(line.casesOrdered, line.looseOrdered, line.caseSize);
}

export function lineCost(line: {
  casesOrdered: number;
  looseOrdered: number;
  caseSize: number;
  costPerCase: number | null;
}): number | null {
  if (line.costPerCase == null) return null;
  const perUnit = line.costPerCase / Math.max(1, line.caseSize);
  return Math.round((line.casesOrdered * line.costPerCase + line.looseOrdered * perUnit) * 100) / 100;
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `$${amount.toFixed(2)}`;
}
