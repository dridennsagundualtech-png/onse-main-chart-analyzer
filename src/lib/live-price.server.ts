/**
 * Live price lookup (server only).
 *
 * Cross-references the AI's screenshot-based read against a real, current
 * price so a user can see whether the market has already moved away from a
 * suggested entry zone by the time they view the analysis.
 *
 * Deliberately conservative:
 * - Never feeds a scraped number into the AI prompt as if it were ground
 *   truth — it only annotates the result AFTER the model has already
 *   produced its read, so it can never talk the model into a different call.
 * - Any failure (missing key, network error, unparsable response) returns
 *   null silently. The rest of the analysis proceeds exactly as before.
 */

export interface LivePriceContext {
  price: number;
  as_of: string;
  source: string;
}

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";

/** Extracts the first plausible decimal price from a short snippet of text. */
function extractPrice(text: string): number | null {
  const match = text.match(/(?:USD|US\$|\$|price(?: is| of)?[:\s]*)\s*([0-9][0-9,]*\.?[0-9]*)/i);
  if (!match) return null;
  const n = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Looks up a rough current price for `asset` using Firecrawl search.
 * Requires FIRECRAWL_API_KEY to be set as a server env var — returns null
 * (not an error) if it isn't, so this feature degrades gracefully.
 */
export async function fetchLivePrice(
  asset: string,
  marketType: string,
): Promise<LivePriceContext | null> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey) return null;
  if (!asset || asset.toUpperCase() === "UNKNOWN") return null;

  try {
    const query = `${asset} ${marketType && marketType !== "unknown" ? marketType : ""} price today`.trim();

    const response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit: 3,
        sources: [{ type: "web" }],
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: { web?: { title?: string; description?: string }[] };
    };
    const results = payload.data?.web ?? [];

    for (const result of results) {
      const text = `${result.title ?? ""} ${result.description ?? ""}`;
      const price = extractPrice(text);
      if (price !== null) {
        return { price, as_of: new Date().toISOString(), source: "firecrawl_search" };
      }
    }
    return null;
  } catch {
    // Network hiccup, timeout, bad JSON — never let this break an analysis.
    return null;
  }
}

/**
 * Compares a live price against an entry zone string like "3345.20-3348.60"
 * or a single value like "3346.50". Returns a short, honest, non-predictive
 * note, or null if there's nothing meaningful to say.
 */
export function checkPriceDrift(
  entryZone: string | null,
  live: LivePriceContext | null,
): string | null {
  if (!entryZone || !live) return null;

  const numbers = entryZone.match(/[0-9]+\.?[0-9]*/g)?.map(Number) ?? [];
  if (!numbers.length) return null;

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);

  if (live.price >= low && live.price <= high) {
    return `Live price (${live.price}) is currently inside the entry zone.`;
  }

  const boundary = live.price > high ? high : low;
  const direction = live.price > high ? "above" : "below";
  const distancePct = (Math.abs(live.price - boundary) / live.price) * 100;

  return `Live price (${live.price}) is currently ${direction} the entry zone by ~${distancePct.toFixed(2)}%. This is informational only — it does not mean the setup is invalid, but the original entry zone may already be behind price.`;
}
