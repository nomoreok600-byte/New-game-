// World War 24/7 — Entry point.
// Wires the sim, renderer, show director and audio together and installs the
// bridge hooks show.js uses (keeps module boundaries clean).

"use strict";

import { WW_COUNTRIES } from "./countries.js";
import { freshBroadcast, load, save, exportJSON, importJSON, defaultState } from "./store.js";
import { createMatch, updateMatch } from "./sim.js";
import { createRenderer } from "./render.js";
import { initBroadcast } from "./show.js";
import { audio } from "./audio.js";
import { commentator } from "./commentary.js";
import { commentator } from "./commentary.js";

// Bridge hooks so show.js stays decoupled from sim.js internals.
window.__wwCreateMatch = createMatch;
window.__wwUpdateMatch = updateMatch;

const canvas = document.getElementById("arena");

function boot() {
  // Resume-or-fresh: if a save exists, resume the tournament from the exact
  // next unplayed match (spec §7 crash recovery).
  let state = load();
  if (!state) state = freshBroadcast();
  if (!state.bracket || state.bracket.length === 0) state = freshBroadcast();
  save(state); // persist immediately so even a mid-match-1 refresh resumes

  const renderer = createRenderer(canvas);
  renderer.setMatch(null);

  initBroadcast({ state, countries: WW_COUNTRIES, renderer, audio });

  // Sound toggle (starts muted until the viewer clicks — browser autoplay policy).
  const sndBtn = document.getElementById("sndBtn");
  let soundOn = false;
  sndBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    audio.setEnabled(soundOn);
    if (soundOn) audio.unlock();
    sndBtn.textContent = soundOn ? "🔊 SOUND ON" : "🔇 SOUND OFF";
    sndBtn.classList.toggle("on", soundOn);
  });

  // AI commentator voice toggle (request: add AI commentary voice).
  const voiceBtn = document.getElementById("voiceBtn");
  voiceBtn.addEventListener("click", () => {
    const on = !commentator.enabled;
    commentator.enabled = on;
    if (!on) commentator.stop();
    voiceBtn.textContent = on ? "🎙 VOICE ON" : "🎙 VOICE OFF";
    voiceBtn.classList.toggle("on", on);
    document.getElementById("commEq").classList.toggle("off", !on);
  });

  // Tournament chart overlay toggle.
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

  // AI commentator voice toggle (request: AI commentary voice).
  // Speech synthesis needs one user gesture before it can speak, so it
  // starts OFF and flips on with the first click.
  const voiceBtn = document.getElementById("voiceBtn");
  const commEq = document.getElementById("commEq");
  voiceBtn.addEventListener("click", () => {
    const on = !commentator.enabled;
    commentator.enabled = on;
    if (on) commentator.init(); else commentator.stop();
    voiceBtn.textContent = on ? "🎙 VOICE ON" : "🎙 VOICE OFF";
    voiceBtn.classList.toggle("on", on);
    if (commEq) commEq.classList.toggle("off", !on);
  });

  // Tournament chart modal toggle.
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

  // Live JSON export/import (spec §7 persistence mirrors).
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
        localStorage.setItem("ww247.broadcast.v1", next ? JSON.stringify(next) : "");
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
