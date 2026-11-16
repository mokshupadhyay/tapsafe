const SYMBOLS: Record<string, string> = { "₹": "INR", $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

/**
 * Turns a printed amount into a number of minor units (paise/cents), so comparisons are exact.
 * Handles "₹1,250.00", "1.250,00 €", "12,50", "Rs. 450", "450". Returns null if it isn't a clean amount.
 */
export function parseAmount(text: string): { minor: number; currency: string } | null {
  if (!text) return null;
  let currency = "";
  for (const [sym, code] of Object.entries(SYMBOLS)) if (text.includes(sym)) currency = code;
  if (/\b(rs\.?|inr)\b/i.test(text)) currency = "INR";
  const iso = text.match(/\b(USD|EUR|GBP|JPY|AUD|CAD|SGD|AED)\b/i);
  if (iso) currency = iso[1].toUpperCase();

  const numeric = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) return null;

  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  const sepIndex = Math.max(lastDot, lastComma);
  let whole = numeric;
  let fraction = "";
  // A separator followed by exactly 1–2 digits is a decimal point; otherwise it's a thousands separator.
  if (sepIndex !== -1 && /^\d{1,2}$/.test(numeric.slice(sepIndex + 1))) {
    whole = numeric.slice(0, sepIndex);
    fraction = numeric.slice(sepIndex + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole || "0")) return null;
  const minor = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) ? { minor, currency } : null;
}

export function formatMinor(minor: number, currency: string): string {
  const value = minor / 100;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

/** Words a screen reader / speech synth will read clearly, e.g. "1,250 rupees and 50 paise". */
export function spokenAmount(minor: number, currency: string): string {
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  const names: Record<string, [string, string]> = {
    INR: ["rupees", "paise"],
    USD: ["dollars", "cents"],
    EUR: ["euros", "cents"],
    GBP: ["pounds", "pence"],
  };
  const [major, small] = names[currency] ?? ["", "hundredths"];
  const wholeText = `${whole.toLocaleString("en-IN")}${major ? " " + major : ""}`;
  return frac ? `${wholeText} and ${frac} ${small}` : wholeText;
}

export type Verdict = "match" | "mismatch" | "no_expected" | "unreadable";

export function compare(expectedMinor: number | null, readMinor: number | null): Verdict {
  if (readMinor === null) return "unreadable";
  if (expectedMinor === null) return "no_expected";
  return expectedMinor === readMinor ? "match" : "mismatch";
}
