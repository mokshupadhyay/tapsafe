import { useCallback, useEffect, useRef, useState } from "react";
import { compare, formatMinor, parseAmount, spokenAmount } from "./lib/amount";
import { speak, tone } from "./lib/feedback";
import { captureFrom, fileToImage, type CapturedImage } from "./lib/image";
import {
  downloadNano,
  draftLetter,
  nanoStatus,
  needsSecondOpinion,
  readBill,
  readInCloud,
  readOnDevice,
  type BillResult,
  type ReadResult,
} from "./lib/reader";
import { checkBill, type BillCheck } from "./lib/bill";
import { drawSample, SAMPLES } from "./lib/samples";
import { cloudConfigured, proModelName } from "./lib/firebase";

type Phase = "idle" | "reading_device" | "awaiting_consent" | "reading_cloud" | "done" | "error";

interface Outcome {
  tone: "ok" | "alert" | "info";
  headline: string;
  detail: string;
  spoken: string;
  /** The terminal disagreed with the expected amount, so a dispute note makes sense. */
  canDispute?: boolean;
}

interface HistoryItem {
  at: string;
  text: string;
  source: ReadResult["source"];
  ms: number;
  tone: Outcome["tone"];
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [expected, setExpected] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [device, setDevice] = useState<ReadResult | null>(null);
  const [cloud, setCloud] = useState<ReadResult | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const [voice, setVoice] = useState(true);
  const [alwaysCloud, setAlwaysCloud] = useState(false);
  const [nano, setNano] = useState<string>("checking");
  const [progress, setProgress] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [bill, setBill] = useState<(BillResult & { check: BillCheck }) | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState("");
  const [letter, setLetter] = useState("");
  const [letterBusy, setLetterBusy] = useState(false);

  useEffect(() => {
    nanoStatus().then(setNano);
  }, []);

  const expectedMinor = parseAmount(expected)?.minor ?? null;

  // The expected amount a scan was started with. Samples set it and scan in the same click, so state would be stale.
  const scanExpected = useRef<number | null>(null);

  const finish = useCallback(
    (final: ReadResult, other: ReadResult | null) => {
      const o = describe(final, other, scanExpected.current);
      setOutcome(o);
      setPhase("done");
      tone(o.tone);
      speak(o.spoken, voice);
      setHistory((h) =>
        [{ at: new Date().toLocaleTimeString(), text: o.headline, source: final.source, ms: final.ms, tone: o.tone }, ...h].slice(0, 8),
      );
    },
    [voice],
  );

  const askCloud = useCallback(
    async (img: CapturedImage, deviceResult: ReadResult) => {
      setPhase("reading_cloud");
      speak("Checking with the cloud.", voice);
      try {
        const c = await readInCloud(img);
        setCloud(c);
        finish(c, deviceResult);
      } catch (e) {
        // Cloud failed (offline, quota, not configured): fall back to the on-device answer, clearly labelled.
        setError(`Cloud check didn't work, so this is the on-device read. ${(e as Error).message}`);
        finish(deviceResult, null);
      }
    },
    [finish, voice],
  );

  const scan = useCallback(
    async (img: CapturedImage, expectedOverride?: number | null) => {
      const exp = expectedOverride !== undefined ? expectedOverride : expectedMinor;
      scanExpected.current = exp;
      setImage(img);
      setDevice(null);
      setCloud(null);
      setOutcome(null);
      setError("");
      setLetter("");
      setPhase("reading_device");
      tone("info");
      try {
        const d = await readOnDevice(img);
        setDevice(d);
        const why = needsSecondOpinion(d, exp);
        if (!why) return finish(d, null);
        setReason(why);
        if (alwaysCloud) return askCloud(img, d);
        setPhase("awaiting_consent");
        speak(`${why} Send the photo to the cloud for a second opinion? Press yes or no.`, voice);
      } catch (e) {
        setPhase("error");
        setError((e as Error).message);
        tone("alert");
        speak(`Don't tap yet. ${(e as Error).message}`, voice);
      }
    },
    [alwaysCloud, askCloud, expectedMinor, finish, voice],
  );

  async function scanBill(file: File) {
    setBillBusy(true);
    setBillError("");
    setBill(null);
    speak("Reading the bill in the cloud.", voice);
    try {
      const r = await readBill(captureFrom(await fileToImage(file)));
      const check = checkBill(r.bill);
      setBill({ ...r, check });
      const currency = r.bill.currency || "INR";
      if (check.totalMinor !== null && r.bill.readable && check.adds_up) {
        setExpected((check.totalMinor / 100).toFixed(2));
        tone(check.flags.length ? "info" : "ok");
        speak(
          `The bill total is ${spokenAmount(check.totalMinor, currency)}, and the lines add up.` +
            (check.flags.length ? ` Note: ${check.flags.join(" ")}` : "") +
            " I've set that as the amount you expect. Now point at the terminal.",
          voice,
        );
      } else {
        tone("alert");
        speak(
          `I couldn't confirm the bill total. ${check.flags[0] ?? "Some amounts weren't clear."} Enter the amount yourself or ask for the bill to be read out.`,
          voice,
        );
      }
    } catch (e) {
      setBillError((e as Error).message);
      tone("alert");
      speak((e as Error).message, voice);
    } finally {
      setBillBusy(false);
    }
  }

  async function writeLetter() {
    const final = cloud ?? device;
    const exp = scanExpected.current;
    if (!final || exp === null) return;
    const amt = parseAmount(final.reading.amountText);
    const currency = final.reading.currency || amt?.currency || "INR";
    setLetterBusy(true);
    try {
      const text = await draftLetter({
        merchant: final.reading.merchant || bill?.bill.merchant || "",
        when: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        expected: formatMinor(exp, currency),
        charged: amt ? formatMinor(amt.minor, currency) : final.reading.amountText,
        screenType: final.reading.screenType,
      });
      setLetter(text);
      speak("The note is ready. You can copy it or have it read out.", voice);
    } catch (e) {
      setLetter("");
      setError((e as Error).message);
    } finally {
      setLetterBusy(false);
    }
  }

  async function toggleCamera() {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 1280 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError("Camera permission was denied. You can still upload a photo or try a sample screen.");
    }
  }

  const busy = phase === "reading_device" || phase === "reading_cloud";
  const shown = cloud ?? device;

  return (
    <main className="app">
      <header>
        <h1>
          TapSafe <span className="tag">hear the amount before you tap</span>
        </h1>
        <p className="status" aria-live="polite">
          <StatusDot ok={nano === "available"} /> On-device model: <strong>{nanoLabel(nano)}</strong>
          {nano === "downloadable" && (
            <button
              className="link"
              onClick={async () => {
                setProgress(0);
                await downloadNano(setProgress);
                setProgress(null);
                setNano(await nanoStatus());
              }}
            >
              Download Gemini Nano
            </button>
          )}
          {progress !== null && <span> {progress}%</span>}
          <span className="sep">·</span>
          <StatusDot ok={cloudConfigured} /> Cloud: <strong>{cloudConfigured ? "ready" : "not configured"}</strong>
        </p>
      </header>

      <section className="panel" aria-labelledby="expect-h">
        <h2 id="expect-h">1. What do you expect to pay?</h2>
        <label className="field">
          <span>Amount (optional)</span>
          <input
            inputMode="decimal"
            placeholder="e.g. 180"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            aria-describedby="expect-help"
          />
        </label>
        <p id="expect-help" className="hint">
          If you enter it, TapSafe tells you straight away whether the terminal matches.
        </p>
        <div className="row">
          <label className={`button ${!cloudConfigured || billBusy ? "disabled" : ""}`}>
            {billBusy ? "Reading the bill…" : "Or photograph the bill"}
            <input
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              hidden
              disabled={!cloudConfigured || billBusy}
              aria-describedby="bill-help"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) scanBill(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p id="bill-help" className="hint">
          Long bills are read by a larger cloud model ({proModelName}), so the bill photo leaves your device. TapSafe re-adds every line
          itself before trusting the total.
        </p>
        {billError && <p className="hint alert-text">{billError}</p>}
        {bill && (
          <div className={`bill ${bill.check.adds_up ? "ok" : "alert"}`} aria-live="polite">
            <p className="headline-sm">
              {bill.bill.merchant || "Bill"}:{" "}
              {bill.check.totalMinor !== null ? formatMinor(bill.check.totalMinor, bill.bill.currency || "INR") : "total unclear"}{" "}
              {bill.check.adds_up ? "· lines add up" : "· doesn't add up"}
            </p>
            <ul>
              {bill.bill.lines.map((l, i) => (
                <li key={i} className={l.kind !== "item" ? "fee" : ""}>
                  <span>{l.label}</span> <span>{l.amountText}</span>
                </li>
              ))}
            </ul>
            {bill.check.flags.length > 0 && (
              <ul className="flags">
                {bill.check.flags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
            <p className="route">
              <span className="badge in_cloud">Cloud · {proModelName}</span> {bill.ms} ms
            </p>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="scan-h">
        <h2 id="scan-h">2. Point at the terminal screen</h2>
        <div className="viewer">
          <video ref={videoRef} playsInline muted aria-label="Camera preview" hidden={!cameraOn} />
          {!cameraOn && image && <img src={image.dataUrl} alt="Last scanned terminal photo" />}
          {!cameraOn && !image && <p className="placeholder">Camera is off</p>}
        </div>
        <div className="row">
          <button onClick={toggleCamera}>{cameraOn ? "Stop camera" : "Start camera"}</button>
          <button
            className="primary"
            disabled={!cameraOn || busy}
            onClick={() => videoRef.current && scan(captureFrom(videoRef.current))}
          >
            Read amount
          </button>
          <label className="button">
            Upload photo
            <input
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) scan(captureFrom(await fileToImage(f)));
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <details className="samples">
          <summary>No terminal nearby? Try a sample screen</summary>
          <div className="row wrap">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                data-sample={s.id}
                disabled={busy}
                onClick={() => {
                  setExpected(s.expected);
                  scan(captureFrom(drawSample(s)), parseAmount(s.expected)?.minor ?? null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </details>
      </section>

      <section className="panel" aria-labelledby="result-h">
        <h2 id="result-h">3. Result</h2>
        <div role="status" aria-live="assertive" className={`result ${phase === "error" ? "alert" : outcome?.tone ?? ""}`}>
          {phase === "idle" && <p>Nothing scanned yet.</p>}
          {phase === "reading_device" && <p>Reading on your device…</p>}
          {phase === "reading_cloud" && <p>Getting a second opinion from the cloud…</p>}
          {phase === "error" && <p>{error}</p>}
          {phase === "awaiting_consent" && (
            <div className="consent">
              <p>
                <strong>{reason}</strong> Send this photo to the cloud for a second opinion? The photo leaves your device; nothing else does.
              </p>
              <div className="row">
                <button autoFocus className="primary" onClick={() => image && device && askCloud(image, device)}>
                  Yes, check in the cloud
                </button>
                <button onClick={() => device && finish(device, null)}>No, use the on-device read</button>
              </div>
            </div>
          )}
          {phase === "done" && outcome && (
            <>
              <p className="headline">{outcome.headline}</p>
              <p>{outcome.detail}</p>
            </>
          )}
        </div>
        {error && phase === "done" && <p className="hint">{error}</p>}
        {shown && (
          <p className="route" data-testid="route">
            <span className={`badge ${shown.source}`}>{shown.source === "on_device" ? "On-device · Gemini Nano" : "Cloud · Gemini"}</span>
            {" "}
            {shown.ms} ms{cloud && device && ` (device read first in ${device.ms} ms)`}
          </p>
        )}
        {phase === "done" && outcome?.canDispute && (
          <div className="row">
            <button disabled={!cloudConfigured || letterBusy} onClick={writeLetter}>
              {letterBusy ? "Writing…" : "Write a note for the shop or bank"}
            </button>
          </div>
        )}
        {letter && (
          <div className="letter">
            <p className="hint">Only the amounts, shop name and time were sent to the cloud, not the photo.</p>
            <textarea readOnly value={letter} rows={7} aria-label="Dispute note" />
            <div className="row">
              <button onClick={() => navigator.clipboard?.writeText(letter)}>Copy note</button>
              <button onClick={() => speak(letter, true)}>Read it out</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="settings-h">
        <h2 id="settings-h">Settings</h2>
        <label className="check">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Speak results aloud
        </label>
        <label className="check">
          <input type="checkbox" checked={alwaysCloud} onChange={(e) => setAlwaysCloud(e.target.checked)} /> Don't ask: send unclear
          photos to the cloud automatically
        </label>
      </section>

      {history.length > 0 && (
        <section className="panel" aria-labelledby="hist-h">
          <h2 id="hist-h">Recent checks</h2>
          <ul className="history">
            {history.map((h, i) => (
              <li key={i} className={h.tone}>
                <span>{h.at}</span> {h.text} <span className={`badge ${h.source}`}>{h.source === "on_device" ? "device" : "cloud"}</span>{" "}
                {h.ms} ms
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function describe(final: ReadResult, other: ReadResult | null, expectedMinor: number | null): Outcome {
  const r = final.reading;
  const amt = parseAmount(r.amountText);
  const currency = r.currency || amt?.currency || "INR";
  const where = r.merchant ? ` at ${titleCase(r.merchant)}` : "";
  const disagreement =
    other && parseAmount(other.reading.amountText)?.minor !== amt?.minor
      ? ` The on-device read said ${other.reading.amountText || "nothing readable"}; the cloud read is used.`
      : "";

  if (!r.readable || !amt) {
    return {
      tone: "alert",
      headline: "Couldn't read the amount",
      detail: "Don't tap yet. Tilt the phone away from lights and hold it about 20 cm from the screen, then try again." + disagreement,
      spoken: "I couldn't read the amount. Don't tap yet. Tilt the phone away from lights and try again.",
    };
  }
  const said = spokenAmount(amt.minor, currency);
  const shown = formatMinor(amt.minor, currency);

  if (r.screenType === "refund") {
    return { tone: "info", headline: `Refund screen: ${shown}`, detail: `This is a refund${where}, not a payment.` + disagreement, spoken: `This is a refund screen for ${said}${where}.` };
  }
  if (r.screenType === "tip_prompt") {
    return {
      tone: "info",
      headline: `Tip prompt on ${shown}`,
      detail: `The terminal is asking whether to add a tip to ${shown}${where}.` + disagreement,
      spoken: `The terminal is asking for a tip on ${said}${where}. Choose no tip or tell the cashier.`,
    };
  }

  const verdict = compare(expectedMinor, amt.minor);
  if (verdict === "match") {
    return { tone: "ok", headline: `Matches: ${shown}`, detail: `The terminal shows ${shown}${where}. Safe to tap.` + disagreement, spoken: `Matches. ${said}${where}. Safe to tap.` };
  }
  if (verdict === "mismatch") {
    const exp = formatMinor(expectedMinor!, currency);
    return {
      tone: "alert",
      headline: `Stop: shows ${shown}, you expected ${exp}`,
      detail: `Don't tap. The terminal shows ${shown}${where}, not ${exp}. Ask the cashier to correct it.` + disagreement,
      spoken: `Stop. Don't tap. The terminal shows ${said}. You expected ${spokenAmount(expectedMinor!, currency)}.`,
      canDispute: true,
    };
  }
  return { tone: "info", headline: `Terminal shows ${shown}`, detail: `Amount${where}: ${shown}.` + disagreement, spoken: `The terminal shows ${said}${where}.` };
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function nanoLabel(s: string) {
  return (
    { available: "ready", downloadable: "not downloaded", downloading: "downloading", unavailable: "not available in this browser", checking: "checking…" } as Record<string, string>
  )[s];
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? "on" : "off"}`} aria-hidden="true" />;
}
