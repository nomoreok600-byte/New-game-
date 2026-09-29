// World War 24/7 — Show director (spec §2 timing, §5 rivalry & ceremony, §6 layout).
// Automates the entire broadcast: pre-match intro → fight → killcam → post-match →
// bracket advance → champion ceremony → leaderboard → next tournament rotation.
// v2 additions: tournament chart every match, elimination/qualification feed,
// current & next match display, AI commentary hooks, top news ticker.

"use strict";

import { WEAPONS, createMatch, updateMatch } from "./sim.js";
import {
  FORMAT, roundName, recordMatch, rivalryCount, leaderboard,
  globalKillCount, save, startNextTournament, mulberry32,
} from "./store.js";
import { WW_PERKS, countryName, countryFlag } from "./countries.js";
import { commentator } from "./commentary.js";

let state = null;        // broadcast state (set by init)
let C = null;            // code -> country map
let sim = null;          // active sim match
let phase = "INTRO";     // INTRO | FIGHT | POST | CEREMONY
let phaseT = 0;          // seconds in phase
let matchRef = null;     // bracket slot being played
let roundIdx = 0, matchInRound = 0;
let totalRounds = 7;
let lbIdx = 0, lbT = 0;
let uiTick = 0;          // slow UI updater accumulator
let renderer = null;
let audio = null;
let tickerText = "";
let tickerX = 0;
let firstBlood = { side: null, done: false };
let lowHpWarned = { 0: false, 1: false };
let last = performance.now();

function el(id) { return document.getElementById(id); }
function fmt(n) { return n.toLocaleString("en-US"); }
function clock(s) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ————— Bracket helpers (current & next match) —————
function findNextPlayable(fromRound, fromMatch) {
  for (let ri = fromRound; ri < state.bracket.length; ri++) {
    for (let mi = ri === fromRound ? fromMatch : 0; mi < state.bracket[ri].length; mi++) {
      const m = state.bracket[ri][mi];
      if (m.a && m.b && !m.winner) return { round: ri, match: mi, ref: m };
    }
  }
  return null;
}

function nextMatchLabel() {
  const nxt = findNextPlayable(roundIdx, matchInRound + 1);
  if (!nxt) return "NEXT: GRAND FINAL WINNER → CEREMONY";
  const a = C[nxt.ref.a], b = C[nxt.ref.b];
  return `NEXT: ${a.flag} ${a.name} vs ${b.flag} ${b.name} — ${roundName(nxt.round, totalRounds)}`;
}

// ————— Elimination / qualification feed —————
function pushFeed(kind, html) {
  const feed = el("feedRows");
  if (!feed) return;
  const row = document.createElement("div");
  row.className = `feed-row ${kind}`;
  row.innerHTML = html;
  feed.prepend(row);
  while (feed.children.length > 6) feed.removeChild(feed.lastChild);
}

function pushFeedForMatch(ref) {
  const w = C[ref.winner], l = C[ref.winner === ref.a ? ref.b : ref.a];
  pushFeed("elim", `<b class="f-red">OUT:</b> ${l.flag} ${l.name} — eliminated by ${w.flag} <b>${w.name}</b> (${roundName(ref._round ?? roundIdx, totalRounds)})`);
  pushFeed("qual", `<b class="f-green">THRU:</b> ${w.flag} <b>${w.name}</b> qualifies for the ${roundName(Math.min(totalRounds - 1, (ref._round ?? roundIdx) + 1), totalRounds)}`);
}

// ————— Tournament chart (bracket view) —————
function buildChartInto(wrap) {
  if (!wrap) return;
  wrap.innerHTML = "";
  const curRound = roundIdx;

  state.bracket.forEach((round, ri) => {
    const col = document.createElement("div");
    col.className = "chart-col" + (ri === curRound ? " active" : "") + (ri === totalRounds - 1 ? " final" : "");
    const h = document.createElement("div");
    h.className = "chart-h";
    h.textContent = ri === totalRounds - 1 ? "FINAL" : ri === totalRounds - 2 ? "SEMI" : ri === totalRounds - 3 ? "QUARTER" : `R${Math.round(128 / Math.pow(2, ri))}`;
    col.appendChild(h);

    const maxShow = ri === 0 ? 16 : round.length; // sample first round to stay readable
    const step = Math.max(1, Math.floor(round.length / maxShow));
    for (let mi = 0; mi < round.length; mi += step) {
      const m = round[mi];
      const row = document.createElement("div");
      row.className = "chart-match" + (m.winner ? " done" : "") + (m === matchRef ? " live" : "");
      const ca = m.a ? C[m.a] : null, cb = m.b ? C[m.b] : null;
      row.innerHTML =
        `<div class="cm-line ${m.winner === m.a ? "win" : ca ? "" : "tbd"}"><span class="cm-flag">${ca ? ca.flag : "·"}</span><span class="cm-name">${ca ? ca.code : "TBD"}</span></div>` +
        `<div class="cm-line ${m.winner === m.b ? "win" : cb ? "" : "tbd"}"><span class="cm-flag">${cb ? cb.flag : "·"}</span><span class="cm-name">${cb ? cb.code : "TBD"}</span></div>`;
      col.appendChild(row);
    }
    wrap.appendChild(col);
  });
  // Chart scroll follows the live match position.
  const live = wrap.querySelector(".chart-match.live");
  if (live) live.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Refreshes the in-intro chart and the toggleable full chart.
function buildBracketChart() {
  buildChartInto(el("chartCols"));
  buildChartInto(el("chartColsModal"));
}

// ————— Ticker —————
function pushTicker(line) {
  if (line) state.tickerQueue.push(line);
}
function nextTicker() {
  if (state.tickerQueue.length === 0) {
    const champ = state.history[state.history.length - 1];
    if (champ) {
      return `RECENT CHAMPION: ${countryFlag(champ.code)} ${countryName(champ.code)}  •  GLOBAL KILLS: ${fmt(globalKillCount(state))}  •  TOURNAMENT #${state.tournamentIndex} IN PROGRESS`;
    }
    return `WELCOME TO WORLD WAR 24/7 — 128 NATIONS. ONE SURVIVOR.  •  TOURNAMENT #${state.tournamentIndex} UNDERWAY  •  64 NATIONS BENCHED FOR THE NEXT ROTATION`;
  }
  return state.tickerQueue.shift();
}
function updateTicker(dt) {
  const ticker = el("tickerText");
  if (!tickerText) {
    tickerText = nextTicker();
    tickerX = el("ticker").offsetWidth;
  }
  tickerX -= dt * 95;
  ticker.textContent = tickerText;
  ticker.style.transform = `translateX(${tickerX}px)`;
  if (tickerX < -Math.max(200, ticker.offsetWidth)) tickerText = "";
}

// ————— Odds —————
function computeOdds(codeA, codeB) {
  const ca = C[codeA], cb = C[codeB];
  const sa = state.stats[codeA], sb = state.stats[codeB];
  const baseA = 1 / (1 + Math.pow(10, (cb.elo - ca.elo) / 400));
  const formA = sa && sa.matches ? sa.wins / sa.matches : 0.5;
  const formB = sb && sb.matches ? sb.wins / sb.matches : 0.5;
  const scoreA = baseA * 0.75 + formA * 0.25 - formB * 0.0;
  const oddsA = Math.max(1.05, Math.round((1 / Math.max(0.1, scoreA)) * 100) / 100);
  const oddsB = Math.max(1.05, Math.round((1 / Math.max(0.1, 1 - scoreA)) * 100) / 100);
  return [oddsA.toFixed(2), oddsB.toFixed(2)];
}

// ————— Floating combat text —————
function floatText(x, y, text, color, big) {
  if (!sim.floating) sim.floating = [];
  sim.floating.push({ x, y, text, color, big: !!big, life: 0.95, vy: -55 });
}
function updateFloating(dt) {
  if (!sim || !sim.floating) return;
  for (const ft of sim.floating) { ft.life -= dt; ft.y += ft.vy * dt; }
  sim.floating = sim.floating.filter((f) => f.life > 0);
}

// ————— Sim event presentation (+ commentary hooks) —————
function handleEvent(ev) {
  const nameOf = (side) => side === 0 ? C[sim.codeA].name : C[sim.codeB].name;
  switch (ev.t) {
    case "hit": {
      floatText(ev.x, ev.y - 6, `${ev.headshot ? "RAILSHOT " : ""}-${ev.dmg}`, ev.headshot ? "#f87171" : "#fbbf24", ev.headshot);
      if (audio) audio.hit(ev.headshot);
      if (!firstBlood.done && ev.by >= 0) {
        firstBlood.done = true;
        firstBlood.side = ev.by;
        commentator.say("firstBlood", { W: nameOf(ev.by) }, { urgent: true });
      } else if (ev.dmg >= 12) {
        commentator.say("bigHit", { W: nameOf(ev.by) });
      }
      break;
    }
    case "kill": {
      const winnerName = nameOf(ev.killer >= 0 ? ev.killer : 1 - ev.victim);
      pushTicker(`💀 ${countryName(sim.fighters[ev.victim].code)} ELIMINATED BY ${winnerName.toUpperCase()} — ${ev.method}`);
      commentator.say("kill", { W: winnerName, L: nameOf(ev.victim) }, { urgent: true });
      if (audio) audio.kill();
      break;
    }
    case "explosion":
      if (audio) audio.boom();
      break;
    case "pickup":
      floatText(ev.x, ev.y, `${(WEAPONS[ev.weapon] || {}).name || ev.weapon.toUpperCase()} ACQUIRED`, "#67e8f9");
      commentator.say("pickup", { W: nameOf(ev.side), ITEM: (WEAPONS[ev.weapon] || {}).name || ev.weapon });
      if (audio) audio.pickup();
      break;
    case "heal":
      floatText(ev.x, ev.y, `+${ev.amount} HP`, "#4ade80");
      if (audio) audio.pickup();
      break;
    case "deflect":
      floatText(ev.x, ev.y, "DEFLECTED!", "#e2e8f0");
      if (audio) audio.deflect();
      break;
    case "shieldbreak":
      floatText(ev.x, ev.y, "SHIELD BREAK", "#94a3b8");
      if (audio) audio.shield();
      break;
    case "collapse":
      floatText(ev.x, ev.y, "BRIDGE DESTROYED", "#f97316", true);
      pushTicker(`🌉 Bridge collapse in the ${sim.biome.name} — the terrain has changed!`);
      commentator.say("bridge", {}, { urgent: true });
      if (audio) audio.boom();
      break;
    case "napalmincoming":
      pushTicker(`🔥 NAPALM INBOUND — the arena floor is burning!`);
      commentator.say("napalm", {}, { urgent: true });
      break;
    case "thunder":
      pushTicker(`⛈️ Thunder rolls over the ${sim.biome.name}…`);
      break;
    case "crate":
      pushTicker(`📦 Air drop sighted — supply crate descending!`);
      break;
    case "turret":
      commentator.say("turret", {}, { urgent: true });
      break;
    case "end": {
      const wCode = sim.winner === 0 ? sim.codeA : sim.codeB;
      pushTicker(`🏁 ${countryFlag(wCode)} ${countryName(wCode)} wins — ${ev.method}`);
      if (ev.method === "TIME LIMIT") {
        commentator.say("timeLimit", { W: nameOf(sim.winner), L: nameOf(1 - sim.winner) }, { urgent: true });
      }
      break;
    }
  }
}

// ————— Phase: pre-match intro (6s) —————
function startPreMatch() {
  phase = "INTRO";
  phaseT = 0;
  hideOverlays();
  el("pre").style.display = "flex";

  const codeA = matchRef.a, codeB = matchRef.b;
  const ca = C[codeA], cb = C[codeB];
  const sa = state.stats[codeA], sb = state.stats[codeB];
  const riv = rivalryCount(state, codeA, codeB);
  const [oddsA, oddsB] = computeOdds(codeA, codeB);
  matchRef._round = roundIdx; // remember round for the feed

  // Current match display.
  el("curRound").textContent = `${roundName(roundIdx, totalRounds)} • MATCH ${state.matchIndex + 1}/${state.matchCount}`;
  el("curVs").innerHTML = `${ca.flag} <b>${ca.name}</b> <span class="vs">vs</span> ${cb.flag} <b>${cb.name}</b>`;
  el("nextMatch").textContent = nextMatchLabel();

  // Roster side panel.
  el("flagL").textContent = ca.flag;
  el("nameL").textContent = ca.name.toUpperCase();
  el("rankL").textContent = `ELO ${Math.round(ca.elo)} • ${sa ? `${sa.wins}W-${sa.losses}L` : "ROOKIE"}`;
  el("perkL").textContent = `${WW_PERKS[ca.perk].emoji} ${ca.perk}`;
  el("flagR").textContent = cb.flag;
  el("nameR").textContent = cb.name.toUpperCase();
  el("rankR").textContent = `ELO ${Math.round(cb.elo)} • ${sb ? `${sb.wins}W-${sb.losses}L` : "ROOKIE"}`;
  el("perkR").textContent = `${WW_PERKS[cb.perk].emoji} ${cb.perk}`;

  // Intro overlay faces.
  el("flagL2").textContent = ca.flag;
  el("nameL2").textContent = ca.name.toUpperCase();
  el("rankL2").textContent = `ELO ${Math.round(ca.elo)} • ${sa ? `${sa.wins}W-${sa.losses}L` : "ROOKIE"}`;
  el("perkL2").textContent = `${WW_PERKS[ca.perk].emoji} ${ca.perk}`;
  el("flagR2").textContent = cb.flag;
  el("nameR2").textContent = cb.name.toUpperCase();
  el("rankR2").textContent = `ELO ${Math.round(cb.elo)} • ${sb ? `${sb.wins}W-${sb.losses}L` : "ROOKIE"}`;
  el("perkR2").textContent = `${WW_PERKS[cb.perk].emoji} ${cb.perk}`;

  el("rivBadge").style.display = riv.total >= 2 ? "inline-flex" : "none";
  if (riv.total >= 2) {
    el("rivBadge").textContent = `⚔ RIVALRY MATCH — ROUND ${riv.total + 1}`;
    pushTicker(`⚔️ RIVALRY MATCH! ${countryName(codeA)} lead the head-to-head ${riv.a}–${riv.b} after ${riv.total} historic battles`);
    commentator.say("rivalry", { A: ca.name, B: cb.name }, { urgent: true });
  }
  el("rivLine").textContent = riv.total >= 2
    ? `HEAD-TO-HEAD: ${countryName(codeA)} ${riv.a} — ${riv.b} ${countryName(codeB)}`
    : ca.perk === cb.perk ? `MIRROR MATCHUP — BOTH FIGHT WITH ${ca.perk.toUpperCase()}` : "";
  el("oddsLine").textContent = `MATCH ODDS  ${oddsA}x — ${oddsB}x`;

  // Tournament chart refreshes on EVERY new match (request).
  buildBracketChart();
  const tourBadge = el("chartTour");
  if (tourBadge) tourBadge.textContent = state.tournamentIndex;

  el("hudTOUR").textContent = `TOURNAMENT #${state.tournamentIndex}`;

  // Create the match now so the live arena + real conditions show behind
  // the intro card; it stays frozen until startFight() advances it.
  const rng = mulberry32((Date.now() ^ Math.imul(state.matchIndex + 1, 2654435761)) >>> 0);
  sim = createMatch(matchRef.a, matchRef.b, { rng, fightSeconds: FORMAT.FIGHT_MIN_S + Math.floor(rng() * (FORMAT.FIGHT_MAX_S - FORMAT.FIGHT_MIN_S)) });
  sim.floating = [];
  renderer.setMatch(sim);
  syncWeatherPanel();

  commentator.say("matchStart", { A: ca.name, B: cb.name, BIOME: sim.biome.name }, { urgent: true });
}

function hideOverlays() {
  for (const id of ["pre", "fightHud", "post", "ceremony"]) el(id).style.display = "none";
}

// ————— Phase: fight —————
function startFight() {
  phase = "FIGHT";
  phaseT = 0;
  hideOverlays();
  el("fightHud").style.display = "flex";
  // Sim was already created in startPreMatch (deterministic seed) so the
  // arena could render behind the intro card; it starts advancing now.
  firstBlood = { side: null, done: false };
  lowHpWarned = { 0: false, 1: false };
  if (audio) audio.matchStart();
}

// ————— Phase: post-match (9s) —————
function startPost() {
  phase = "POST";
  phaseT = 0;
  el("fightHud").style.display = "none";
  el("post").style.display = "flex";
  const wCode = sim.winner === 0 ? sim.codeA : sim.codeB;
  const lCode = sim.winner === 0 ? sim.codeB : sim.codeA;
  const wc = C[wCode];
  el("postFlag").textContent = wc.flag;
  el("postName").textContent = `${wc.name.toUpperCase()} WINS`;
  el("postMethod").textContent = `${sim.method} • ${clock(sim.durationS)}`;
  el("postSub").textContent = `${countryName(lCode)} eliminated — ${roundName(roundIdx, totalRounds)} continues`;
  // Feed entries: who is out, who qualified for the next round.
  matchRef.winner = wCode;
  pushFeedForMatch(matchRef);
  pushTicker(`➡️ ${countryFlag(wCode)} ${countryName(wCode)} QUALIFIES for the ${roundName(Math.min(totalRounds - 1, roundIdx + 1), totalRounds)}`);
}

// ————— Bracket progression —————
function advanceBracket() {
  const winnerCode = matchRef.winner;
  matchRef.killsA = sim.killsA;
  matchRef.killsB = sim.killsB;
  matchRef.durationS = sim.durationS;
  recordMatch(state, matchRef, matchRef.a, matchRef.b, winnerCode, sim.killsA, sim.killsB, sim.durationS, sim.method);
  promoteWinner(roundIdx, matchInRound, winnerCode);
  state.matchIndex++;
  save(state);
  sim = null;

  if (state.matchIndex >= state.matchCount) {
    startCeremony();
  } else {
    startPreMatch();
  }
}

function promoteWinner(ri, mi, winner) {
  if (ri + 1 < state.bracket.length) {
    const next = state.bracket[ri + 1][Math.floor(mi / 2)];
    if (mi % 2 === 0) next.a = winner; else next.b = winner;
  }
  let ri2 = ri, mi2 = mi + 1;
  while (ri2 < state.bracket.length) {
    if (mi2 >= state.bracket[ri2].length) { ri2++; mi2 = 0; continue; }
    const m = state.bracket[ri2][mi2];
    if (m.a && m.b) { roundIdx = ri2; matchInRound = mi2; matchRef = m; return; }
    mi2++;
  }
}

// ————— Ceremony (spec §5) —————
function startCeremony() {
  phase = "CEREMONY";
  phaseT = 0;
  lbIdx = 0; lbT = 0;
  hideOverlays();
  el("ceremony").style.display = "flex";

  const finalRef = state.bracket[state.bracket.length - 1][0];
  const champ = finalRef.winner;
  const runnerUp = finalRef.a === champ ? finalRef.b : finalRef.a;
  const cc = C[champ];

  state.history.push({ tournament: state.tournamentIndex, code: champ, runnerUp, date: new Date().toISOString() });
  const cs = state.stats[champ];
  cs.titles = (cs.titles || 0) + 1;
  cs.finals = (cs.finals || 0) + 1;
  const rs = state.stats[runnerUp];
  if (rs) rs.finals = (rs.finals || 0) + 1;
  save(state);

  el("champFlag").textContent = cc.flag;
  el("champName").textContent = cc.name.toUpperCase();
  el("champStats").textContent = `TITLE #${cs.titles} • ${cs.wins}W-${cs.losses}L LIFETIME • ${fmt(cs.kills)} KILLS`;
  pushTicker(`👑 ${cc.name} WINS WORLD CHAMPIONSHIP #${state.tournamentIndex}! ${cs.titles > 1 ? `That's title #${cs.titles} for the dynasty!` : "A new dynasty begins!"}`);
  renderLeaderboard();
  commentator.say("champion", { A: cc.name }, { urgent: true });
  if (audio) audio.anthem();
}

function updateCeremony(dt) {
  phaseT += dt;
  const confetti = el("confetti");
  if (confetti.children.length < 90 && phaseT < 40) {
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("div");
      s.className = "conf";
      s.style.left = Math.random() * 100 + "%";
      s.style.animationDelay = Math.random() * 2 + "s";
      s.style.background = ["#fbbf24", "#f59e0b", "#fde68a", "#ffffff", "#22d3ee"][Math.floor(Math.random() * 5)];
      confetti.appendChild(s);
    }
  }
  lbT += dt;
  if (lbT > 4.5) {
    lbT = 0;
    lbIdx += 5;
    const lb = leaderboard(state, 10);
    if (lbIdx >= Math.max(5, lb.length)) {
      // Ceremony over → rotation engine (spec §2) → next tournament.
      el("confetti").innerHTML = "";
      startNextTournament(state);
      totalRounds = state.bracket.length;
      roundIdx = 0; matchInRound = 0;
      matchRef = state.bracket[0][0];
      startPreMatch();
      return;
    }
    renderLeaderboard();
  }
}

function renderLeaderboard() {
  const lb = leaderboard(state, 10);
  const rows = el("lbRows");
  rows.innerHTML = "";
  el("lbPage").textContent = `ALL-TIME TOP 10 — PAGE ${Math.floor(lbIdx / 5) + 1}`;
  const slice = lb.slice(lbIdx, lbIdx + 5);
  if (slice.length === 0) return;
  for (let i = 0; i < slice.length; i++) {
    const e = slice[i];
    const c = C[e.code];
    const row = document.createElement("div");
    row.className = "lb-row";
    row.innerHTML = `<span class="lb-rank">#${lbIdx + i + 1}</span><span class="lb-flag">${c.flag}</span><span class="lb-name">${c.name}</span><span class="lb-stat">${e.titles}🏆 ${e.wins}W ${e.kills}K</span>`;
    rows.appendChild(row);
  }
}

// ————— HUD sync —————
function syncHUD() {
  const [fa, fb] = sim.fighters;
  const ca = C[sim.codeA], cb = C[sim.codeB];
  el("hudAFlag").textContent = ca.flag;
  el("hudAR").textContent = ca.name.toUpperCase();
  el("hudAL").textContent = ca.code;
  el("hudAPerk").textContent = `${WW_PERKS[ca.perk].emoji} ${ca.perk} • ${WEAPONS[fa.weapon].name}`;
  el("hudBFlag").textContent = cb.flag;
  el("hudBR").textContent = cb.name.toUpperCase();
  el("hudBL").textContent = cb.code;
  el("hudBPerk").textContent = `${WW_PERKS[cb.perk].emoji} ${cb.perk} • ${WEAPONS[fb.weapon].name}`;
  el("hpA").style.width = `${Math.max(0, fa.hp)}%`;
  el("hpB").style.width = `${Math.max(0, fb.hp)}%`;
  el("hpA").className = `hbar-fill${fa.hp < 30 ? " low" : ""}`;
  el("hpB").className = `hbar-fill right${fb.hp < 30 ? " low" : ""}`;
  el("shA").textContent = `🛡 ${Math.round(fa.shield)}`;
  el("shB").textContent = `🛡 ${Math.round(fb.shield)}`;
  el("hudTimer").textContent = clock(Math.max(0, sim.fightBudget - sim.time));
  const [oa, ob] = computeOdds(sim.codeA, sim.codeB);
  el("hudOdds").textContent = `ODDS ${oa}x — ${ob}x`;
  el("hudKillsA").textContent = sim.killsA;
  el("hudKillsB").textContent = sim.killsB;
  el("wxBiome").textContent = `${sim.biome.emoji} ${sim.biome.name.split(" (")[0]}`;
  el("hudTimer").classList.toggle("hot", sim.fightBudget - sim.time < 30);

  // AI commentary: warn once per fighter when health goes critical.
  for (const f of sim.fighters) {
    if (f.hp < 22 && !lowHpWarned[f.side] && f.alive) {
      lowHpWarned[f.side] = true;
      commentator.say("lowHp", { W: C[f.code].name }, { urgent: true });
    }
  }
}

function syncWeatherPanel() {
  if (sim) {
    el("wxBiome").textContent = sim.biome.name.split(" (")[0];
    el("wxWeather").textContent =
      sim.biome.weather === "rain" ? "🌧 RAIN" :
      sim.biome.weather === "snow" ? "❄️ SNOWFALL" : "🌪 SANDSTORM";
    el("wxSpeed").textContent = `${sim.timeScale.toFixed(1)}x`;
  }
  // Recent results (last completed matches).
  const recent = [];
  for (let ri = state.bracket.length - 1; ri >= 0 && recent.length < 5; ri--) {
    const round = state.bracket[ri];
    for (let mi = round.length - 1; mi >= 0 && recent.length < 5; mi--) {
      const m = round[mi];
      if (m.winner) recent.push(m);
    }
  }
  el("bmTitle").textContent = "RECENT RESULTS";
  const rows = el("bmRows");
  rows.innerHTML = "";
  for (const m of recent) {
    const loser = m.winner === m.a ? m.b : m.a;
    const row = document.createElement("div");
    row.className = "bm-row win";
    row.innerHTML = `<span class="bm-flag">${countryFlag(m.winner)}</span><span>${C[m.winner].name}</span><span>beat ${countryFlag(loser)}</span>`;
    rows.appendChild(row);
  }
  // Footer stats.
  el("tsTitles").textContent = state.history.length;
  el("tsKills").textContent = fmt(globalKillCount(state));
  const lastChamp = state.history[state.history.length - 1];
  el("tsChamp").textContent = lastChamp ? `${countryFlag(lastChamp.code)} ${lastChamp.code}` : "—";
}

// ————— Main loop —————
// ————— Broadcast self-heal —————
// If any frame of the show director throws (stale save, sim edge case, add-on
// interference), the viewer would otherwise stare at a frozen countdown
// forever. Instead: show a visible error card once, then auto-restart the
// match cleanly from the persisted state.
let healTimer = null;
let healing = false;
let lastErrorAt = 0;

function showCrashCard(message) {
  if (healing) return;
  healing = true;
  console.error("[WW247] frame error:", message);
  let card = document.getElementById("wwCrashCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "wwCrashCard";
    card.style.cssText = "position:fixed;inset:auto 16px 16px 16px;z-index:9999;max-width:560px;margin:0 auto;" +
      "background:#1a0505;border:2px solid #f87171;border-radius:14px;padding:16px 18px;color:#fecaca;" +
      "font:600 13px/1.5 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)";
    card.innerHTML = '<b style="color:#f87171">⚠ BROADCAST GLITCH — auto-recovering</b><br>' +
      '<span id="wwCrashMsg"></span><br><br>' +
      '<button id="wwRestartBtn" style="background:#f87171;border:0;border-radius:8px;padding:8px 18px;font-weight:800;color:#1a0505;cursor:pointer;font-size:13px">CLEAN RESTART (wipes save)</button>' +
      "<span style='opacity:.7;margin-left:10px'>or wait — the show restarts this match by itself</span>";
    document.body.appendChild(card);
    document.getElementById("wwRestartBtn").addEventListener("click", () => {
      try { localStorage.removeItem("ww247.broadcast.v1"); } catch { /* private mode */ }
      location.reload();
    });
  }
  document.getElementById("wwCrashMsg").textContent = String(message || "Unknown error").slice(0, 300);
  clearTimeout(healTimer);
  healTimer = setTimeout(() => {
    healing = false;
    card.remove();
    try { restartCurrentMatch(); } catch { location.reload(); }
  }, 5000);
}

function restartCurrentMatch() {
  // Drop the in-memory match and rebuild it from the same bracket slot.
  try {
    sim = null;
    renderer.setMatch(null);
    startPreMatch();
  } catch (e) {
    location.reload();
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state || !matchRef) return;

  try {
    tick(now, dt);
  } catch (err) {
    // Throttle: show the card at most once per 10s if errors keep firing.
    const t = performance.now();
    if (t - lastErrorAt > 10000) {
      lastErrorAt = t;
      showCrashCard(err && err.message ? err.message : String(err));
    }
  }
}

function tick(now, dt) {
  // Slow side-panel/stat updater (~2 Hz).
  uiTick += dt;
  if (uiTick > 0.5) { uiTick = 0; syncWeatherPanel(); }

  if (phase === "INTRO") {
    phaseT += dt;
    el("preCount").textContent = Math.max(0, Math.ceil(FORMAT.PRE_MATCH_S - phaseT));
    if (sim) renderer.frame(performance.now()); // live arena behind the intro card
    updateTicker(dt);
    if (phaseT >= FORMAT.PRE_MATCH_S) startFight();
    return;
  }

  if (phase === "FIGHT") {
    phaseT += dt;
    updateMatch(sim, dt);
    const evs = sim.events;
    sim.events = [];
    for (const ev of evs) handleEvent(ev);
    updateFloating(dt);
    // Killcam FX (spec §3): slow-mo letterbox + chromatic aberration.
    sim.aberration = Math.max(0, (sim.aberration || 0) - dt * 2);
    if (sim.slowmoT > 0 && sim.timeScale < 1) sim.aberration = 0.8;
    sim.letterbox = sim.slowmoT > 0 ? Math.min(1, (sim.letterbox || 0) + dt * 4) : Math.max(0, (sim.letterbox || 0) - dt * 2);
    renderer.frame(performance.now());
    syncHUD();
    updateTicker(dt);
    if (sim.ended && sim.endT > 1.15) startPost();
    return;
  }

  if (phase === "POST") {
    phaseT += dt;
    if (sim) renderer.frame(performance.now());
    updateTicker(dt);
    if (phaseT >= FORMAT.POST_MATCH_S) advanceBracket();
    return;
  }

  if (phase === "CEREMONY") {
    updateCeremony(dt);
    updateTicker(dt);
    return;
  }
}

// ————— Boot —————
export function initBroadcast(opts = {}) {
  state = opts.state;
  C = Object.fromEntries(opts.countries.map((c) => [c.code, c]));
  audio = opts.audio || null;
  renderer = opts.renderer;
  totalRounds = state.bracket.length;
  commentator.init();

  // Crash recovery: resume at the first unplayed match (spec §7).
  outer: for (let ri = 0; ri < state.bracket.length; ri++) {
    for (let mi = 0; mi < state.bracket[ri].length; mi++) {
      const m = state.bracket[ri][mi];
      if (m.a && m.b && !m.winner) { roundIdx = ri; matchInRound = mi; matchRef = m; break outer; }
    }
  }
  if (!matchRef) { roundIdx = 0; matchInRound = 0; matchRef = state.bracket[0][0]; }

  // Hide the boot veil.
  const boot = el("boot");
  if (boot) { boot.style.opacity = "0"; boot.style.transition = "opacity 0.5s"; setTimeout(() => boot.remove(), 600); }

  startPreMatch();
  requestAnimationFrame(loop);
}
