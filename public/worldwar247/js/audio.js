// World War 24/7 — Procedural audio (WebAudio, zero asset files).
// Small synth hits for weapons/kills/explosions plus a victory fanfare.

"use strict";

let ctx = null;
let enabled = true;
let master = null;

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone({ freq = 440, end = null, dur = 0.1, type = "square", vol = 0.5, delay = 0 }) {
  const c = ac();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.25, vol = 0.4, freq = 800, delay = 0 }) {
  const c = ac();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
}

export const audio = {
  setEnabled(v) { enabled = v; },
  get enabled() { return enabled; },
  unlock() { ac(); },
  hit(crit) { crit ? (noise({ dur: 0.2, vol: 0.5, freq: 1400 }), tone({ freq: 1300, end: 200, dur: 0.18, type: "sawtooth", vol: 0.5 })) : tone({ freq: 700 + Math.random() * 200, end: 300, dur: 0.06, type: "square", vol: 0.3 }); },
  kill() { tone({ freq: 180, end: 40, dur: 0.7, type: "sawtooth", vol: 0.7 }); noise({ dur: 0.6, vol: 0.6, freq: 500 }); },
  boom() { noise({ dur: 0.8, vol: 0.8, freq: 300 }); tone({ freq: 90, end: 30, dur: 0.6, type: "triangle", vol: 0.8 }); },
  pickup() { tone({ freq: 620, dur: 0.08, type: "square", vol: 0.35 }); tone({ freq: 930, dur: 0.1, type: "square", vol: 0.35, delay: 0.09 }); },
  deflect() { tone({ freq: 1500, end: 2400, dur: 0.09, type: "square", vol: 0.4 }); },
  shield() { tone({ freq: 300, end: 900, dur: 0.15, type: "sine", vol: 0.4 }); },
  matchStart() { tone({ freq: 392, dur: 0.12, vol: 0.4 }); tone({ freq: 523, dur: 0.12, vol: 0.4, delay: 0.13 }); tone({ freq: 659, dur: 0.2, vol: 0.45, delay: 0.26 }); },
  anthem() {
    // Short victory fanfare (C-E-G-C arpeggio + chord).
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.22, type: "square", vol: 0.4, delay: i * 0.18 }));
    [523, 659, 784, 1047].forEach((f) => tone({ freq: f, dur: 1.4, type: "triangle", vol: 0.22, delay: 0.75 }));
  },
};
