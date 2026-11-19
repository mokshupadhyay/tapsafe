import { InferenceSource, type GenerativeModel } from "firebase/ai";
import {
  billFallbackModel,
  billModel,
  cloudConfigured,
  cloudModel,
  deviceFirstModel,
  letterFallbackModel,
  letterModel,
} from "./firebase";
import { BILL_PROMPT, parseBill, type BillReading } from "./bill";
import { letterPrompt, type DisputeFacts } from "./letter";
import { parseReading, READ_PROMPT, type TerminalReading } from "./schema";
import { parseAmount } from "./amount";

export type Source = "on_device" | "in_cloud";

export interface ReadResult {
  reading: TerminalReading;
  source: Source;
  ms: number;
}

async function run(model: GenerativeModel, image: { base64: string; mimeType: string }): Promise<ReadResult> {
  const start = performance.now();
  const result = await model.generateContent([
    READ_PROMPT,
    { type: "inlineData", inlineData: { data: image.base64, mimeType: image.mimeType } },
  ]);
  const ms = Math.round(performance.now() - start);
  const source: Source = result.response.inferenceSource === InferenceSource.ON_DEVICE ? "on_device" : "in_cloud";
  return { reading: parseReading(result.response.text()), source, ms };
}

/** Step 1, every scan: Gemini Nano on the device (the SDK falls back to cloud only if Nano isn't available). */
export async function readOnDevice(image: { base64: string; mimeType: string }): Promise<ReadResult> {
  if (!cloudConfigured && (await nanoStatus()) !== "available") {
    throw new Error(
      "This browser can't run the on-device model, and the cloud isn't set up in this build. Open TapSafe in Google Chrome on a computer.",
    );
  }
  return run(deviceFirstModel, image).catch((e) => Promise.reject(friendly(e, "reading the terminal")));
}

/** Step 2, only with the user's consent: a bigger cloud model reads the same photo. */
export async function readInCloud(image: { base64: string; mimeType: string }): Promise<ReadResult> {
  if (!cloudConfigured) throw new Error("The cloud isn't set up in this build.");
  return run(cloudModel, image).catch((e) => Promise.reject(friendly(e, "reading the terminal")));
}

export interface BillResult {
  bill: BillReading;
  ms: number;
}

/** Bill photo -> itemised lines, via the larger cloud model (only after the user agrees). */
export async function readBill(image: { base64: string; mimeType: string }): Promise<BillResult> {
  if (!cloudConfigured) throw new Error("Reading a bill needs the cloud, which isn't set up in this build.");
  const start = performance.now();
  try {
    const parts = [
      BILL_PROMPT,
      { type: "inlineData" as const, inlineData: { data: image.base64, mimeType: image.mimeType } },
    ];
    const result = await withFallback(
      () => billModel.generateContent(parts),
      () => billFallbackModel.generateContent(parts),
    );
    return { bill: parseBill(result.response.text()), ms: Math.round(performance.now() - start) };
  } catch (e) {
    throw friendly(e, "reading the bill");
  }
}

/** Dispute note from extracted facts only; no image is sent. */
export async function draftLetter(facts: DisputeFacts): Promise<string> {
  if (!cloudConfigured) throw new Error("Writing the note needs the cloud, which isn't set up in this build.");
  try {
    const prompt = letterPrompt(facts);
    const result = await withFallback(
      () => letterModel.generateContent(prompt),
      () => letterFallbackModel.generateContent(prompt),
    );
    return result.response.text().trim();
  } catch (e) {
    throw friendly(e, "writing the note");
  }
}

/**
 * The larger model sometimes answers 500/503 (overloaded or internal error). Retry it once, then hand the same
 * job to the everyday cloud model, so the user still gets an answer.
 */
async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (e) {
    if (!isServerSide(e)) throw e;
  }
  await new Promise((r) => setTimeout(r, 1000));
  try {
    return await primary();
  } catch (e) {
    if (!isServerSide(e)) throw e;
    return fallback();
  }
}

function isServerSide(e: unknown): boolean {
  return /\b50[0-4]\b|UNAVAILABLE|INTERNAL|overloaded|timeout|timed out/i.test(e instanceof Error ? e.message : String(e));
}

/** Plain-language errors: the user may be listening, not reading a stack trace. */
function friendly(e: unknown, task: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (!navigator.onLine) return new Error("You're offline and this needed the cloud. Try again when you're connected.");
  if (/API_KEY_INVALID|API key/i.test(msg)) return new Error("The cloud isn't set up correctly in this build.");
  if (/app.?check/i.test(msg)) return new Error("The cloud refused the request (App Check). Reload the page and try again.");
  if (/timeout|timed out|aborted/i.test(msg)) return new Error("The cloud took too long. Try again, or enter the amount yourself.");
  if (isServerSide(e) || /quota|429|RESOURCE_EXHAUSTED/i.test(msg)) return new Error("The cloud is busy right now. Try again in a minute.");
  if (/JSON/i.test(msg)) return new Error("The model's answer was garbled. Try scanning again.");
  return new Error(`Something went wrong ${task}. Try again.`);
}

/**
 * When to offer a cloud second opinion. We don't trust the small model's self-reported confidence alone:
 * an amount that doesn't parse, or one that disagrees with what the user expected, also escalates,
 * because a false "mismatch" alarm and a missed overcharge are both costly.
 */
export function needsSecondOpinion(r: ReadResult, expectedMinor: number | null): string | null {
  if (r.source === "in_cloud") return null;
  const amount = parseAmount(r.reading.amountText);
  if (!r.reading.readable || !amount) return "The amount wasn't clear on the device.";
  if (r.reading.confidence < 0.6) return "The on-device read wasn't confident.";
  if (expectedMinor !== null && amount.minor !== expectedMinor) return "The amount doesn't match what you expected.";
  return null;
}

/** Nano availability for the status line (Chrome's Prompt API). */
export async function nanoStatus(): Promise<"available" | "downloadable" | "downloading" | "unavailable"> {
  const LM = (globalThis as { LanguageModel?: { availability: (o?: unknown) => Promise<string> } }).LanguageModel;
  if (!LM) return "unavailable";
  try {
    const a = await LM.availability({ expectedInputs: [{ type: "image" }, { type: "text", languages: ["en"] }] });
    return a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function downloadNano(onProgress: (pct: number) => void): Promise<void> {
  await deviceFirstModel.initializeDeviceModel((p) => onProgress(Math.round(p * 100)));
}
