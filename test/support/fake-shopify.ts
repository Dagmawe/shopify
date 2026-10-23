/* eslint-disable @typescript-eslint/no-explicit-any -- test double for loosely typed GraphQL variables */
// An in-memory stand-in for Shopify's Admin GraphQL API. It understands the
// operations Corkcount sends (by their "Corkcount..." names), keeps stock per
// item and location, and records every stock change so tests can check them.

import type { AdminGraphql } from "../../app/lib/shopify-data.server";

export interface FakeShopifyOptions {
  locations?: Array<{ id: string; name: string }>;
  // stock[inventoryItemId][locationId] = available bottles
  stock?: Record<string, Record<string, number>>;
  subscriptions?: Array<{ name: string; status: string }>;
  appHandle?: string;
  currencyCode?: string;
  // Items that exist but whose stock Shopify doesn't track.
  untracked?: string[];
}

export interface RecordedAdjustment {
  idempotencyKey: string;
  reason: string;
  reference: string;
  changes: Array<{ inventoryItemId: string; locationId: string; delta: number; changeFromQuantity: number }>;
}

export class FakeShopify implements AdminGraphql {
  locations: Array<{ id: string; name: string }>;
  stock: Record<string, Record<string, number>>;
  subscriptions: Array<{ name: string; status: string }>;
  appHandle: string;
  currencyCode: string;
  untracked: Set<string>;
  adjustments: RecordedAdjustment[] = [];
  attemptedKeys: string[] = [];
  activations: Array<{ inventoryItemId: string; locationId: string }> = [];
  seenKeys = new Set<string>();
  calls: string[] = [];
  // Set to make the next stock adjustment fail with this user error.
  failNextAdjustment: string | null = null;

  constructor(options: FakeShopifyOptions = {}) {
    this.locations = options.locations ?? [
      { id: "gid://shopify/Location/1", name: "Main store" },
      { id: "gid://shopify/Location/2", name: "Warehouse" },
    ];
    this.stock = structuredClone(options.stock ?? {});
    this.subscriptions = options.subscriptions ?? [];
    this.appHandle = options.appHandle ?? "corkcount";
    this.untracked = new Set(options.untracked ?? []);
    this.currencyCode = options.currencyCode ?? "USD";
  }

  available(itemId: string, locationId: string): number {
    return this.stock[itemId]?.[locationId] ?? 0;
  }

  graphql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response> => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
    this.calls.push(name);
    const v = (options?.variables ?? {}) as Record<string, any>;
    return json(this.handle(name, v));
  };

  private handle(name: string, v: Record<string, any>): unknown {
    switch (name) {
      case "CorkcountShopCurrency":
        return { data: { shop: { currencyCode: this.currencyCode } } };

      case "CorkcountLocations":
        return { data: { locations: { nodes: this.locations } } };

      case "CorkcountLevels":
        return {
          data: {
            nodes: (v.ids as string[]).map((id) =>
              this.stock[id]
                ? {
                    id,
                    tracked: !this.untracked.has(id),
                    inventoryLevels: {
                      nodes: Object.values(this.stock[id]).map((q) => ({
                        quantities: [{ quantity: q }],
                      })),
                    },
                  }
                : null,
            ),
          },
        };

      case "CorkcountLevelAt":
        return {
          data: {
            nodes: (v.ids as string[]).map((id) => ({
              id,
              inventoryLevel:
                this.stock[id]?.[v.locationId] === undefined
                  ? null
                  : { quantities: [{ quantity: this.stock[id][v.locationId] }] },
            })),
          },
        };

      case "CorkcountHasLevel":
        return {
          data: {
            inventoryItem: {
              inventoryLevel:
                this.stock[v.id]?.[v.locationId] === undefined ? null : { id: "level" },
            },
          },
        };

      case "CorkcountActivate":
        this.activations.push({ inventoryItemId: v.inventoryItemId, locationId: v.locationId });
        this.stock[v.inventoryItemId] ??= {};
        this.stock[v.inventoryItemId][v.locationId] ??= 0;
        return { data: { inventoryActivate: { inventoryLevel: { id: "level" }, userErrors: [] } } };

      case "CorkcountReceive": {
        const input = v.input;
        this.attemptedKeys.push(v.idempotencyKey);
        if (this.failNextAdjustment) {
          const message = this.failNextAdjustment;
          this.failNextAdjustment = null;
          return {
            data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input"], message }] } },
          };
        }
        // Same key again: Shopify returns the original result and changes nothing.
        if (this.seenKeys.has(v.idempotencyKey)) {
          return { data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: "group" }, userErrors: [] } } };
        }
        for (const c of input.changes) {
          if (this.available(c.inventoryItemId, c.locationId) !== c.changeFromQuantity) {
            return {
              data: {
                inventoryAdjustQuantities: {
                  inventoryAdjustmentGroup: null,
                  userErrors: [{ field: ["changeFromQuantity"], message: "The quantity changed. Try again." }],
                },
              },
            };
          }
        }
        this.seenKeys.add(v.idempotencyKey);
        for (const c of input.changes) {
          this.stock[c.inventoryItemId] ??= {};
          this.stock[c.inventoryItemId][c.locationId] = this.available(c.inventoryItemId, c.locationId) + c.delta;
        }
        this.adjustments.push({
          idempotencyKey: v.idempotencyKey,
          reason: input.reason,
          reference: input.referenceDocumentUri,
          changes: input.changes,
        });
        return { data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: "group" }, userErrors: [] } } };
      }

      case "CorkcountPlan":
        return { data: { currentAppInstallation: { activeSubscriptions: this.subscriptions } } };

      case "CorkcountAppHandle":
        return { data: { currentAppInstallation: { app: { handle: this.appHandle } } } };

      default:
        return { errors: [{ message: `FakeShopify doesn't know ${name}` }] };
    }
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
