/**
 * Synthetic terminal screens, drawn on a canvas. They let judges (and our tests) try TapSafe
 * without a real card terminal, and cover the cases that matter: a normal sale, an overcharge,
 * a refund screen, a tip prompt, and a glare-damaged photo that should trigger a second opinion.
 */
export interface Sample {
  id: string;
  label: string;
  expected: string;
  lines: string[];
  amount: string;
  glare?: boolean;
}

export const SAMPLES: Sample[] = [
  { id: "coffee", label: "Café, correct amount", expected: "180", lines: ["BLUE TOKAI COFFEE", "SALE"], amount: "₹180.00" },
  { id: "overcharge", label: "Café, overcharged", expected: "180", lines: ["BLUE TOKAI COFFEE", "SALE"], amount: "₹1,800.00" },
  { id: "pharmacy", label: "Pharmacy sale", expected: "642.50", lines: ["APOLLO PHARMACY", "SALE"], amount: "₹642.50" },
  { id: "refund", label: "Refund screen", expected: "", lines: ["CITY MART", "REFUND"], amount: "₹299.00" },
  { id: "tip", label: "Tip prompt", expected: "1200", lines: ["SPICE ROUTE", "ADD TIP?  10%  15%  NO TIP"], amount: "₹1,200.00" },
  { id: "glare", label: "Photo with glare", expected: "450", lines: ["METRO STORES", "SALE"], amount: "₹450.00", glare: true },
];

export function drawSample(s: Sample): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 720;
  c.height = 540;
  const g = c.getContext("2d")!;
  // Terminal body
  g.fillStyle = "#2b2f36";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#16181c";
  roundRect(g, 40, 30, 640, 330, 18);
  // LCD
  g.fillStyle = "#cfe3c4";
  roundRect(g, 70, 60, 580, 270, 8);
  g.fillStyle = "#1d2a1a";
  g.font = "600 30px 'Courier New', monospace";
  g.textAlign = "center";
  g.fillText(s.lines[0], 360, 115);
  g.font = "26px 'Courier New', monospace";
  g.fillText(s.lines[1], 360, 160);
  g.font = "700 64px 'Courier New', monospace";
  g.fillText(s.amount, 360, 250);
  g.font = "22px 'Courier New', monospace";
  g.fillText("INSERT / TAP CARD", 360, 300);
  // Keypad
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k === 3 ? ["#c0392b", "#d4ac0d", "#27ae60"][r] : "#3d434d";
      roundRect(g, 90 + k * 140, 385 + r * 50, 120, 38, 8);
    }
  if (s.glare) {
    const grad = g.createRadialGradient(400, 230, 10, 400, 230, 260);
    grad.addColorStop(0, "rgba(255,255,255,0.97)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}
