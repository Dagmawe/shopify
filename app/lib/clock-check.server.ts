// Shopify's sign-in tokens last one minute and the library allows only
// 10 seconds of clock difference. If this computer's clock is off, every
// page in the app fails to sign in with no obvious reason. This compares the
// local clock with Shopify's once at startup and prints a clear warning.

const WARN_AFTER_SECONDS = 5;

let checked = false;

export function checkClockOnce(): void {
  if (checked) return;
  checked = true;
  void checkClock();
}

async function checkClock(): Promise<void> {
  try {
    const before = Date.now();
    const response = await fetch("https://shopify.dev/", { method: "HEAD" });
    const after = Date.now();
    const header = response.headers.get("date");
    if (!header) return;

    // The Date header has 1-second precision; compare against the midpoint
    // of the request so network time doesn't count as drift.
    const shopifyTime = new Date(header).getTime() + 500;
    const localTime = (before + after) / 2;
    const driftSeconds = Math.round((localTime - shopifyTime) / 1000);

    if (Math.abs(driftSeconds) >= WARN_AFTER_SECONDS) {
      const direction = driftSeconds > 0 ? "ahead of" : "behind";
      console.warn(
        [
          "",
          "==================================================================",
          `[Corkcount] This computer's clock is ${Math.abs(driftSeconds)} seconds ${direction} Shopify's.`,
          "Sign-in will fail and the app will show \"Handling response\" or a",
          "blank page. Fix: turn on automatic time sync.",
          "  Windows: right-click the taskbar clock > Adjust date and time >",
          "           Set time automatically > Sync now",
          "  Mac:     System Settings > General > Date & Time > Set automatically",
          "==================================================================",
          "",
        ].join("\n"),
      );
    } else {
      console.log(`[Corkcount] Clock check OK (within ${Math.abs(driftSeconds)}s of Shopify).`);
    }
  } catch {
    // No network, or the check itself failed: never block the app over this.
  }
}
