// World War 24/7 — AI Commentator (v2, broadcast-grade speech).
// Speaks play-by-play lines through the browser SpeechSynthesis engine
// (zero assets, works on any static host) and mirrors every line to the
// broadcast commentary bar.
//
// Voice-quality work in v2:
//   • Ranks every installed voice and always picks the highest-quality one
//     (Microsoft "Natural (Online)" neural voices, Google voices, Apple
//     Premium/Siri voices first; "Compact"/eSpeak robot voices are avoided).
//   • Calm, natural prosody (rate ≈1.0, flat pitch, full volume) instead of
//     the sped-up chipmunk delivery that hurt clarity in v1.
//   • Clean queue control: urgent lines interrupt instantly, non-urgent lines
//     never pile up on top of each other, identical back-to-back lines are
//     deduped — no overlapping garble.
//   • Long lines are spoken as sentence-sized chunks for smoother delivery.
//   • Handles the Chrome voice-list race (voices load asynchronously; we
//     re-pick and flush pending lines when they arrive) and keeps utterance
//     references alive so Chrome's GC cannot cut speech short.

"use strict";

const LINES = {
  matchStart: [
    "Ladies and gentlemen, welcome to the {BIOME}! {A} versus {B} — only one nation walks out!",
    "{A} against {B}, live from the {BIOME}! The crowd is on their feet!",
    "This is it! {A} and {B} collide in the {BIOME} — may the best nation win!",
  ],
  rivalry: [
    "Oh, the history between these two! {A} and {B} meet again — the rivalry is real!",
    "A bitter rivalry reignites! {A} versus {B}, you can cut the tension with a knife!",
  ],
  firstBlood: [
    "First blood drawn by {W}!",
    "There it is — {W} opens the scoring!",
    "{W} strikes first, and the arena erupts!",
  ],
  bigHit: [
    "What a shot from {W}!",
    "Devastating hit by {W}!",
    "{W} lands a monster blow!",
    "Oh! That one will leave a mark — {W} means business!",
  ],
  pickup: [
    "{W} grabs the {ITEM} — things just got interesting!",
    "The airdrop delivers! {W} now wields the {ITEM}!",
    "Fresh hardware! {W} picks up the {ITEM}!",
  ],
  turret: [
    "An auto-turret is online! Nobody is safe near it!",
    "Defense systems activated — that turret is hunting!",
  ],
  lowHp: [
    "{W} is in serious trouble — health critical!",
    "{W} is hanging by a thread!",
    "This could be over any second — {W} is barely standing!",
  ],
  kill: [
    "{W} eliminates {L}! What a finish!",
    "It's over! {W} takes down {L}!",
    "{L} is eliminated! {W} advances!",
    "And there's the knockout! {W} sends {L} home!",
  ],
  timeLimit: [
    "The clock expires — {W} survives on health advantage!",
    "A war of attrition! {W} outlasts {L} by a whisker!",
  ],
  napalm: [
    "Napalm on the field! The arena floor is ablaze!",
    "Fire rains down — nobody wanted to be caught in that!",
  ],
  bridge: [
    "The bridge collapses! The whole landscape just changed!",
    "Terrain destroyed! Nowhere to run now!",
  ],
  champion: [
    "Ladies and gentlemen, your new WORLD CHAMPION — {A}! What a tournament!",
    "{A} conquers the world! History is made tonight!",
    "Absolute scenes! {A} is crowned WORLD CHAMPION!",
  ],
};

function pick(arr, rng) {
  return arr[Math.floor((rng ? rng() : Math.random()) * arr.length)];
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// ————— Voice quality engine —————

// Low-quality placeholder voices that ship on some systems.
const BAD_VOICE = /(compact|espeak|eSpeak|robosoft|flite|pico|speech server|novelty|whisper|bells|bubbles|zarvox|albert|trinoids)/i;
// Words that mark premium / neural renditions.
const GOOD_WORDS = /(natural|neural|premium|enhanced|siri|journey)/i;
// Specific well-known high-quality voice names (Microsoft neural, Google, Apple).
const KNOWN_GOOD = /(aria|guy|jenny|emma|brian|ava|andrew|serena|ryan|sonia|libby|samantha|daniel|alex|karen|moira|tessa|rishi|google (us|uk) english)/i;

// Higher score = better broadcast voice. Non-English voices are unusable here.
function voiceScore(v) {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  if (!lang.startsWith("en")) return -1000;
  let s = 0;
  if (/^en-(us|gb)/.test(lang)) s += 40;
  else if (lang === "en" || lang.startsWith("en-")) s += 16;
  else return -1000;
  if (BAD_VOICE.test(v.name)) s -= 120;
  if (KNOWN_GOOD.test(v.name)) s += 70;
  if (GOOD_WORDS.test(v.name)) s += 34;
  if (/online/i.test(v.name)) s += 26; // Edge/Windows neural online voices
  if (v.localService) s += 4; // slight nudge so playback starts instantly
  if (v.default) s += 2;
  return s;
}

// Prepare a raw line for the speech engine: em-dashes become commas, fillers
// are removed, terminal punctuation is guaranteed — this alone noticeably
// improves prosody on most engines.
function cleanForSpeech(text) {
  return text
    .replace(/[—–]/g, ", ")
    .replace(/!{2,}/g, "!")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/([^.!?])$/, "$1.");
}

// Split a line into sentence-sized utterances (smoother on every engine).
function chunkLine(text) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  return parts.map((p) => p.trim()).filter(Boolean).slice(0, 4);
}

export const commentator = {
  enabled: false,
  lastLine: "",
  voices: [],
  lastSpoke: 0,

  // internal
  _voice: null,
  _keep: [], // utterance refs (Chrome GC would otherwise cut speech off)
  _warm: false,
  _pendingSpeak: null, // { chunks, urgent } waiting for the voice list
  _spokeText: "", // dedupe of consecutive identical spoken lines
  _spokeAt: 0,
  _poll: 0,

  init() {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const grab = () => {
        const list = synth.getVoices ? synth.getVoices() : [];
        if (list && list.length) this.voices = list;
        this._rebest();
        return list.length > 0;
      };
      // Chrome populates the voice list asynchronously: hook the event AND
      // poll briefly so the first spoken line already uses the best voice.
      grab();
      if (!this.voices.length) {
        synth.onvoiceschanged = () => { grab(); this._flushPending(); };
        clearInterval(this._poll);
        let tries = 0;
        this._poll = setInterval(() => {
          tries += 1;
          if (grab() || tries > 20) clearInterval(this._poll);
        }, 250);
      }
      this._warmup();
    } catch { /* no speech engine — bar text still shows */ }
  },

  _rebest() {
    let best = null, bestScore = -1000;
    for (const v of this.voices) {
      const s = voiceScore(v);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    this._voice = best;
  },

  bestVoice() {
    if (!this._voice) this._rebest();
    return this._voice;
  },

  // One silent utterance primes several engines (iOS/Safari especially) so
  // the first real line doesn't stutter or get clipped.
  _warmup() {
    if (this._warm || !("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      const v = this.bestVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
      this._warm = true;
    } catch { /* ignore */ }
  },

  // Speak chunks now. urgent=true interrupts whatever is mid-line; a
  // non-urgent line is skipped entirely if the mic is already busy — the
  // play-by-play stays clean instead of overlapping.
  _speak(chunks, urgent) {
    if (!this.enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (urgent) {
      synth.cancel();
    } else if (synth.speaking || synth.pending) {
      return;
    }
    // If voices haven't loaded yet (Chrome race), park the line and flush it
    // the moment the list arrives — this is what keeps line #1 crisp too.
    if (!this.bestVoice() && this.voices.length === 0) {
      this._pendingSpeak = { chunks, urgent };
      this.init();
      return;
    }
    const v = this.bestVoice();
    for (const chunk of chunks) {
      try {
        const u = new SpeechSynthesisUtterance(chunk);
        if (v) u.voice = v;
        u.lang = (v && v.lang) || "en-US";
        u.rate = urgent ? 1.06 : 0.97;
        u.pitch = 1.0;
        u.volume = 1.0;
        this._keep.push(u);
        if (this._keep.length > 16) this._keep.splice(0, this._keep.length - 16);
        synth.speak(u);
      } catch { /* engine hiccup — bar text still shows */ }
    }
  },

  _flushPending() {
    if (!this._pendingSpeak) return;
    const p = this._pendingSpeak;
    this._pendingSpeak = null;
    if (this.enabled) this._speak(p.chunks, p.urgent);
  },

  // Speak a line; update the commentary bar. Throttled per urgency.
  say(category, vars = {}, opts = {}) {
    const now = performance.now();
    const minGap = opts.urgent ? 1300 : 6000;
    if (now - this.lastSpoke < minGap) return null;
    this.lastSpoke = now;

    const tpl = pick(LINES[category] || []);
    if (!tpl) return null;
    const line = fill(tpl, vars);
    this.lastLine = line;

    const bar = typeof document !== "undefined" ? document.getElementById("commText") : null;
    if (bar) {
      bar.textContent = line;
      bar.style.animation = "none";
      void bar.offsetWidth; // restart CSS animation
      bar.style.animation = "commIn 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) both";
    }

    if (this.enabled) {
      // Skip the exact same sentence if it just aired — a clean broadcast
      // never repeats itself back to back.
      const deduped = line === this._spokeText && now - this._spokeAt < 10000;
      if (!deduped) {
        const clean = cleanForSpeech(line);
        this._spokeText = line;
        this._spokeAt = now;
        this._speak(chunkLine(clean), !!opts.urgent);
      }
    }
    return line;
  },

  stop() {
    try {
      this._pendingSpeak = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch { /* noop */ }
  },
};
