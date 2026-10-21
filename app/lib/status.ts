// Purchase order status names and badge colours. Shared by the server and
// the pages, so it must not import any server-only code.

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIAL: "Partly received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "critical"> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIAL: "warning",
  RECEIVED: "success",
  CANCELLED: "critical",
};
