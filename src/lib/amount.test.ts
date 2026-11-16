import { describe, expect, it, vi } from "vitest";
import { compare, parseAmount, spokenAmount } from "./amount";
import { parseReading } from "./schema";

vi.mock("./firebase", () => ({ deviceFirstModel: {}, cloudModel: {}, cloudConfigured: false }));
const { needsSecondOpinion } = await import("./reader");

describe("parseAmount", () => {
  it.each([
    ["₹180.00", 18000, "INR"],
    ["₹1,800.00", 180000, "INR"],
    ["Rs. 450", 45000, "INR"],
    ["1,250", 125000, ""],
    ["12,50 €", 1250, "EUR"],
    ["1.250,00 EUR", 125000, "EUR"],
    ["$4.5", 450, "USD"],
    ["642.50", 64250, ""],
  ])("%s → %d minor units", (text, minor, currency) => {
    expect(parseAmount(text)).toEqual({ minor, currency });
  });

  it("rejects text with no digits", () => {
    expect(parseAmount("TAP CARD")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("compare", () => {
  it("matches exact amounts and flags any difference, even 1 paisa", () => {
    expect(compare(18000, 18000)).toBe("match");
    expect(compare(18000, 18001)).toBe("mismatch");
    expect(compare(18000, 180000)).toBe("mismatch");
    expect(compare(null, 18000)).toBe("no_expected");
    expect(compare(18000, null)).toBe("unreadable");
  });
});

describe("spokenAmount", () => {
  it("reads rupees and paise in words a screen reader handles well", () => {
    expect(spokenAmount(64250, "INR")).toBe("642 rupees and 50 paise");
    expect(spokenAmount(180000, "INR")).toBe("1,800 rupees");
  });
});

describe("parseReading", () => {
  it("accepts fenced JSON and clamps bad values", () => {
    const r = parseReading('```json\n{"readable":true,"amountText":" ₹180.00 ","currency":"inr","merchant":"Cafe","screenType":"weird","confidence":3}\n```');
    expect(r).toEqual({ readable: true, amountText: "₹180.00", currency: "INR", merchant: "Cafe", screenType: "other", confidence: 1 });
  });
});

describe("needsSecondOpinion", () => {
  const base = { readable: true, amountText: "₹180.00", currency: "INR", merchant: "", screenType: "sale" as const, confidence: 0.9 };
  const device = (r: Partial<typeof base>) => ({ reading: { ...base, ...r }, source: "on_device" as const, ms: 300 });

  it("trusts a clear, confident, matching on-device read", () => {
    expect(needsSecondOpinion(device({}), 18000)).toBeNull();
  });
  it("escalates unreadable, unparseable or low-confidence reads", () => {
    expect(needsSecondOpinion(device({ readable: false }), null)).toMatch(/clear/);
    expect(needsSecondOpinion(device({ amountText: "TAP" }), null)).toMatch(/clear/);
    expect(needsSecondOpinion(device({ confidence: 0.3 }), null)).toMatch(/confident/);
  });
  it("escalates a mismatch before raising the alarm", () => {
    expect(needsSecondOpinion(device({ amountText: "₹1,800.00" }), 18000)).toMatch(/match/);
  });
  it("never escalates a cloud read again", () => {
    expect(needsSecondOpinion({ ...device({ readable: false }), source: "in_cloud" }, null)).toBeNull();
  });
});
