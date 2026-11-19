import { describe, expect, it } from "vitest";
import { checkBill, parseBill, type BillReading } from "./bill";
import { letterPrompt } from "./letter";

const bill = (lines: BillReading["lines"], totalText: string): BillReading => ({
  readable: true,
  merchant: "Spice Route",
  currency: "INR",
  lines,
  totalText,
});

describe("checkBill", () => {
  it("accepts a bill whose lines add up, and flags the service charge", () => {
    const r = checkBill(
      bill(
        [
          { label: "Paneer Tikka", kind: "item", amountText: "₹320.00" },
          { label: "Dal Makhani", kind: "item", amountText: "₹280.00" },
          { label: "Service Charge 10%", kind: "service_charge", amountText: "₹60.00" },
          { label: "CGST 2.5%", kind: "tax", amountText: "₹16.50" },
          { label: "SGST 2.5%", kind: "tax", amountText: "₹16.50" },
        ],
        "₹693.00",
      ),
    );
    expect(r).toMatchObject({ totalMinor: 69300, sumMinor: 69300, adds_up: true });
    expect(r.flags.some((f) => f.includes("Service charge"))).toBe(true);
  });

  it("subtracts discounts whether or not the model kept the minus sign", () => {
    const lines = [
      { label: "Burger", kind: "item" as const, amountText: "₹250" },
      { label: "Coupon", kind: "discount" as const, amountText: "₹50" },
    ];
    expect(checkBill(bill(lines, "₹200")).adds_up).toBe(true);
    expect(checkBill(bill([lines[0], { ...lines[1], amountText: "-₹50" }], "₹200")).adds_up).toBe(true);
  });

  it("tolerates a one-rupee round-off but catches a misread digit", () => {
    const lines = [{ label: "Medicine", kind: "item" as const, amountText: "₹642.50" }];
    expect(checkBill(bill(lines, "₹643.00")).adds_up).toBe(true);
    const wrong = checkBill(bill(lines, "₹6,425.00"));
    expect(wrong.adds_up).toBe(false);
    expect(wrong.flags[0]).toMatch(/don't add up/);
  });

  it("flags duplicate items and an already-included tip", () => {
    const r = checkBill(
      bill(
        [
          { label: "Cold Coffee", kind: "item", amountText: "₹180" },
          { label: "Cold Coffee", kind: "item", amountText: "₹180" },
          { label: "Tip", kind: "tip", amountText: "₹40" },
        ],
        "₹400",
      ),
    );
    expect(r.flags.join(" ")).toMatch(/appears 2 times/);
    expect(r.flags.join(" ")).toMatch(/tip of ₹40 is already on the bill/);
  });

  it("does not claim the bill adds up when a line is unreadable", () => {
    const r = checkBill(bill([{ label: "??", kind: "item", amountText: "" }], "₹100"));
    expect(r.adds_up).toBe(false);
  });
});

describe("parseBill", () => {
  it("normalises unknown line kinds and code fences", () => {
    const b = parseBill('```json\n{"readable":true,"merchant":"x","currency":"inr","lines":[{"label":"a","kind":"weird","amountText":"1"}],"totalText":"1"}\n```');
    expect(b.currency).toBe("INR");
    expect(b.lines[0].kind).toBe("other_fee");
  });
});

describe("letterPrompt", () => {
  it("contains only the facts, never image data", () => {
    const p = letterPrompt({ merchant: "Blue Tokai", when: "19 Nov, 7:42 pm", expected: "₹180.00", charged: "₹1,800.00", screenType: "sale" });
    expect(p).toContain("₹1,800.00");
    expect(p).not.toMatch(/base64|data:image/);
  });
});
