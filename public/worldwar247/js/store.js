// World War 24/7 — Persistent broadcast state.
// Mirrors the spec's JSON persistence layer (rotation_state.json, stats.json,
// current_tournament.json) but lives in localStorage so the whole broadcast
// runs on plain cPanel static hosting. Includes JSON export/import for backup
// and manual editing.

"use strict";

import { WW_COUNTRIES } from "./countries.js";

const KEY = "ww247.broadcast.v1";
const SAVE_VERSION = 1;

// ————— Tournament format (spec §2) —————
export const FORMAT = {
  ACTIVE: 128,
  BENCHED: 64,
  PRE_MATCH_S: 12,
  FIGHT_MIN_S: 50,
  FIGHT_MAX_S: 70,
  POST_MATCH_S: 12,
};

const TOTAL_NATIONS = WW_COUNTRIES.length; // 192

function mulberry32(seedNum) {
  let a = seedNum >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function defaultStatsEntry(code) {
  return {
    code,
    titles: 0,
    finals: 0,
    matches: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    bestMatchKills: 0,
    nemesis: {}, // code -> { wins, losses }
  };
}

export function defaultState() {
  return {
    version: SAVE_VERSION,
    tournamentIndex: 1, // World Championship # — starts at 1, not 0, per broadcast numbering
    active: [], // codes of the 128 active nations (ordered by bracket seed)
    benched: [], // codes of the 64 benched nations
    bracket: [], // rounds: each round is [{ a, b, winner, killsA, killsB, durationS, method }]
    matchIndex: 0, // 0-based index into the flat 127-match list
    matchCount: 127, // single elimination: N-1 matches for 128 entrants
    live: null, // live match object while a match runs (see sim.js)
    stats: {}, // code -> statsEntry (lifetime)
    history: [], // past champions: [{ tournament, code, runnerUp, date }]
    tickerQueue: [], // pending ticker lines (rivalries, records)
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ————— Bracket generation —————
// Single elimination, 128 entrants → 7 rounds → 127 matches.
// Seeding: 1v128, 2v127, ... standard bracket order so the best Elo seeds
// meet only in late rounds.
function bracketOrder(n) {
  let order = [0, 1];
  while (order.length < n) {
    const next = [];
    const len = order.length * 2;
    for (const s of order) {
      next.push(s);
      next.push(len - 1 - s);
    }
    order = next;
  }
  return order;
}

export function generateBracket(activeCodes) {
  const entries = activeCodes.map((code) => ({
    code,
    elo: (WW_COUNTRIES.find((c) => c.code === code) || {}).elo || 1500,
  }));
  // Sort by Elo so strong nations get protected late-round seeds.
  entries.sort((x, y) => y.elo - x.elo);
  const seeded = entries.map((e) => e.code);
  const order = bracketOrder(activeCodes.length);
  const slots = order.map((i) => seeded[i]);

  const rounds = [];
  let current = [];
  for (let i = 0; i < slots.length; i += 2) {
    current.push({ a: slots[i], b: slots[i + 1], winner: null, killsA: 0, killsB: 0, durationS: 0, method: null });
  }
  rounds.push(current);

  let size = current.length;
  while (size > 1) {
    rounds.push(Array.from({ length: size / 2 }, () => ({ a: null, b: null, winner: null, killsA: 0, killsB: 0, durationS: 0, method: null })));
    size /= 2;
  }
  return rounds;
}

export function roundName(roundIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return "GRAND FINAL";
  if (fromEnd === 1) return "SEMI-FINALS";
  if (fromEnd === 2) return "QUARTER-FINALS";
  if (fromEnd === 3) return "ROUND OF 16";
  if (fromEnd === 4) return "ROUND OF 32";
  if (fromEnd === 5) return "ROUND OF 64";
  return "ROUND OF 128";
}

// Flat list of all matches in play order.
export function flattenBracket(bracket) {
  const out = [];
  bracket.forEach((round, ri) => {
    round.forEach((m, mi) => out.push({ round: ri, match: mi, ref: m }));
  });
  return out;
}

// ————— Rotation engine (spec §2 diagram) —————
// End of tournament:
//  1. 64 benched nations → guaranteed entry
//  2. Champion + finalist → immunity (auto-qualify)
//  3. 62 more sampled from the 126 remaining participants
//  4. The other 64 participants → new benched pool
export function rotateAfterTournament(state, rng = Math.random) {
  const champion = state.history[state.history.length - 1].code;
  const finalistRef = state.bracket[state.bracket.length - 1][0];
  let runnerUp = finalistRef.a === champion ? finalistRef.b : finalistRef.a;
  // Defensive: if bracket finalists are missing (corrupt/resumed save), fall back
  // to any other participant so the 128/64 pool math stays exact.
  if (!runnerUp || runnerUp === champion) {
    runnerUp = state.active.find((c) => c !== champion) || null;
  }

  const participants = state.active.filter((c) => c !== champion && c !== runnerUp);
  const shuffled = seededShuffle(participants, rng);
  const promoted = shuffled.slice(0, 62);
  const benched = shuffled.slice(62);

  return {
    active: [champion, runnerUp, ...state.benched, ...promoted],
    benched,
    championImmune: [champion, runnerUp],
  };
}

export function startNextTournament(state) {
  const rot = rotateAfterTournament(state);
  state.active = rot.active;
  state.benched = rot.benched;
  state.tournamentIndex += 1;
  state.bracket = generateBracket(state.active);
  state.matchIndex = 0;
  state.live = null;
  state.updatedAt = Date.now();
  save(state);
}

// ————— Stats helpers —————
export function getStats(state, code) {
  if (!state.stats[code]) state.stats[code] = defaultStatsEntry(code);
  return state.stats[code];
}

export function recordMatch(state, matchRef, codeA, codeB, winner, killsA, killsB, durationS, method) {
  const sa = getStats(state, codeA);
  const sb = getStats(state, codeB);

  sa.matches++;
  sb.matches++;
  sa.kills += killsA;
  sb.kills += killsB;
  sa.deaths += killsB;
  sb.deaths += killsA;
  sa.bestMatchKills = Math.max(sa.bestMatchKills, killsA);
  sb.bestMatchKills = Math.max(sb.bestMatchKills, killsB);

  const winStats = winner === codeA ? sa : sb;
  const loseStats = winner === codeA ? sb : sa;
  winStats.wins++;
  loseStats.losses++;

  // Nemesis head-to-head records.
  if (!sa.nemesis[codeB]) sa.nemesis[codeB] = { wins: 0, losses: 0 };
  if (!sb.nemesis[codeA]) sb.nemesis[codeA] = { wins: 0, losses: 0 };
  if (winner === codeA) {
    sa.nemesis[codeB].wins++;
    sb.nemesis[codeA].losses++;
  } else {
    sb.nemesis[codeA].wins++;
    sa.nemesis[codeB].losses++;
  }

  matchRef.winner = winner;
  matchRef.killsA = killsA;
  matchRef.killsB = killsB;
  matchRef.durationS = durationS;
  matchRef.method = method;
  state.updatedAt = Date.now();
  save(state);
}

// Rivalry detection: total historical meetings between two nations.
export function rivalryCount(state, codeA, codeB) {
  const sa = state.stats[codeA];
  if (!sa || !sa.nemesis[codeB]) return { total: 0, a: 0, b: 0 };
  const rec = sa.nemesis[codeB];
  const other = state.stats[codeB] ? state.stats[codeB].nemesis[codeA] || { wins: 0, losses: 0 } : { wins: 0, losses: 0 };
  return { total: rec.wins + rec.losses, a: rec.wins, b: other.wins };
}

export function winRate(entry) {
  if (!entry || entry.matches === 0) return 0;
  return Math.round((entry.wins / entry.matches) * 100);
}

export function kdRatio(entry) {
  if (!entry || entry.deaths === 0) return entry ? entry.kills : 0;
  return Math.round((entry.kills / entry.deaths) * 100) / 100;
}

// Global leaderboard across all nations (top N by titles, then wins).
export function leaderboard(state, n = 10) {
  return Object.values(state.stats)
    .filter((e) => e.matches > 0)
    .sort((a, b) => b.titles - a.titles || b.wins - a.wins || b.kills - a.kills)
    .slice(0, n);
}

export function globalKillCount(state) {
  return Object.values(state.stats).reduce((n, e) => n + e.kills, 0);
}

// ————— Persistence —————
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SAVE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function save(state) {
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked — broadcast continues, state just won't survive reload */
  }
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(json) {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== SAVE_VERSION) throw new Error("Unsupported save version");
  return parsed;
}

export function freshBroadcast() {
  const state = defaultState();
  // First tournament: all 192 seeded, take top 128 by Elo blend, bench the rest.
  const seeded = [...WW_COUNTRIES].sort((a, b) => b.elo - a.elo);
  state.active = seeded.slice(0, FORMAT.ACTIVE).map((c) => c.code);
  state.benched = seeded.slice(FORMAT.ACTIVE).map((c) => c.code);
  state.bracket = generateBracket(state.active);
  return state;
}

export { mulberry32, seededShuffle, defaultStatsEntry, TOTAL_NATIONS };
