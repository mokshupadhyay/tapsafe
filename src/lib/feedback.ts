/** Speech, tones and vibration. Everything works offline (speechSynthesis uses local voices when available). */

export function speak(text: string, enabled: boolean) {
  if (!enabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  u.rate = 1;
  const local = window.speechSynthesis.getVoices().find((v) => v.localService && v.lang.startsWith("en"));
  if (local) u.voice = local;
  window.speechSynthesis.speak(u);
}

let ctx: AudioContext | null = null;

/** Two rising notes = OK. Three low pulses = stop. Distinct by pattern, not just pitch. */
export function tone(kind: "ok" | "alert" | "info") {
  try {
    ctx ??= new AudioContext();
    const pattern: Array<[number, number]> =
      kind === "ok" ? [[660, 0.12], [880, 0.18]] : kind === "alert" ? [[220, 0.25], [220, 0.25], [220, 0.25]] : [[520, 0.1]];
    let t = ctx.currentTime;
    for (const [freq, dur] of pattern) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "alert" ? "square" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.08;
    }
  } catch {
    /* audio blocked; speech and the live region still carry the message */
  }
  if ("vibrate" in navigator) navigator.vibrate(kind === "alert" ? [300, 120, 300, 120, 300] : kind === "ok" ? [80] : []);
}
