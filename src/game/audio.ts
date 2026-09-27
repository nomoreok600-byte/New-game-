// Tiny WebAudio synth — juicy pops, no assets needed.

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(freq: number, dur: number, type: OscillatorType, gain: number, delay: number): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function sweep(f1: number, f2: number, dur: number, type: OscillatorType, gain: number): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
  g.gain.setValueAtTime(Math.max(gain, 0.0002), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function haptic(ms: number): void {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

export type Sfx =
  | { type: "place" }
  | { type: "merge"; pitch: number }
  | { type: "pop"; lines: number; combo: number }
  | { type: "achievement" }
  | { type: "gameover" }
  | { type: "click" };

export function playSfx(s: Sfx, enabled: boolean): void {
  if (!enabled) return;
  switch (s.type) {
    case "place":
      blip(190, 0.08, "sine", 0.12, 0);
      break;
    case "merge":
      blip(440 + s.pitch * 70, 0.14, "triangle", 0.18, 0);
      break;
    case "pop": {
      const n = Math.min(6, s.lines + Math.min(3, s.combo));
      for (let i = 0; i < n; i++) {
        blip(520 + i * 120 + s.combo * 30, 0.12, "square", 0.09, i * 0.055);
      }
      break;
    }
    case "achievement":
      blip(660, 0.14, "triangle", 0.16, 0);
      blip(880, 0.18, "triangle", 0.16, 0.1);
      blip(1320, 0.22, "triangle", 0.14, 0.2);
      break;
    case "gameover":
      sweep(420, 120, 0.6, "sawtooth", 0.12);
      break;
    case "click":
      blip(300, 0.05, "sine", 0.07, 0);
      break;
  }
}
