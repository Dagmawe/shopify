/**
 * B2B Order Minimums & Case-Pack Validator — Shopify Function (`purchase.validation.run`)
 *
 * Runs server-side inside Shopify's Checkout Engine (<5ms in WebAssembly).
 * Cannot be bypassed via Apple Pay, Shop Pay, drawer carts, or direct /checkout URLs.
 */

export interface ValidationRuleConfig {
  id: string;
  title: string;
  enabled: boolean;
  targetAudience: "ALL" | "B2B_TAGGED" | "NON_B2B";
  customerTag: string;
  minOrderSubtotal: number;
  minTotalQuantity: number;
  casePackMultiple: number;
  mixMatchCaseMultiple: number;
  customErrorPrefix: string;
}

export interface RunInput {
  cart: {
    buyerIdentity?: {
      customer?: {
        id: string;
        hasB2bTag: boolean;
      } | null;
    } | null;
    cost: {
      subtotalAmount: {
        amount: string;
        currencyCode: string;
      };
    };
    lines: Array<{
      id: string;
      quantity: number;
      merchandise: {
        __typename: string;
        id?: string;
        title?: string;
        product?: {
          id: string;
          title: string;
        };
      };
    }>;
  };
  validation?: {
    metafield?: {
      value: string;
    } | null;
  } | null;
}

export interface ValidationError {
  localizedMessage: string;
  target: string;
}

export interface FunctionRunResult {
  errors: ValidationError[];
}

export function run(input: RunInput): FunctionRunResult {
  const errors: ValidationError[] = [];

  const rawConfig = input.validation?.metafield?.value;
  if (!rawConfig) {
    return { errors };
  }

  let rules: ValidationRuleConfig[] = [];
  try {
    const parsed = JSON.parse(rawConfig);
    rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch {
    return { errors };
  }

  const isB2bCustomer = Boolean(input.cart.buyerIdentity?.customer?.hasB2bTag);
  const subtotal = parseFloat(input.cart.cost.subtotalAmount.amount || "0");
  const currency = input.cart.cost.subtotalAmount.currencyCode || "USD";
  const totalQuantity = input.cart.lines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // 1. Check Customer Tag / Audience Scope
    if (rule.targetAudience === "B2B_TAGGED" && !isB2bCustomer) {
      continue;
    }
    if (rule.targetAudience === "NON_B2B" && isB2bCustomer) {
      continue;
    }

    const prefix = rule.customErrorPrefix
      ? `${rule.customErrorPrefix.trim()} `
      : "";

    // 2. Enforce Minimum Order Value (MOV)
    if (rule.minOrderSubtotal > 0 && subtotal < rule.minOrderSubtotal) {
      const remaining = (rule.minOrderSubtotal - subtotal).toFixed(2);
      errors.push({
        localizedMessage: `${prefix}Minimum order subtotal is ${rule.minOrderSubtotal.toFixed(2)} ${currency}. Please add ${remaining} ${currency} more to proceed to checkout.`,
        target: "$.cart",
      });
    }

    // 3. Enforce Minimum Order Quantity (MOQ)
    if (rule.minTotalQuantity > 0 && totalQuantity < rule.minTotalQuantity) {
      const missingUnits = rule.minTotalQuantity - totalQuantity;
      errors.push({
        localizedMessage: `${prefix}Minimum total order quantity is ${rule.minTotalQuantity} units (currently ${totalQuantity}). Please add ${missingUnits} more unit(s).`,
        target: "$.cart",
      });
    }

    // 4. Enforce Per-SKU Case-Pack Multiples (e.g. must order in multiples of 6 per SKU)
    if (rule.casePackMultiple > 1) {
      for (const line of input.cart.lines) {
        if (line.quantity % rule.casePackMultiple !== 0) {
          const productTitle =
            line.merchandise.product?.title || "Selected item";
          const variantTitle =
            line.merchandise.title && line.merchandise.title !== "Default Title"
              ? ` (${line.merchandise.title})`
              : "";
          const nextValidQty =
            Math.ceil(line.quantity / rule.casePackMultiple) *
            rule.casePackMultiple;

          errors.push({
            localizedMessage: `${prefix}"${productTitle}${variantTitle}" must be ordered in case packs of ${rule.casePackMultiple} units (current qty: ${line.quantity}; try ${nextValidQty}).`,
            target: "$.cart",
          });
        }
      }
    }

    // 5. Enforce Mix-and-Match Full Case Multiples across the Cart (e.g. total units must be a multiple of 12)
    if (
      rule.mixMatchCaseMultiple > 1 &&
      totalQuantity > 0 &&
      totalQuantity % rule.mixMatchCaseMultiple !== 0
    ) {
      const remainder = totalQuantity % rule.mixMatchCaseMultiple;
      const neededToCompleteCase = rule.mixMatchCaseMultiple - remainder;
      errors.push({
        localizedMessage: `${prefix}Mix-and-Match cases require multiples of ${rule.mixMatchCaseMultiple} total units. Add ${neededToCompleteCase} more unit(s) to complete your case (${totalQuantity} units in cart).`,
        target: "$.cart",
      });
    }
  }

  return { errors };
}
