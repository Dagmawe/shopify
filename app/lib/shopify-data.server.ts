// All calls to Shopify's Admin GraphQL API live here, so the pages stay simple.

import { createHash } from "node:crypto";

export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

async function gql<T>(
  admin: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) {
    throw new Error(`Shopify API error: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Store currency
// ---------------------------------------------------------------------------

export async function getShopCurrency(admin: AdminGraphql): Promise<string> {
  const data = await gql<{ shop: { currencyCode: string } }>(
    admin,
    `#graphql
    query CorkcountShopCurrency {
      shop { currencyCode }
    }`,
  );
  return data.shop.currencyCode || "USD";
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface Location {
  id: string;
  name: string;
}

export async function getLocations(admin: AdminGraphql): Promise<Location[]> {
  const data = await gql<{ locations: { nodes: Location[] } }>(
    admin,
    `#graphql
    query CorkcountLocations {
      locations(first: 50, includeInactive: false) {
        nodes { id name }
      }
    }`,
  );
  return data.locations.nodes;
}

// ---------------------------------------------------------------------------
// Product variants
// ---------------------------------------------------------------------------

export interface VariantRow {
  variantId: string;
  inventoryItemId: string;
  title: string;
  sku: string | null;
  available: number;
  // False when Shopify isn't counting this product's stock.
  tracked: boolean;
}

interface VariantNode {
  id: string;
  displayName: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { id: string; tracked: boolean };
}

export async function searchVariants(
  admin: AdminGraphql,
  search: string,
  after?: string | null,
): Promise<{ rows: VariantRow[]; endCursor: string | null; hasNextPage: boolean }> {
  const data = await gql<{
    productVariants: {
      nodes: VariantNode[];
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };
  }>(
    admin,
    `#graphql
    query CorkcountVariants($query: String, $after: String) {
      productVariants(first: 50, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          displayName
          sku
          inventoryQuantity
          inventoryItem { id tracked }
        }
        pageInfo { endCursor hasNextPage }
      }
    }`,
    { query: search ? search : null, after: after || null },
  );
  return {
    rows: data.productVariants.nodes.map((n) => ({
      variantId: n.id,
      inventoryItemId: n.inventoryItem.id,
      // Products without variants are named "Wine - Default Title"; drop that part.
      title: n.displayName.replace(/ - Default Title$/, ""),
      sku: n.sku || null,
      available: n.inventoryQuantity ?? 0,
      tracked: n.inventoryItem.tracked,
    })),
    endCursor: data.productVariants.pageInfo.endCursor,
    hasNextPage: data.productVariants.pageInfo.hasNextPage,
  };
}

// ---------------------------------------------------------------------------
// Inventory levels
// ---------------------------------------------------------------------------

// Returns available quantity per inventory item. With a location, only that
// location's stock is counted; without one, stock is summed across locations.
// Items Shopify no longer has (deleted products) are left out of the result.
// With trackedOnly, so are items whose stock Shopify doesn't track.
export async function getAvailable(
  admin: AdminGraphql,
  inventoryItemIds: string[],
  locationId?: string | null,
  options: { trackedOnly?: boolean } = {},
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const unique = Array.from(new Set(inventoryItemIds));
  // Shopify refuses queries that could cost more than 1,000 points. One
  // location's level costs little, so 100 items fit; levels across every
  // location cost about 27 points per item, so 25 items stay near 700.
  const batchSize = locationId ? 100 : 25;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    if (locationId) {
      const data = await gql<{
        nodes: Array<{
          id: string;
          inventoryLevel: { quantities: Array<{ quantity: number }> } | null;
        } | null>;
      }>(
        admin,
        `#graphql
        query CorkcountLevelAt($ids: [ID!]!, $locationId: ID!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) { quantity }
              }
            }
          }
        }`,
        { ids: batch, locationId },
      );
      for (const node of data.nodes) {
        if (!node?.id) continue;
        result.set(node.id, node.inventoryLevel?.quantities[0]?.quantity ?? 0);
      }
    } else {
      const data = await gql<{
        nodes: Array<{
          id: string;
          tracked: boolean;
          inventoryLevels: { nodes: Array<{ quantities: Array<{ quantity: number }> }> };
        } | null>;
      }>(
        admin,
        `#graphql
        query CorkcountLevels($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              tracked
              inventoryLevels(first: 25) {
                nodes { quantities(names: ["available"]) { quantity } }
              }
            }
          }
        }`,
        { ids: batch },
      );
      for (const node of data.nodes) {
        if (!node?.id) continue;
        if (options.trackedOnly && !node.tracked) continue;
        const total = node.inventoryLevels.nodes.reduce(
          (sum, level) => sum + (level.quantities[0]?.quantity ?? 0),
          0,
        );
        result.set(node.id, total);
      }
    }
  }
  return result;
}

// Makes sure an item is stocked at a location before we add inventory there.
async function ensureStockedAt(
  admin: AdminGraphql,
  inventoryItemId: string,
  locationId: string,
): Promise<void> {
  const data = await gql<{
    inventoryActivate: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
    mutation CorkcountActivate($inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
        inventoryLevel { id }
        userErrors { message }
      }
    }`,
    { inventoryItemId, locationId },
  );
  const errors = data.inventoryActivate.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

async function hasLevelAt(
  admin: AdminGraphql,
  inventoryItemId: string,
  locationId: string,
): Promise<boolean> {
  const data = await gql<{
    inventoryItem: { inventoryLevel: { id: string } | null } | null;
  }>(
    admin,
    `#graphql
    query CorkcountHasLevel($id: ID!, $locationId: ID!) {
      inventoryItem(id: $id) {
        inventoryLevel(locationId: $locationId) { id }
      }
    }`,
    { id: inventoryItemId, locationId },
  );
  return Boolean(data.inventoryItem?.inventoryLevel);
}

// Adds received stock to Shopify. Uses compare-and-set (changeFromQuantity)
// so a sale that happens at the same moment can't be overwritten. The
// idempotency key is the caller's delivery key plus the stock we just read:
// a repeat of the identical request counts once, while a retry after a sale
// changed the stock gets a fresh key instead of Shopify's cached refusal.
export async function addReceivedStock(
  admin: AdminGraphql,
  params: {
    locationId: string;
    reference: string;
    idempotencyKey: string;
    changes: Array<{ inventoryItemId: string; delta: number }>;
  },
): Promise<void> {
  const changes = params.changes.filter((c) => c.delta !== 0);
  if (!changes.length) return;

  for (const change of changes) {
    if (!(await hasLevelAt(admin, change.inventoryItemId, params.locationId))) {
      await ensureStockedAt(admin, change.inventoryItemId, params.locationId);
    }
  }

  const current = await getAvailable(
    admin,
    changes.map((c) => c.inventoryItemId),
    params.locationId,
  );

  const data = await gql<{
    inventoryAdjustQuantities: { userErrors: Array<{ field: string[]; message: string }> };
  }>(
    admin,
    `#graphql
    mutation CorkcountReceive($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
      inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { id }
        userErrors { field message }
      }
    }`,
    {
      idempotencyKey: `${params.idempotencyKey}:${createHash("sha256")
        .update(changes.map((c) => `${c.inventoryItemId}=${current.get(c.inventoryItemId) ?? 0}`).join(","))
        .digest("hex")
        .slice(0, 16)}`,
      input: {
        reason: "received",
        name: "available",
        referenceDocumentUri: params.reference,
        changes: changes.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId: params.locationId,
          delta: c.delta,
          changeFromQuantity: current.get(c.inventoryItemId) ?? 0,
        })),
      },
    },
  );
  const errors = data.inventoryAdjustQuantities.userErrors;
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}
