import { parseAmount } from "./amount";

/**
 * Reading the printed bill before paying. A restaurant or pharmacy bill is long and dense, so it goes to the
 * larger cloud model; the app then re-does the arithmetic itself and never trusts the model's total on its own.
 */

export const BILL_LINE_KINDS = ["item", "tax", "service_charge", "discount", "tip", "round_off", "other_fee"] as const;
export type BillLineKind = (typeof BILL_LINE_KINDS)[number];

export interface BillLine {
  label: string;
  kind: BillLineKind;
  /** Amount exactly as printed; discounts may be printed with a minus sign. */
  amountText: string;
}

export interface BillReading {
  readable: boolean;
  merchant: string;
  currency: string;
  lines: BillLine[];
  /** The grand total exactly as printed. */
  totalText: string;
}

export const BILL_JSON_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    merchant: { type: "string" },
    currency: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string", enum: [...BILL_LINE_KINDS] },
          amountText: { type: "string" },
        },
        required: ["label", "kind", "amountText"],
        additionalProperties: false,
      },
    },
    totalText: { type: "string" },
  },
  required: ["readable", "merchant", "currency", "lines", "totalText"],
  additionalProperties: false,
} as const;

export const BILL_PROMPT = `You are helping a blind person check a printed bill before they pay by card.
Read the photo of the bill and list every line that adds to or takes away from the total.
- lines: one entry per item, tax (GST, CGST, SGST, VAT), service charge, discount, tip, round-off or other fee.
  amountText is the line's final amount exactly as printed (for items, the line total, not the unit price).
  Print discounts with a leading minus sign.
- Do not include subtotal lines; they are not separate charges.
- totalText: the grand total / amount payable exactly as printed.
- currency: ISO 4217 code if visible, else empty string.
- readable: false if any amount is cut off, blurred or uncertain. Never guess digits.`;

export function parseBill(text: string): BillReading {
  const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Partial<BillReading>;
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    readable: raw.readable === true,
    merchant: String(raw.merchant ?? "").trim(),
    currency: String(raw.currency ?? "").trim().toUpperCase(),
    totalText: String(raw.totalText ?? "").trim(),
    lines: lines.map((l) => ({
      label: String(l?.label ?? "").trim(),
      kind: BILL_LINE_KINDS.includes(l?.kind as BillLineKind) ? (l.kind as BillLineKind) : "other_fee",
      amountText: String(l?.amountText ?? "").trim(),
    })),
  };
}

export interface BillCheck {
  /** Grand total in minor units, from the printed total. Null if it couldn't be read. */
  totalMinor: number | null;
  /** Sum of every line, in minor units. */
  sumMinor: number;
  /** True when the printed total equals the sum of the lines (within the 1-unit round-off the bill may already list). */
  adds_up: boolean;
  /** Lines worth telling the user about before they pay. */
  flags: string[];
}

function signedMinor(text: string): number | null {
  const a = parseAmount(text);
  if (!a) return null;
  return /^\s*[-−(]/.test(text) ? -a.minor : a.minor;
}

/** Re-does the bill arithmetic in code. A model can misread one digit; the sum makes that visible. */
export function checkBill(bill: BillReading): BillCheck {
  const totalMinor = parseAmount(bill.totalText)?.minor ?? null;
  let sumMinor = 0;
  let unparsed = 0;
  const flags: string[] = [];

  for (const line of bill.lines) {
    let m = signedMinor(line.amountText);
    if (m === null) {
      unparsed++;
      continue;
    }
    if (line.kind === "discount" && m > 0) m = -m;
    sumMinor += m;
    if (line.kind === "service_charge") flags.push(`Service charge "${line.label}" (${line.amountText}). In India it is optional; you can ask for it to be removed.`);
    if (line.kind === "tip") flags.push(`A tip of ${line.amountText} is already on the bill. Don't add another on the terminal.`);
    if (line.kind === "other_fee") flags.push(`Extra fee: "${line.label}" (${line.amountText}).`);
  }

  const seen = new Map<string, number>();
  for (const line of bill.lines.filter((l) => l.kind === "item")) {
    const key = `${line.label.toLowerCase()}|${line.amountText}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) flags.push(`"${key.split("|")[0]}" appears ${n} times. Check you ordered it ${n} times.`);

  if (unparsed) flags.push(`${unparsed} line${unparsed > 1 ? "s" : ""} couldn't be read as an amount.`);
  const adds_up = totalMinor !== null && unparsed === 0 && Math.abs(totalMinor - sumMinor) <= 100;
  if (totalMinor !== null && !adds_up && unparsed === 0) flags.unshift("The lines don't add up to the printed total. Ask for the bill to be checked.");
  return { totalMinor, sumMinor, adds_up, flags };
}
