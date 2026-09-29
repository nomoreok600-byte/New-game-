// World War 24/7 — Combat simulation (headless: renderer is separate).
// A match is fully described by plain data so it can run in any browser tab.
// updateMatch(match, dt) advances the world and emits events into match.events;
// render.js / show.js consume and clear that queue every frame.

"use strict";

import { WW_COUNTRIES } from "./countries.js";

export const ARENA_W = 1360;
export const ARENA_H = 720;
const GRAVITY = 2000;
const MOVE_SPEED = 252; // slower, deliberate movement (was 310)
const JUMP_VY = 720;
const FIGHTER_R = 15;

// Slow-cinematic pacing: fights breathe. Damage and fire rate are tuned so a
// 1v1 lasts 45–90s of combat inside a 100–150s budget.
const DMG_SCALE = 0.55;
const CD_SCALE = 1.45;

// ————— Weapons (spec §4) —————
export const WEAPONS = {
  knife: { name: "Tactical Knife", cls: "Melee", melee: true, dmg: 34, cooldown: 0.5, range: 62, arc: 1.4, drop: 0 },
  katana: { name: "Katana", cls: "Melee", melee: true, dmg: 52, cooldown: 0.62, range: 88, arc: 1.9, deflect: true, drop: 0.15 },
  dual: { name: "Dual Guns", cls: "Pistol", dmg: 11, cooldown: 0.16, range: 430, speed: 1150, spread: 0.09, drop: 0 },
  ar: { name: "Assault Rifle", cls: "Rifle", dmg: 14, cooldown: 0.115, range: 560, speed: 1400, spread: 0.05, drop: 0.30 },
  shotgun: { name: "Heavy Shotgun", cls: "Shotgun", dmg: 9, pellets: 7, cooldown: 0.95, range: 330, speed: 1050, spread: 0.22, shake: 1, drop: 0.20 },
  sniper: { name: "Railgun Sniper", cls: "Sniper", dmg: 62, cooldown: 1.7, range: 980, speed: 2600, spread: 0.008, pierce: 2, laser: true, drop: 0.10 },
  rpg: { name: "RPG Launcher", cls: "Heavy", dmg: 55, cooldown: 2.2, range: 800, speed: 520, rocket: true, drop: 0.05 },
  medkit: { name: "Tactical Medkit", cls: "Support", drop: 0.20, heal: 40 },
};

const DROP_POOL = ["katana", "ar", "shotgun", "sniper", "rpg", "medkit"];
const DROP_WEIGHT = DROP_POOL.map((k) => WEAPONS[k].drop);

function pickDrop(rng) {
  const total = DROP_WEIGHT.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < DROP_POOL.length; i++) {
    r -= DROP_WEIGHT[i];
    if (r <= 0) return DROP_POOL[i];
  }
  return "medkit";
}

// ————— Biomes & weather (spec §3) —————
export const BIOMES = {
  jungle: {
    name: "Tropical Jungle", sky: ["#0a2f1b", "#123f24"], ground: "#173d21", platform: "#1e4d2b",
    accent: "#34d399", weather: "rain", thunder: true, ice: false, fog: 0.12, emoji: "🌿",
  },
  desert: {
    name: "Desert Ruins", sky: ["#5b3a17", "#8a5a24"], ground: "#7c5a2e", platform: "#946c38",
    accent: "#fbbf24", weather: "sand", thunder: false, ice: false, fog: 0.2, emoji: "🏜️",
  },
  cyber: {
    name: "Cyber City (Night)", sky: ["#05010f", "#120b2e"], ground: "#0c0a1c", platform: "#191434",
    accent: "#22d3ee", weather: "rain", thunder: false, ice: false, fog: 0.18, neon: true, emoji: "🌃",
  },
  snow: {
    name: "Snowy Mountain", sky: ["#16283f", "#28405e"], ground: "#d7e4f2", platform: "#eef5fd",
    accent: "#93c5fd", weather: "snow", thunder: false, ice: true, fog: 0.15, emoji: "🏔️",
  },
};

const BIOME_KEYS = Object.keys(BIOMES);

// ————— Small helpers —————
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

function rectSegHit(x1, y1, x2, y2, r) {
  // Returns true if segment crosses rect r (AABB). Cheap slab test.
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[x1, dx, r.x, r.x + r.w], [y1, dy, r.y, r.y + r.h]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function hasLOS(match, x1, y1, x2, y2) {
  for (const p of match.platforms) if (!p.dead && rectSegHit(x1, y1, x2, y2, p)) return false;
  return true;
}

function grounded(match, f) {
  for (const p of match.platforms) {
    if (p.dead) continue;
    if (f.x >= p.x - 2 && f.x <= p.x + p.w + 2 && Math.abs(f.y - p.y) < 6) return true;
  }
  return false;
}

// ————— Match creation —————
function makePlatforms(biomeKey, rng) {
  const plats = [{ x: 0, y: ARENA_H - 70, w: ARENA_W, h: 70, ground: true }];
  const cols = { jungle: 5, desert: 4, cyber: 6, snow: 5 }[biomeKey];
  for (let i = 0; i < cols; i++) {
    const w = 130 + Math.floor(rng() * 180);
    const x = 90 + (i * (ARENA_W - 260)) / cols + rng() * 70;
    const y = ARENA_H - 150 - Math.floor(rng() * 3) * 130;
    plats.push({ x, y, w, h: 18, bridge: biomeKey !== "cyber" && rng() < 0.3 });
  }
  return plats;
}

function country(code) { return WW_COUNTRIES.find((c) => c.code === code); }

function makeFighter(c, side) {
  const perk = c.perk;
  return {
    code: c.code, name: c.name, flag: c.flag, c1: c.c1, c2: c.c2, side,
    perk,
    x: side === 0 ? 160 : ARENA_W - 160,
    y: ARENA_H - 100,
    vx: 0, vy: 0,
    hp: 100, maxHp: 100,
    shield: perk === "Heavy Armor" ? 30 : 0,
    weapons: { primary: "dual", melee: "knife" },
    weapon: "dual",
    cd: 0, swing: 0, swingDir: 1, deflectT: 0,
    aim: side === 0 ? 0 : Math.PI,
    grounded: false, jumps: 0,
    decisionT: 0, goalX: null, jumpT: 0,
    rollT: 0, rollCd: 0, rollDir: 1,
    stillT: 0, stealth: false,
    dmgDealt: 0,
    kills: 0,
    alive: true,
    deadT: 0,
    hitFlash: 0,
    laserT: 0,
    recoil: 0, // gun kick animation
    bobT: Math.random() * 10, // walk-cycle phase
  };
}

export function createMatch(codeA, codeB, opts = {}) {
  const rng = opts.rng || Math.random;
  const biomeKey = opts.biome || BIOME_KEYS[Math.floor(rng() * BIOME_KEYS.length)];
  const biome = BIOMES[biomeKey];
  const platforms = makePlatforms(biomeKey, rng);

  const match = {
    codeA, codeB, biomeKey, biome, platforms,
    fighters: [makeFighter(country(codeA), 0), makeFighter(country(codeB), 1)],
    projectiles: [], particles: [], crates: [], turrets: [], barrels: [], fires: [],
    flashes: [], // muzzle flashes (transient light)
    rings: [], // impact/explosion shockwave rings
    time: 0, fightBudget: opts.fightSeconds || 100 + Math.floor(rng() * 51), // 100–150s slow pacing
    drops: [], napalm: [],
    events: [],
    timeScale: 1, slowmoT: 0,
    winner: null, method: null, durationS: 0, killsA: 0, killsB: 0,
    camX: ARENA_W / 2, camY: ARENA_H / 2, camZoom: 0.9, camMode: "WIDE",
    shake: 0, shakeAngle: 0, flash: 0, thunderT: 3 + rng() * 6,
    intensity: 0,
    ended: false, endT: 0,
    rng,
  };

  // Destructible bridges get hit points.
  for (const p of platforms) if (p.bridge) p.hp = 60;

  // Explosive barrels (spec §4): 2–4 per arena.
  const barrelN = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < barrelN; i++) {
    const p = platforms[Math.floor(rng() * platforms.length)];
    match.barrels.push({ x: p.x + 30 + rng() * (p.w - 60), y: p.y, alive: true });
  }

  // Air drop schedule across the fight window (spec §4).
  const dropN = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < dropN; i++) {
    match.drops.push({ at: 8 + ((i + rng()) / dropN) * (match.fightBudget - 24), kind: rng() < 0.15 ? "turret" : pickDrop(rng), done: false });
  }
  // Napalm auto-drops.
  const napN = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < napN; i++) match.napalm.push({ at: 18 + rng() * (match.fightBudget - 36), done: false });

  return match;
}

const preferredRange = {
  knife: 50, katana: 66, dual: 300, ar: 380, shotgun: 140, sniper: 640, rpg: 460,
};

// ————— AI —————
function decideGoal(match, f, foe) {
  const rng = match.rng;
  const pref = preferredRange[f.weapon] || 300;
  const lowHp = f.hp < 35;

  // Grab nearby crates if the upgrade is worth it.
  let bestCrate = null, bestD = 1e9;
  for (const c of match.crates) {
    if (!c.landed || c.taken) continue;
    const d = dist(f.x, f.y, c.x, c.y);
    const upgrade = c.kind === "medkit" ? f.hp < 70 : c.kind !== f.weapon;
    if (upgrade && d < bestD) { bestD = d; bestCrate = c; }
  }
  if (bestCrate && bestD < 460 && (bestCrate.kind === "medkit" || rng() < 0.75)) {
    f.goalX = bestCrate.x;
    f.goalY = bestCrate.y;
    return;
  }

  const dx = foe.x - f.x;
  const want = pref + (rng() - 0.5) * 120;
  const dir = Math.abs(dx) > want ? Math.sign(dx) : (rng() < 0.5 ? -1 : 1) * (Math.abs(dx) > 90 ? 1 : -1);
  f.goalX = clamp(foe.x - dir * want, 40, ARENA_W - 40);
  f.goalY = foe.y;
  if (lowHp && f.perk !== "Berserker" && rng() < 0.5) {
    f.goalX = clamp(f.x - Math.sign(dx) * 260, 40, ARENA_W - 40); // retreat & heal up
  }
}

function fighterAI(match, f, foe, dt) {
  const rng = match.rng;
  f.decisionT -= dt;
  const canSee = !foe.stealth || dist(f.x, f.y, foe.x, foe.y) < 160;

  if (f.decisionT <= 0) {
    f.decisionT = 0.3 + rng() * 0.35; // slower, more readable AI reactions
    if (canSee) decideGoal(match, f, foe);
  }

  // Movement toward goal.
  if (f.rollT <= 0) {
    const gx = canSee ? f.goalX ?? foe.x : f.x + Math.sin(match.time * 2 + f.side) * 60;
    const dx = gx - f.x;
    if (Math.abs(dx) > 12) f.vx = Math.sign(dx) * MOVE_SPEED * (match.biome.ice ? 0.75 : 1);
    else f.vx *= 0.7;
  }

  // Jump if the foe or goal is higher and we're grounded.
  if (f.grounded && (foe.y < f.y - 60 || (f.goalY != null && f.goalY < f.y - 60)) && rng() < 0.09) {
    f.vy = -JUMP_VY;
    match.events.push({ t: "jump", x: f.x, y: f.y });
  }

  // Dodge roll when a projectile is incoming (guerilla perk: +15% distance, spec §4).
  f.rollCd -= dt;
  if (f.rollT <= 0 && f.rollCd <= 0) {
    for (const pr of match.projectiles) {
      if (pr.owner === foe.side && pr.type !== "rocket") {
        const closing = (foe.x - f.x) * pr.vx + (foe.y - f.y) * pr.vy;
        if (closing < 0 && dist(pr.x, pr.y, f.x, f.y) < 240) {
          f.rollT = 0.28 * (f.perk === "Guerilla Warfare" ? 1.15 : 1);
          f.rollDir = rng() < 0.5 ? -1 : 1;
          f.rollCd = 2.6 + rng() * 2;
          f.vy = Math.min(f.vy, -260);
          match.events.push({ t: "roll", x: f.x, y: f.y });
          break;
        }
      }
    }
  }

  // Guerilla stealth: stationary 2s → invisible until moving/attacking (spec §4).
  if (Math.abs(f.vx) < 20 && f.grounded && f.rollT <= 0) f.stillT += dt;
  else { f.stillT = 0; f.stealth = false; }
  if (f.perk === "Guerilla Warfare" && f.stillT > 2) f.stealth = true;

  // Aiming & firing.
  f.cd -= dt;
  const w = WEAPONS[f.weapon];
  const d = dist(f.x, f.y, foe.x, foe.y);
  const vision = (f.weapon === "sniper" ? 1.25 : 1) * (f.perk === "Sharpshooter" ? 1.15 : 1);
  const inRange = d < w.range * vision;
  const los = f.stealth || hasLOS(match, f.x, f.y - 20, foe.x, foe.y - 20);

  if (canSee && inRange && los && f.cd <= 0 && f.rollT <= 0) {
    const aimJitter = foe.stealth ? 0.9 : 0;
    f.aim = Math.atan2(foe.y - 20 - (f.y - 20), foe.x - f.x) + (rng() - 0.5) * aimJitter;
    fire(match, f, foe);
  } else if (canSee) {
    f.aim = Math.atan2(foe.y - 20 - (f.y - 20), foe.x - f.x);
  }
  if (f.weapon === "sniper" && canSee && los) f.laserT = 0.12;
}

function fire(match, f, foe) {
  const w = WEAPONS[f.weapon];
  f.cd = w.cooldown * CD_SCALE * (0.92 + match.rng() * 0.16); // slower fire rate for pacing
  f.recoil = 1;
  const sharp = f.perk === "Sharpshooter" ? 0.85 : 1; // +15% accuracy (spec §4)
  const berserk = f.perk === "Berserker" && f.hp < 30 ? 1.25 : 1;
  const sx = f.x + Math.cos(f.aim) * 24;
  const sy = f.y - 20 + Math.sin(f.aim) * 24;

  if (w.melee) {
    f.swing = 0.18; f.swingDir = f.x < foe.x ? 1 : -1;
    if (w.deflect) f.deflectT = 0.22;
    // Melee hit check: arc around the fighter.
    const d = dist(f.x, f.y, foe.x, foe.y);
    const ang = Math.atan2(foe.y - f.y, foe.x - f.x);
    const rel = Math.abs(((ang - f.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < w.range + FIGHTER_R && rel < w.arc / 2) {
      damage(match, foe, f, w.dmg * DMG_SCALE * berserk, f.weapon === "katana" ? "SLASHED" : "KNIFED");
      match.rings.push({ x: foe.x, y: foe.y - 20, r: 4, maxR: 44, life: 0.35, maxLife: 0.35, color: "#fff" });
    }
    match.events.push({ t: "swing", x: f.x, y: f.y - 20, dir: f.swingDir, weapon: f.weapon, c: f.c1 });
    return;
  }

  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const spread = (w.spread || 0) * sharp * (f.grounded ? 1 : 1.6) * (f.stealth ? 1.4 : 1);
    const a = f.aim + (match.rng() - 0.5) * spread * 2;
    match.projectiles.push({
      x: sx, y: sy,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      owner: f.side, dmg: w.dmg * berserk, life: w.range / w.speed + 0.15,
      type: w.rocket ? "rocket" : "bullet",
      pierce: w.pierce || 0,
    });
  }
  match.events.push({
    t: "muzzle", x: sx, y: sy, weapon: f.weapon, dir: f.aim,
    shake: w.shake || 0, c: f.c1,
  });
  // Muzzle flash: a short-lived directional light at the barrel.
  if (!w.melee) {
    match.flashes.push({ x: sx, y: sy, dir: f.aim, life: 0.09, maxLife: 0.09, size: w.rocket ? 26 : w.cls === "Shotgun" ? 24 : 16, color: w.rocket ? "#fbbf24" : "#fde68a" });
  }
  // Shell casing particle.
  match.particles.push({ x: sx, y: sy, vx: -Math.cos(f.aim) * 90 + (match.rng() - 0.5) * 60, vy: -140 - match.rng() * 80, life: 0.7, maxLife: 0.7, color: "#d4a017", size: 2.4, grav: 1, type: "casing" });
}

function damage(match, target, source, amount, method) {
  if (!target.alive) return;
  let dmg = amount;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
    if (target.shield <= 0) match.events.push({ t: "shieldbreak", x: target.x, y: target.y - 30 });
  }
  target.hp -= dmg * DMG_SCALE; // slow-cinematic pacing: hits feel weighty, fights last
  target.hitFlash = 0.18;
  if (source) source.dmgDealt += amount;
  const dealt = dmg * DMG_SCALE;
  const blood = target.hp <= 0 ? 16 : 7;
  for (let i = 0; i < blood; i++) {
    const a = match.rng() * Math.PI * 2, s = 60 + match.rng() * 220;
    match.particles.push({ x: target.x, y: target.y - 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + match.rng() * 0.4, maxLife: 0.9, color: match.rng() < 0.75 ? "#b91c1c" : "#7f1d1d", size: 2 + match.rng() * 3, grav: 1, type: "blood" });
  }
  match.events.push({ t: "hit", x: target.x, y: target.y - 24, dmg: Math.round(dealt), by: source ? source.side : -1, on: target.side, c: target.c1, headshot: method === "RAILED" });
  // Impact shockwave ring on every hit; bigger for heavy weapons.
  const ringR = method === "RAILED" ? 54 : amount >= 20 ? 40 : 26;
  match.rings.push({ x: target.x, y: target.y - 20, r: 3, maxR: ringR, life: 0.3, maxLife: 0.3, color: method === "RAILED" ? "#f87171" : "#fde68a" });
  match.intensity = Math.min(1, match.intensity + 0.12);

  if (target.hp <= 0) killFighter(match, target, source, method);
}

function killFighter(match, victim, killer, method) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.deadT = 0;
  if (killer && killer !== victim) {
    killer.kills++;
    if (killer.side === 0) match.killsA++;
    else match.killsB++;
  }
  // Dramatic elimination shockwave.
  match.rings.push({ x: victim.x, y: victim.y - 20, r: 6, maxR: 130, life: 0.7, maxLife: 0.7, color: "#f87171" });
  match.rings.push({ x: victim.x, y: victim.y - 20, r: 2, maxR: 70, life: 0.5, maxLife: 0.5, color: "#fff" });
  const methods = { KNIFED: "KNIFED", SLASHED: "SLASHED", BLOWN_UP: "BLOWN UP", BURNED: "BURNED BY NAPALM", TURRET: "TURRET", TIME_LIMIT: "TIME LIMIT" };
  match.pendingKill = { victim: victim.side, killer: killer ? killer.side : -1, method: methods[method] || "GUNNED DOWN", x: victim.x, y: victim.y };
  // Slower killcam: hold the freeze longer.
  match.events.push({ t: "kill", x: victim.x, y: victim.y - 20, victim: victim.side, killer: killer ? killer.side : -1, c: victim.c1, method: methods[method] || "GUNNED DOWN" });
  match.shake = Math.max(match.shake, 14);
  match.flash = 0.5;
  match.slowmoT = 2.1; // longer dramatic killcam (spec §3, 0.2x time)
  match.timeScale = 0.2;
  for (let i = 0; i < 26; i++) {
    const a = match.rng() * Math.PI * 2, s = 80 + match.rng() * 300;
    match.particles.push({ x: victim.x, y: victim.y - 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.7 + match.rng() * 0.6, maxLife: 1.3, color: match.rng() < 0.8 ? "#991b1b" : "#450a0a", size: 2.5 + match.rng() * 4, grav: 1, type: "blood" });
  }
}

function explode(match, x, y, radius, dmg, source, method) {
  match.events.push({ t: "explosion", x, y, r: radius });
  match.shake = Math.max(match.shake, 16);
  match.intensity = Math.min(1, match.intensity + 0.3);
  match.rings.push({ x, y, r: 8, maxR: radius * 1.2, life: 0.5, maxLife: 0.5, color: "#fbbf24" });
  for (let i = 0; i < 34; i++) {
    const a = match.rng() * Math.PI * 2, s = 80 + match.rng() * 380;
    const fire = match.rng() < 0.5;
    match.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.4 + match.rng() * 0.7, maxLife: 1.1, color: fire ? (match.rng() < 0.5 ? "#f97316" : "#fbbf24") : "#57534e", size: 3 + match.rng() * 6, grav: fire ? 0.25 : 0.7, type: fire ? "spark" : "smoke" });
  }
  for (const f of match.fighters) {
    if (!f.alive) continue;
    const d = dist(x, y, f.x, f.y - 20);
    if (d < radius) {
      const falloff = 1 - d / radius;
      const kb = 320 * falloff * (f.perk === "Heavy Armor" ? 0.55 : 1);
      const a = Math.atan2(f.y - y, f.x - x);
      f.vx += Math.cos(a) * kb;
      f.vy += Math.sin(a) * kb - 180 * falloff;
      damage(match, f, source, dmg * falloff, method || "BLOWN_UP");
    }
  }
  for (const b of match.barrels) {
    if (b.alive && dist(x, y, b.x, b.y) < radius * 0.8) igniteBarrel(match, b, source);
  }
  // Destructible bridges (spec §4).
  for (const p of match.platforms) {
    if (p.dead || !p.bridge) continue;
    const cx = clamp(x, p.x, p.x + p.w), cy = clamp(y, p.y, p.y + p.h);
    if (dist(x, y, cx, cy) < radius) {
      p.hp -= dmg * 1.4;
      if (p.hp <= 0) {
        p.dead = true;
        match.events.push({ t: "collapse", x: p.x + p.w / 2, y: p.y, w: p.w });
        for (let i = 0; i < 18; i++) {
          match.particles.push({ x: p.x + match.rng() * p.w, y: p.y + match.rng() * p.h, vx: (match.rng() - 0.5) * 120, vy: match.rng() * 200, life: 0.8 + match.rng() * 0.5, maxLife: 1.3, color: match.biome.platform, size: 4 + match.rng() * 5, grav: 1, type: "debris" });
        }
      }
    }
  }
}

function igniteBarrel(match, b, source) {
  if (!b.alive) return;
  b.alive = false;
  explode(match, b.x, b.y - 12, 150, 58, source, "BLOWN_UP");
}

function spawnFire(match, x, y) {
  match.fires.push({ x, y, r: 92, ttl: 6.5 });
  match.events.push({ t: "napalm", x, y, r: 92 });
}

// ————— Core update —————
export function updateMatch(match, rawDt) {
  if (match.ended) {
    match.endT += rawDt;
    return;
  }
  // Slow-mo killcam (spec §3): timeScale ramps back to 1.
  if (match.slowmoT > 0) {
    match.slowmoT -= rawDt;
    if (match.slowmoT <= 0) match.timeScale = 1;
  }
  const dt = rawDt * match.timeScale;
  match.time += dt;
  const rng = match.rng;
  const [fa, fb] = match.fighters;

  // Scheduled airdrops & napalm.
  for (const d of match.drops) {
    if (!d.done && match.time >= d.at) {
      d.done = true;
      match.crates.push({ x: 120 + rng() * (ARENA_W - 240), y: -40, vy: 130, kind: d.kind, landed: false, taken: false, para: true });
      match.events.push({ t: "crate", x: match.crates[match.crates.length - 1].x });
    }
  }
  for (const n of match.napalm) {
    if (!n.done && match.time >= n.at) {
      n.done = true;
      const target = match.fighters[Math.floor(rng() * 2)];
      spawnFire(match, clamp(target.x + (rng() - 0.5) * 300, 80, ARENA_W - 80), ARENA_H - 78);
      match.events.push({ t: "napalmincoming" });
    }
  }

  // Fighters.
  for (const f of match.fighters) {
    if (!f.alive) { f.deadT += dt; continue; }

    // Physics.
    f.rollT -= dt;
    f.hitFlash -= dt;
    f.laserT -= dt;
    f.deflectT -= dt;
    if (f.swing > 0) f.swing -= dt;
    if (f.rollT > 0) {
      f.vx = f.rollDir * MOVE_SPEED * 2.1;
    }
    f.vy += GRAVITY * dt * (f.grounded && match.biome.ice ? 0.6 : 1);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.x = clamp(f.x, FIGHTER_R + 4, ARENA_W - FIGHTER_R - 4);

    // Platform landing (one-way from above).
    f.grounded = false;
    for (const p of match.platforms) {
      if (p.dead) continue;
      if (f.x >= p.x - 4 && f.x <= p.x + p.w + 4 && f.vy >= 0 && f.y >= p.y - 2 && f.y <= p.y + 34) {
        f.y = p.y;
        f.vy = 0;
        f.grounded = true;
      }
    }
    if (f.y > ARENA_H + 80) { f.y = ARENA_H - 76; f.vy = 0; } // safety net

    const foe = f.side === 0 ? fb : fa;
    if (foe.alive) fighterAI(match, f, foe, dt);

    // Fire zones burn (spec §4).
    for (const fire of match.fires) {
      if (dist(f.x, f.y, fire.x, fire.y) < fire.r && Math.abs(f.y - fire.y) < 90) {
        if (rng() < dt * 2.2) damage(match, f, null, 4, "BURNED");
        if (rng() < dt * 6) match.particles.push({ x: f.x + (rng() - 0.5) * 30, y: f.y - rng() * 30, vx: (rng() - 0.5) * 30, vy: -90 - rng() * 80, life: 0.5, maxLife: 0.5, color: rng() < 0.5 ? "#f97316" : "#fbbf24", size: 3 + rng() * 4, grav: -0.2, type: "spark" });
      }
    }
  }

  // Projectiles.
  for (const pr of match.projectiles) {
    pr.life -= dt;
    if (pr.type === "rocket") {
      // Rocket smoke trail (spec §3 particles).
      match.particles.push({ x: pr.x, y: pr.y, vx: (rng() - 0.5) * 40, vy: (rng() - 0.5) * 40, life: 0.45, maxLife: 0.45, color: "#78716c", size: 4 + rng() * 4, grav: -0.1, type: "smoke" });
      pr.vy += 140 * dt; // slight arc
    }
    const px = pr.x, py = pr.y;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    // Katana deflection (spec §4): bullets reflect back during swing window.
    const foe = match.fighters[1 - pr.owner];
    if (foe && foe.alive && foe.deflectT > 0 && dist(pr.x, pr.y, foe.x, foe.y - 20) < 70 && pr.type === "bullet") {
      pr.vx *= -1.15; pr.vy *= -1.15;
      pr.owner = foe.side;
      pr.dmg *= 1.2;
      match.events.push({ t: "deflect", x: pr.x, y: pr.y });
      continue;
    }

    // Fighter hits.
    for (const f of match.fighters) {
      if (!f.alive || f.side === pr.owner) continue;
      if (dist(pr.x, pr.y, f.x, f.y - 20) < FIGHTER_R + 6) {
        const src = match.fighters[pr.owner] || null;
        if (pr.type === "rocket") {
          explode(match, pr.x, pr.y, 150, pr.dmg, src, "BLOWN_UP");
          pr.life = -1;
        } else {
          const method = src && src.weapon === "sniper" ? "RAILED" : src ? "GUNNED DOWN" : "TURRET";
          damage(match, f, src, pr.dmg, method);
          match.shake = Math.max(match.shake, pr.dmg > 30 ? 7 : 2.5);
          pr.life = -1;
          if (pr.pierce > 0) { pr.pierce--; pr.life = 0.2; }
        }
        break;
      }
    }

    // Barrel hits.
    for (const b of match.barrels) {
      if (b.alive && dist(pr.x, pr.y, b.x, b.y - 12) < 22) {
        igniteBarrel(match, b, match.fighters[pr.owner]);
        pr.life = -1;
        break;
      }
    }

    // Platform collisions.
    if (pr.life > 0 && pr.type !== "rocket") {
      for (const p of match.platforms) {
        if (p.dead) continue;
        if (pr.x > p.x && pr.x < p.x + p.w && pr.y > p.y && pr.y < p.y + p.h) {
          pr.life = -1;
          for (let i = 0; i < 4; i++) match.particles.push({ x: pr.x, y: pr.y, vx: (rng() - 0.5) * 160, vy: (rng() - 0.8) * 160, life: 0.25, maxLife: 0.25, color: match.biome.accent, size: 1.6 + rng() * 2, grav: 0.6, type: "spark" });
          break;
        }
      }
    }
  }
  match.projectiles = match.projectiles.filter((p) => p.life > 0);

  // Crates fall & get picked up (spec §4).
  for (const c of match.crates) {
    if (c.taken) continue;
    if (!c.landed) {
      c.y += c.vy * dt;
      const groundY = ARENA_H - 76;
      let landY = groundY;
      for (const p of match.platforms) {
        if (p.dead || p.ground) continue;
        if (c.x >= p.x && c.x <= p.x + p.w && c.y >= p.y - 4 && c.y <= p.y + 30) landY = p.y;
      }
      if (c.y >= landY) { c.y = landY; c.landed = true; c.para = false; }
    }
    for (const f of match.fighters) {
      if (!f.alive || !c.landed) continue;
      if (dist(f.x, f.y, c.x, c.y) < 42) {
        c.taken = true;
        if (c.kind === "turret") {
          match.turrets.push({ x: c.x, y: c.y, cd: 0.5, owner: f.side, target: null });
          match.events.push({ t: "turret", x: c.x, y: c.y, owner: f.side });
        } else if (c.kind === "medkit") {
          f.hp = Math.min(f.maxHp, f.hp + WEAPONS.medkit.heal);
          match.events.push({ t: "heal", x: f.x, y: f.y - 40, amount: WEAPONS.medkit.heal });
        } else {
          f.weapon = c.kind;
          match.events.push({ t: "pickup", x: f.x, y: f.y - 40, weapon: c.kind, side: f.side });
        }
      }
    }
  }
  match.crates = match.crates.filter((c) => !c.taken);

  // Auto turrets (spec §4): shoot the first fighter crossing the radar line.
  for (const tur of match.turrets) {
    tur.cd -= dt;
    let best = null, bestD = 640;
    for (const f of match.fighters) {
      if (!f.alive || f.stealth) continue;
      const d = dist(tur.x, tur.y, f.x, f.y);
      if (d < bestD && hasLOS(match, tur.x, tur.y, f.x, f.y - 20)) { best = f; bestD = d; }
    }
    tur.target = best;
    if (best && tur.cd <= 0) {
      tur.cd = 0.55;
      const a = Math.atan2(best.y - 20 - tur.y, best.x - tur.x) + (rng() - 0.5) * 0.1;
      match.projectiles.push({ x: tur.x, y: tur.y - 14, vx: Math.cos(a) * 1200, vy: Math.sin(a) * 1200, owner: 2, dmg: 9, life: 0.6, type: "bullet", pierce: 0 });
      match.events.push({ t: "turretshot", x: tur.x, y: tur.y - 14, dir: a });
    }
  }

  // Fire zones tick down.
  for (const fire of match.fires) {
    fire.ttl -= dt;
    if (rng() < dt * 22) match.particles.push({ x: fire.x + (rng() - 0.5) * fire.r * 1.6, y: fire.y - rng() * 20, vx: (rng() - 0.5) * 20, vy: -80 - rng() * 120, life: 0.4 + rng() * 0.4, maxLife: 0.8, color: rng() < 0.5 ? "#f97316" : "#facc15", size: 3 + rng() * 5, grav: -0.25, type: "spark" });
  }
  match.fires = match.fires.filter((f) => f.ttl > 0);

  // Transient FX: muzzle flashes & expanding shockwave rings.
  for (const fl of match.flashes) fl.life -= dt;
  match.flashes = match.flashes.filter((fl) => fl.life > 0);
  for (const rg of match.rings) {
    rg.life -= dt;
    rg.r += (rg.maxR - rg.r) * Math.min(1, dt * 9);
  }
  match.rings = match.rings.filter((rg) => rg.life > 0);
  // Recoil & walk-cycle phase decay.
  for (const f of match.fighters) {
    f.recoil = Math.max(0, f.recoil - dt * 6);
    f.bobT += dt * Math.abs(f.vx) / 55;
  }

  // Particles.
  for (const p of match.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += GRAVITY * 0.55 * (p.grav ?? 1) * dt;
    p.vx *= 1 - 1.6 * dt;
  }
  if (match.particles.length > 900) match.particles.splice(0, match.particles.length - 900);
  match.particles = match.particles.filter((p) => p.life > 0);

  // Thunder flashes (jungle biome, spec §3).
  match.thunderT -= dt;
  if (match.thunderT <= 0) {
    match.thunderT = 6 + rng() * 9;
    if (match.biome.thunder) match.events.push({ t: "thunder" });
  }

  // Director camera (spec §3): CLOSE / WIDE / KILLCAM.
  updateCamera(match, dt, rawDt);

  // Death resolution: first death ends the match (1v1 single elim).
  if (match.pendingKill && !match.ended) {
    const victim = match.fighters[match.pendingKill.victim];
    if (victim && !victim.alive) {
      const other = match.fighters[1 - match.pendingKill.victim];
      resolveMatch(match, other.alive ? other : victim, match.pendingKill.method);
    }
  }

  // Time limit: higher HP% wins (spec: fight phase 50–70s).
  if (!match.ended && match.time >= match.fightBudget) {
    const [a, b] = match.fighters;
    const pa = (a.hp + a.shield) / (a.maxHp + 30), pb = (b.hp + b.shield) / (b.maxHp + 30);
    resolveMatch(match, pa >= pb ? a : b, "TIME LIMIT");
  }

  match.intensity = Math.max(0, match.intensity - dt * 0.25);
  match.shake = Math.max(0, match.shake - dt * 30);
  match.flash = Math.max(0, match.flash - dt * 2);
  match.durationS = match.time;
}

function updateCamera(match, dt, rawDt) {
  const [a, b] = match.fighters;
  const dead = match.fighters.find((f) => !f.alive);
  let mode = "WIDE", zoom = 0.9, tx, ty;

  if (match.slowmoT > 0 && dead) {
    // KILLCAM: dramatic zoom on the final hit (spec §3).
    mode = "KILLCAM";
    zoom = 1.85;
    tx = dead.x; ty = dead.y - 30;
  } else {
    const d = dist(a.x, a.y, b.x, b.y);
    if (d < 260) {
      mode = "CLOSE"; zoom = 1.4; // CLOSE-QUARTERS (spec §3)
    } else if (a.weapon === "sniper" || b.weapon === "sniper" || d > 700) {
      mode = "DUEL"; zoom = 0.82; // LONG-RANGE DUEL
    } else {
      mode = "WIDE"; zoom = 1.0;
    }
    tx = (a.x + b.x) / 2;
    ty = (a.y + b.y) / 2 - 40;
  }

  const halfW = ARENA_W / 2 / zoom, halfH = ARENA_H / 2 / zoom;
  tx = clamp(tx, halfW, ARENA_W - halfW);
  ty = clamp(ty, halfH, ARENA_H - halfH);

  const lerpK = 1 - Math.pow(0.0015, rawDt);
  match.camX += (tx - match.camX) * lerpK;
  match.camY += (ty - match.camY) * lerpK;
  match.camZoom += (zoom - match.camZoom) * (1 - Math.pow(0.02, rawDt));
  match.camMode = mode;
}

function resolveMatch(match, winnerF, method) {
  match.ended = true;
  match.winner = winnerF.side;
  match.winnerCode = winnerF.side === 0 ? match.codeA : match.codeB;
  match.method = method;
  match.durationS = Math.round(match.time);
  match.events.push({ t: "end", winner: winnerF.side, method });
}
