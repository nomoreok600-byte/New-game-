// World War 24/7 — AI Commentator.
// Speaks play-by-play lines through the browser SpeechSynthesis engine
// (zero assets, works on any static host) and mirrors every line to the
// broadcast commentary bar. Auto-throttles so big moments always get a voice.

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

export const commentator = {
  enabled: false,
  lastLine: "",
  lastSpoke: 0,

  init() {
    try {
      this.voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
          this.voices = window.speechSynthesis.getVoices();
        };
      }
    } catch { /* no speech engine */ }
  },

  bestVoice() {
    if (!this.voices || this.voices.length === 0) return null;
    // Prefer an energetic English voice for that sports-broadcast feel.
    const en = this.voices.filter((v) => v.lang && v.lang.startsWith("en"));
    const preferred = en.find((v) => /en-(US|GB)/i.test(v.lang) && /(Google|Natural|Daniel|Samantha|Alex)/i.test(v.name));
    return preferred || en[0] || this.voices[0];
  },

  // Speak a line; update the commentary bar. Throttled per category.
  say(category, vars = {}, opts = {}) {
    const now = performance.now();
    const minGap = opts.urgent ? 1500 : 6000;
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

    if (this.enabled && "speechSynthesis" in window) {
      try {
        const u = new SpeechSynthesisUtterance(line);
        const v = this.bestVoice();
        if (v) u.voice = v;
        u.rate = opts.urgent ? 1.12 : 1.0;
        u.pitch = 1.05;
        u.volume = 0.95;
        window.speechSynthesis.speak(u);
      } catch { /* engine hiccup — bar text still shows */ }
    }
    return line;
  },

  stop() {
    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* noop */ }
  },
};
