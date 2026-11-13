// Haptics and sounds for picks. Both are best effort: vibration is missing on
// iOS and desktop, and audio may be blocked until the first tap.

export type Cue = "right" | "wrong" | "done";

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine") {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function play(cue: Cue, opts: { haptics: boolean; sound: boolean }): void {
  try {
    if (opts.haptics && "vibrate" in navigator) {
      navigator.vibrate(cue === "wrong" ? [60, 40, 90] : cue === "done" ? [20, 30, 20] : 12);
    }
    if (opts.sound) {
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
      if (cue === "right") tone(880, 0, 0.12);
      else if (cue === "wrong") tone(160, 0, 0.3, "square");
      else [660, 880, 1100].forEach((f, i) => tone(f, i * 0.09, 0.14));
    }
  } catch {
    /* feedback is optional */
  }
}
