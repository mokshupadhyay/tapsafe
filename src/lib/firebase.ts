import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel, type GenerativeModel } from "firebase/ai";
import { RESPONSE_JSON_SCHEMA } from "./schema";
import { BILL_JSON_SCHEMA } from "./bill";

const env = import.meta.env;

/** True when a real Firebase project is configured. Without it, only the on-device path works. */
export const cloudConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || "not-configured",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || "not-configured",
  appId: env.VITE_FIREBASE_APP_ID || "not-configured",
});

// App Check is required by the hackathon rules. Debug tokens are allowed in development.
// In local development the debug provider stands in for reCAPTCHA: the SDK prints a debug token in the
// browser console once, and that token is registered under App Check > Manage debug tokens.
const appCheckDebug = env.DEV && env.VITE_APPCHECK_DEBUG === "true";
if (cloudConfigured && (env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || appCheckDebug)) {
  if (appCheckDebug) {
    // A fixed token from .env.local lets every local browser share one registered token.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || "debug-only"),
    isTokenAutoRefreshEnabled: true,
  });
}

const ai = getAI(app, { backend: new GoogleAIBackend() });

const CLOUD_MODEL = env.VITE_CLOUD_MODEL || "gemini-3.5-flash-lite";

const cloudParams = {
  model: CLOUD_MODEL,
  generationConfig: {
    responseMimeType: "application/json",
    responseJsonSchema: RESPONSE_JSON_SCHEMA,
    temperature: 0,
  },
};

/**
 * Every scan goes here first. Gemini Nano in Chrome reads the photo on the device;
 * if Nano isn't available, the SDK falls back to the cloud model and tells us via inferenceSource.
 */
export const deviceFirstModel: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: "image" }, { type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    },
    promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
  },
  inCloudParams: cloudParams,
});

/** Second opinion. Only used after the user agrees to send the photo off the device. */
export const cloudModel: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: cloudParams,
});

/**
 * The larger (paid-tier) cloud model, for jobs that don't fit Gemini Nano's single-turn, ~9k-token budget:
 * itemising a long printed bill, and drafting a dispute note. Configurable so the demo can run on the free tier.
 */
export const proModelName: string = env.VITE_CLOUD_PRO_MODEL || "gemini-3.5-flash";

const billParams = (model: string) => ({
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: {
    model,
    // Transcription, not reasoning: the app re-adds the lines itself, so keep thinking low for speed.
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: BILL_JSON_SCHEMA,
      temperature: 0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  },
});

export const billModel: GenerativeModel = getGenerativeModel(ai, billParams(proModelName), { timeout: 30_000 });

const letterParams = (model: string) => ({
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: {
    model,
    // A short note needs no reasoning; thinking tokens would otherwise eat the output budget and truncate it.
    generationConfig: { temperature: 0.3, maxOutputTokens: 600, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
  },
});

export const letterModel: GenerativeModel = getGenerativeModel(ai, letterParams(proModelName), { timeout: 30_000 });

/** If the larger model is overloaded or erroring, the same job falls back to the everyday cloud model. */
export const billFallbackModel: GenerativeModel = getGenerativeModel(ai, billParams(CLOUD_MODEL), { timeout: 30_000 });
export const letterFallbackModel: GenerativeModel = getGenerativeModel(ai, letterParams(CLOUD_MODEL), { timeout: 30_000 });
