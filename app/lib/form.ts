// Reading values from submitted forms. Everything a merchant types arrives
// as text, so these turn it into safe numbers, prices, dates and text.

// Large enough for any real quantity, small enough for the database (whose
// whole numbers stop at about 2 billion) and for Shopify's stock limits.
export const MAX_QUANTITY = 1_000_000;
export const MAX_PRICE = 1_000_000;
export const MAX_TEXT = 2_000;

export function intField(form: FormData, key: string, fallback = 0): number {
  const raw = form.get(key);
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-MAX_QUANTITY, Math.min(MAX_QUANTITY, n));
}

export function floatField(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (raw == null || raw === "") return null;
  const n = Number.parseFloat(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

// A price: never negative, rounded to cents, blank means "not set".
export function moneyField(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Math.min(n, MAX_PRICE) * 100) / 100;
}

export function textField(form: FormData, key: string, maxLength = MAX_TEXT): string | null {
  const raw = form.get(key);
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, maxLength);
  return s ? s : null;
}

// A calendar date (YYYY-MM-DD) stored at midday UTC, so it shows as the
// same day in every time zone. Returns null for blank, "invalid" for junk.
export function dateField(form: FormData, key: string): Date | null | "invalid" {
  const raw = textField(form, key, 20);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "invalid";
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "invalid";
  // Reject dates that roll over, like 2026-02-31.
  if (date.toISOString().slice(0, 10) !== raw) return "invalid";
  const year = Number(match[1]);
  if (year < 2000 || year > 2100) return "invalid";
  return date;
}
