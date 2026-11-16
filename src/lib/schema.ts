export const SCREEN_TYPES = [
  "sale",
  "refund",
  "tip_prompt",
  "pin_entry",
  "approved",
  "declined",
  "other",
] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];

export interface TerminalReading {
  readable: boolean;
  /** Amount exactly as printed, e.g. "₹1,250.00" or "12,50". Empty if none is visible. */
  amountText: string;
  /** ISO 4217 code if the model can tell, otherwise empty. */
  currency: string;
  merchant: string;
  screenType: ScreenType;
  /** Model's own confidence, 0..1. Treated as a hint only; see needsSecondOpinion(). */
  confidence: number;
}

/** Same schema for Gemini Nano (responseConstraint) and the cloud model (responseJsonSchema). */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    amountText: { type: "string" },
    currency: { type: "string" },
    merchant: { type: "string" },
    screenType: { type: "string", enum: [...SCREEN_TYPES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["readable", "amountText", "currency", "merchant", "screenType", "confidence"],
  additionalProperties: false,
} as const;

export const READ_PROMPT = `You are helping a blind person check a card payment terminal before they tap their card.
Look at the photo of the terminal's screen and report exactly what it shows.
- amountText: the payment amount exactly as printed (keep symbols, commas and decimals). Empty string if no amount is visible.
- currency: ISO 4217 code (INR, USD, EUR, GBP...) if a symbol or code is visible, else empty string.
- merchant: shop name if shown, else empty string.
- screenType: sale, refund, tip_prompt, pin_entry, approved, declined, or other.
- readable: false if glare, blur or angle stops you reading the amount with certainty.
- confidence: 0 to 1, how sure you are the amount is exactly right.
Never guess digits. If any digit is unclear, set readable to false.`;

export function parseReading(text: string): TerminalReading {
  const raw = JSON.parse(stripFences(text)) as Partial<TerminalReading>;
  const screenType = SCREEN_TYPES.includes(raw.screenType as ScreenType) ? (raw.screenType as ScreenType) : "other";
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0;
  return {
    readable: raw.readable === true,
    amountText: String(raw.amountText ?? "").trim(),
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    merchant: String(raw.merchant ?? "").trim(),
    screenType,
    confidence,
  };
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
