/**
 * When the terminal disagrees with the bill, the user may need to raise it later with the shop or their bank.
 * Only the extracted facts are sent to the cloud, never the photo.
 */
export interface DisputeFacts {
  merchant: string;
  when: string;
  expected: string;
  charged: string;
  screenType: string;
}

export function letterPrompt(f: DisputeFacts): string {
  return `Write a short, polite note (under 120 words) that a blind customer can show or send to a shop manager or their card issuer.
Facts, use only these and invent nothing:
- Shop: ${f.merchant || "not shown on the terminal"}
- Date and time: ${f.when}
- Amount on the bill / agreed: ${f.expected}
- Amount the card terminal asked for: ${f.charged}
- Terminal screen type: ${f.screenType}
Say that the customer is blind and used TapSafe to read the terminal, that the amounts differ, and ask for the
charge to be corrected or refunded if it went through. Plain text, no subject line, no placeholders in brackets.`;
}
