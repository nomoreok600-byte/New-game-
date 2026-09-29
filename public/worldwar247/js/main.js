// World War 24/7 — Entry point.
// Wires the sim, renderer, show director and audio together, installs the
// bridge hooks show.js uses, and arms sound + AI voice on the first user
// gesture (browser autoplay policy blocks audio until the viewer interacts).

"use strict";

import { WW_COUNTRIES } from "./countries.js";
import { freshBroadcast, load, save, exportJSON, importJSON } from "./store.js";
import { createMatch, updateMatch } from "./sim.js";
import { createRenderer } from "./render.js";
import { initBroadcast } from "./show.js";
import { audio } from "./audio.js";
import { commentator } from "./commentary.js";

// Bridge hooks so show.js stays decoupled from sim.js internals.
window.__wwCreateMatch = createMatch;
window.__wwUpdateMatch = updateMatch;

const canvas = document.getElementById("arena");

// Guard against stale/corrupt localStorage saves: normalize any save we
// load so the show director can never crash on a missing field (this is the
// real cause of "stuck on the pre-match countdown" after an app update),
// and fall back to a clean Tournament #1 if the save is beyond repair.
function sanitizeState(state) {
  const fresh = () => freshBroadcast();
  if (!state || typeof state !== "object") return { state: fresh(), reset: true };
  let reset = false;
  if (!Array.isArray(state.bracket) || state.bracket.length === 0 ||
      !Array.isArray(state.active) || state.active.length === 0) {
    return { state: fresh(), reset: true };
  }
  // Normalize: guarantee every field the director/sim touch exists.
  const ensure = (val, make) => {
    const ok = Array.isArray(val) ? val.length >= 0 : (val !== null && val !== undefined);
    if (!ok) { reset = true; return make(); }
    return val;
  };
  state.active = ensure(state.active, () => fresh().active);
  state.benched = ensure(state.benched, () => fresh().benched);
  state.bracket = ensure(state.bracket, () => fresh().bracket);
  state.stats = ensure(state.stats, () => ({}));
  state.history = ensure(state.history, () => []);
  state.tickerQueue = Array.isArray(state.tickerQueue) ? state.tickerQueue : (reset = true, []);
  if (typeof state.matchIndex !== "number") { state.matchIndex = 0; reset = true; }
  if (typeof state.matchCount !== "number" || state.matchCount < 1) { state.matchCount = 127; reset = true; }
  if (typeof state.tournamentIndex !== "number" || state.tournamentIndex < 1) { state.tournamentIndex = 1; reset = true; }
  // Strip stale live-match remnants from a crashed session.
  state.live = null;
  return { state, reset };
}

function boot() {
  // Tell the index.html boot watchdog the show started (it explains hosting
  // problems like wrong-MIME .js files when this never fires).
  window.__wwBooted = true;
  // Resume-or-fresh: if a save exists, resume the tournament from the exact
  // next unplayed match (spec §7 crash recovery). Stale saves are repaired
  // in place; unrecoverable ones start clean automatically.
  let state = load();
  let wasReset = false;
  if (state) ({ state, reset: wasReset } = sanitizeState(state));
  if (!state) { state = freshBroadcast(); wasReset = true; }
  if (wasReset) save(state); // persist the repaired/fresh state immediately

  const renderer = createRenderer(canvas);
  renderer.setMatch(null);

  initBroadcast({ state, countries: WW_COUNTRIES, renderer, audio });

  // ————— Sound & AI voice (auto-enable on first gesture) —————
  // Browsers block audio/speech until the user interacts with the page, so
  // both start "armed": the first click/tap/key anywhere turns them on at
  // once. The toolbar buttons still work as manual toggles afterwards.
  const sndBtn = document.getElementById("sndBtn");
  const voiceBtn = document.getElementById("voiceBtn");
  const commEq = document.getElementById("commEq");
  let soundOn = false;
  let voiceOn = false;

  function paintButtons() {
    sndBtn.textContent = soundOn ? "🔊 SFX ON" : "🔇 SFX OFF";
    sndBtn.classList.toggle("on", soundOn);
    voiceBtn.textContent = voiceOn ? "🎙 VOICE ON" : "🎙 VOICE OFF";
    voiceBtn.classList.toggle("on", voiceOn);
    if (commEq) commEq.classList.toggle("off", !voiceOn);
  }

  function enableAll() {
    if (soundOn && voiceOn) return;
    soundOn = true;
    voiceOn = true;
    audio.setEnabled(true);
    audio.unlock();
    commentator.enabled = true;
    commentator.init();
    // Voice line proving the mic is live (and unlocking speech synthesis).
    commentator.say("matchStart", { A: "the broadcast", B: "the arena", BIOME: "" }, { urgent: true });
    paintButtons();
    window.removeEventListener("pointerdown", enableAll);
    window.removeEventListener("keydown", enableAll);
  }
  // Arm on the first interaction anywhere on the page.
  window.addEventListener("pointerdown", enableAll, { once: false });
  window.addEventListener("keydown", enableAll, { once: false });
  paintButtons();

  sndBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    audio.setEnabled(soundOn);
    if (soundOn) audio.unlock();
    paintButtons();
  });
  voiceBtn.addEventListener("click", () => {
    voiceOn = !voiceOn;
    commentator.enabled = voiceOn;
    if (voiceOn) {
      commentator.init();
      commentator.say("matchStart", { A: "the broadcast", B: "the arena", BIOME: "" }, { urgent: true });
    } else {
      commentator.stop();
    }
    paintButtons();
  });

  // ————— Tournament chart modal toggle —————
  const chartBtn = document.getElementById("chartBtn");
  const chartModal = document.getElementById("chartModal");
  chartBtn.addEventListener("click", () => {
    const show = chartModal.style.display !== "flex";
    chartModal.style.display = show ? "flex" : "none";
    chartBtn.classList.toggle("on", show);
  });
  chartModal.addEventListener("click", () => {
    chartModal.style.display = "none";
    chartBtn.classList.remove("on");
  });

  // ————— Live JSON export/import (spec §7 persistence mirrors) —————
  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([exportJSON(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ww247-rotation-state-t${state.tournamentIndex}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("importBtn").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = async () => {
      try {
        const text = await inp.files[0].text();
        const next = importJSON(text);
        localStorage.setItem("ww247.broadcast.v1", JSON.stringify(next));
        location.reload();
      } catch (e) {
        alert("Invalid save file: " + e.message);
      }
    };
    inp.click();
  });
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Wipe all tournament data and restart from Tournament #1?")) {
      localStorage.removeItem("ww247.broadcast.v1");
      location.reload();
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
