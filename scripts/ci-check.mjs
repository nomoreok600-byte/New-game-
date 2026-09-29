// Headless verification for World War 24/7 (runs in Node, no browser needed).
// Checks the invariants that matter for an unattended 24/7 broadcast:
//   1. Nation database integrity (192 unique nations, valid perks/flags)
//   2. Bracket math (128 active / 64 benched, 7 rounds, 127 matches)
//   3. Rotation engine (pools stay 128/64/192 across cycles)
//   4. Combat sim (matches always end; knockouts really happen)

import { WW_COUNTRIES, WW_COUNTRY_BY_CODE } from "../public/worldwar247/js/countries.js";
import {
  freshBroadcast, generateBracket, rotateAfterTournament, roundName,
} from "../public/worldwar247/js/store.js";
import { createMatch, updateMatch } from "../public/worldwar247/js/sim.js";

const tests = [];
const check = (name, ok) => tests.push([name, ok]);

// Deterministic RNG so CI failures are reproducible.
let seed = 20260929;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed >>> 8) / 16777216;
};

// ————— 1. Nation database —————
check("192 nations in the master pool", WW_COUNTRIES.length === 192);
check("all nation codes unique", new Set(WW_COUNTRIES.map((c) => c.code)).size === 192);
check("all flags are 2-code regional indicators", WW_COUNTRIES.every((c) => [...c.flag].length === 2));
check("all perks are one of the 4 spec traits",
  WW_COUNTRIES.every((c) => ["Guerilla Warfare", "Heavy Armor", "Sharpshooter", "Berserker"].includes(c.perk)));

// ————— 2. Bracket —————
const st = freshBroadcast();
check("128 active / 64 benched", st.active.length === 128 && st.benched.length === 64);
check("7 bracket rounds (128 entrants)", st.bracket.length === 7);
check("127 total matches", st.bracket.reduce((n, r) => n + r.length, 0) === 127);
check("grand final named correctly", roundName(6, 7) === "GRAND FINAL");
const firstRoundNations = st.bracket[0].flatMap((m) => [m.a, m.b]);
check("first round pairs 128 unique valid nations",
  firstRoundNations.length === 128 && new Set(firstRoundNations).size === 128 &&
  firstRoundNations.every((c) => !!WW_COUNTRY_BY_CODE[c]));
const elo = (c) => WW_COUNTRY_BY_CODE[c].elo;
const top2 = [...st.active].sort((a, b) => elo(b) - elo(a)).slice(0, 2);
const p0 = firstRoundNations.indexOf(top2[0]), p1 = firstRoundNations.indexOf(top2[1]);
check("top-2 Elo seeded into opposite halves", Math.floor(p0 / 64) !== Math.floor(p1 / 64));

// ————— 3. Rotation across 3 cycles —————
const lc = { active: [...st.active], benched: [...st.benched], history: [], bracket: st.bracket, stats: {} };
for (let cycle = 1; cycle <= 3; cycle++) {
  for (const m of lc.bracket[0]) {
    const sm = createMatch(m.a, m.b, { rng, fightSeconds: 3 });
    let guard = 0;
    while (!sm.ended && guard < 200) { updateMatch(sm, 0.05); guard++; }
    if (!sm.ended) { check(`cycle ${cycle}: match ${m.a} vs ${m.b} ended`, false); continue; }
    const winner = sm.winner === 0 ? m.a : m.b;
    m.winner = winner;
    lc.bracket[1][Math.floor(lc.bracket[0].indexOf(m) / 2)].a = winner;
  }
  const champ = lc.bracket[1][0].a;
  lc.history = [{ tournament: cycle, code: champ, runnerUp: lc.bracket[1][0].b }];
  const rot = rotateAfterTournament(lc);
  check(`cycle ${cycle}: pools stay 128/64`, rot.active.length === 128 && rot.benched.length === 64);
  check(`cycle ${cycle}: 192 unique nations total`,
    new Set([...rot.active, ...rot.benched]).size === 192);
  check(`cycle ${cycle}: champion keeps immunity`, rot.active.includes(champ));
  lc.active = rot.active;
  lc.benched = rot.benched;
  lc.bracket = generateBracket(rot.active);
}

// ————— 4. Combat sim reliability —————
// Pacing envelope: fights are tuned for 100–150s budgets with slow-cinematic
// damage; the harness gives each match 120s of sim time so knockouts can land.
let ended = 0, kos = 0;
for (let t = 0; t < 20; t++) {
  const a = st.active[t * 6], b = st.active[t * 6 + 1];
  const m = createMatch(a, b, { rng, fightSeconds: 45 });
  let guard = 0;
  while (!m.ended && guard < 2400) { updateMatch(m, 0.05); guard++; }
  if (m.ended) {
    ended++;
    if (m.method !== "TIME LIMIT") kos++;
  }
}
check("20/20 sim matches reach a verdict", ended === 20);
check("knockouts occur (not just time limits)", kos >= 8);

// ————— Report —————
let fails = 0;
for (const [name, ok] of tests) {
  if (!ok) { fails++; console.error("FAIL:", name); }
}
console.log(`${tests.length - fails}/${tests.length} checks passed`);
if (fails > 0) process.exit(1);
