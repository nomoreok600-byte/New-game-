// World War 24/7 — Cinematic canvas renderer.
// Consumes the sim state (match) and draws the 1360x720 arena with:
// parallax biomes, weather, dynamic platforms, particle FX, fighter sprites,
// killfeed, damage numbers, slow-mo letterbox and chromatic-aberration flashes.

"use strict";

import { ARENA_W, ARENA_H, WEAPONS } from "./sim.js";

const W = 1360;
const H = 720;

const WEAPON_ICON = {
  knife: "🔪", katana: "⚔️", dual: "🔫", ar: "🔫", shotgun: "🔫", sniper: "🎯", rpg: "🚀",
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let weather = []; // ambient weather particles
  let lastBiome = null;
  let flashWhite = 0;

  function seedWeather(biome) {
    weather = [];
    const n = biome.weather === "rain" ? 130 : biome.weather === "snow" ? 110 : 90;
    for (let i = 0; i < n; i++) {
      weather.push({
        x: Math.random() * (W + 200) - 100,
        y: Math.random() * H,
        v: biome.weather === "rain" ? 700 + Math.random() * 300 : biome.weather === "snow" ? 40 + Math.random() * 50 : 120 + Math.random() * 160,
        s: biome.weather === "rain" ? 10 + Math.random() * 10 : 1.5 + Math.random() * 2.5,
        drift: Math.random() * 2 - 1,
      });
    }
  }

  function drawBackground(biome, t, thunder) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, biome.sky[0]);
    g.addColorStop(1, biome.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Parallax layers.
    ctx.save();
    const px = -match.camX * 0.05, py = -match.camY * 0.03;
    ctx.translate(px, py);
    ctx.globalAlpha = 0.5;
    if (biome.neon) {
      // Cyber skyline with lit windows.
      for (let i = 0; i < 14; i++) {
        const bw = 60 + ((i * 53) % 70), bh = 140 + ((i * 97) % 260);
        const bx = ((i * 103) % (W + 120)) - 60, by = H - bh - 40;
        ctx.fillStyle = "#0b0819";
        ctx.fillRect(bx, by, bw, bh);
        for (let wy = by + 10; wy < by + bh - 8; wy += 14) {
          for (let wx = bx + 6; wx < bx + bw - 8; wx += 12) {
            if ((wx * 7 + wy * 13 + i) % 5 < 2) {
              ctx.fillStyle = (wx + wy) % 2 ? "rgba(34,211,238,0.5)" : "rgba(217,70,239,0.45)";
              ctx.fillRect(wx, wy, 4, 6);
            }
          }
        }
      }
    } else if (biome.weather === "sand") {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "#3f2c12" : "#4d3816";
        const bx = ((i * 240) % W), bh = 90 + ((i * 61) % 130);
        ctx.fillRect(bx, H - bh - 30, 130, bh);
        ctx.fillRect(bx + 26, H - bh - 52, 78, 26);
      }
    } else {
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = biome.weather === "snow" ? "#0d1b2e" : "#061a10";
        const bx = (i * 210) % (W + 100) - 50, bh = 130 + ((i * 89) % 190);
        ctx.beginPath();
        ctx.moveTo(bx, H - 30);
        ctx.lineTo(bx + 110, H - bh - 30);
        ctx.lineTo(bx + 220, H - 30);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Thunder flash overlay (jungle storms).
    if (thunder > 0) {
      ctx.fillStyle = `rgba(220,235,255,${thunder * 0.75})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPlatforms(biome) {
    for (const p of match.platforms) {
      if (p.dead) {
        // Ghost outline of collapsed bridge.
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.setLineDash([6, 8]);
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = biome.platform;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(p.x, p.y, p.w, 3);
      if (p.bridge) {
        // Plank pattern + damage cracks.
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        for (let x = p.x + 18; x < p.x + p.w; x += 18) {
          ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
        }
        if (p.hp < 40) {
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.beginPath();
          ctx.moveTo(p.x + p.w * 0.3, p.y); ctx.lineTo(p.x + p.w * 0.36, p.y + p.h);
          ctx.moveTo(p.x + p.w * 0.66, p.y); ctx.lineTo(p.x + p.w * 0.6, p.y + p.h);
          ctx.stroke();
        }
      }
    }
  }

  function drawBarrels() {
    for (const b of match.barrels) {
      if (!b.alive) continue;
      ctx.fillStyle = "#b45309";
      ctx.fillRect(b.x - 12, b.y - 30, 24, 30);
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(b.x - 12, b.y - 22, 24, 4);
      ctx.fillRect(b.x - 12, b.y - 12, 24, 4);
      ctx.fillStyle = "#111";
      ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("⚠", b.x, b.y - 16);
    }
  }

  function drawFires(t) {
    for (const f of match.fires) {
      const a = Math.min(1, f.ttl / 1.5);
      const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(251,191,36,${0.35 * a})`);
      g.addColorStop(0.5, `rgba(249,115,22,${0.22 * a})`);
      g.addColorStop(1, "rgba(249,115,22,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawCrates(t) {
    for (const c of match.crates) {
      ctx.save();
      ctx.translate(c.x, c.y);
      if (c.para) {
        // Parachute.
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath(); ctx.arc(0, -46, 30, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.beginPath(); ctx.moveTo(-26, -46); ctx.lineTo(0, -8); ctx.moveTo(26, -46); ctx.lineTo(0, -8); ctx.stroke();
      }
      ctx.fillStyle = "#a16207";
      ctx.fillRect(-16, -16, 32, 32);
      ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2;
      ctx.strokeRect(-16, -16, 32, 32);
      ctx.beginPath(); ctx.moveTo(-16, -16); ctx.lineTo(16, 16); ctx.moveTo(16, -16); ctx.lineTo(-16, 16); ctx.stroke();
      ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const icon = c.kind === "turret" ? "🔧" : c.kind === "medkit" ? "✚" : WEAPON_ICON[c.kind] || "📦";
      ctx.fillStyle = "#fff";
      ctx.fillText(icon, 0, 0);
      ctx.restore();
    }
  }

  function drawTurrets(t) {
    for (const tur of match.turrets) {
      ctx.save();
      ctx.translate(tur.x, tur.y);
      ctx.fillStyle = "#334155";
      ctx.fillRect(-12, -12, 24, 14);
      ctx.fillStyle = tur.target ? "#ef4444" : "#64748b";
      ctx.beginPath(); ctx.arc(0, -12, 6, 0, Math.PI * 2); ctx.fill();
      const a = tur.target ? Math.atan2(tur.target.y - 20 - tur.y, tur.target.x - tur.x) : Math.sin(t * 2) * 0.6;
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(Math.cos(a) * 18, -12 + Math.sin(a) * 18); ctx.stroke();
      // Radar sweep line.
      ctx.strokeStyle = "rgba(239,68,68,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(Math.cos(a) * 90, -12 + Math.sin(a) * 90); ctx.stroke();
      ctx.restore();
    }
  }

  function drawFighter(f, t) {
    ctx.save();
    ctx.translate(f.x, f.y);

    // Stealth shimmer (guerilla perk) with a faint ghost outline so viewers
    // can still track the fighter.
    if (f.stealth) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = "rgba(34,211,238,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, -26, 22, 0, Math.PI * 2); ctx.stroke();
    }

    // Walk-cycle bob (readable, lively idle/motion).
    const bob = Math.sin(f.bobT) * 2 * Math.min(1, Math.abs(f.vx) / 90);

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 2, 16, 5, 0, 0, Math.PI * 2); ctx.fill();

    const lean = Math.max(-0.22, Math.min(0.22, f.vx / 1800));
    ctx.rotate(lean);
    if (f.deadT !== undefined && !f.alive) ctx.rotate(Math.min(1.5, f.deadT * 3)); // fall over
    const rolling = f.rollT > 0;
    ctx.translate(0, bob);

    // Legs with a proper stride cycle.
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 5; ctx.lineCap = "round";
    const stride = f.grounded && Math.abs(f.vx) > 30 ? Math.sin(f.bobT) * 8 : 0;
    const lift = f.grounded && Math.abs(f.vx) > 30 ? Math.abs(Math.cos(f.bobT)) * 2 : 0;
    ctx.beginPath(); ctx.moveTo(-4, -18); ctx.lineTo(-6 + stride, -2 - lift); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -18); ctx.lineTo(6 - stride, -2 - (lift > 0 ? 0 : lift)); ctx.stroke();

    // Body: national colors.
    const bodyGrad = ctx.createLinearGradient(-8, -40, 8, -16);
    bodyGrad.addColorStop(0, f.c1); bodyGrad.addColorStop(1, f.c2);
    ctx.fillStyle = rolling ? "#94a3b8" : bodyGrad;
    if (rolling) {
      ctx.beginPath(); ctx.arc(0, -12, 13, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-9, -38, 18, 22, 5);
      else ctx.rect(-9, -38, 18, 22);
      ctx.fill();
      // Flag sash.
      ctx.fillStyle = f.c2;
      ctx.fillRect(-9, -31, 18, 4);
      // Head.
      ctx.fillStyle = "#f5d0a9";
      ctx.beginPath(); ctx.arc(0, -46, 8.5, 0, Math.PI * 2); ctx.fill();
      // Helmet band in primary color.
      ctx.fillStyle = f.c1;
      ctx.beginPath(); ctx.arc(0, -48, 8.5, Math.PI, 0); ctx.fill();
      // Eyes look toward aim.
      const ex = Math.cos(f.aim) * 3, ey = Math.sin(f.aim) * 2;
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(ex + 2, -46 + ey, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex - 2, -46 + ey, 1.4, 0, Math.PI * 2); ctx.fill();
    }

    // Weapon + arms.
    if (f.alive) {
      const w = WEAPONS[f.weapon];
      ctx.save();
      ctx.translate(0, -28);
      ctx.rotate(f.aim);
      if (w.melee) {
        const sw = f.swing > 0 ? (0.18 - f.swing) / 0.18 : 0;
        ctx.rotate(-1.1 + sw * 2.2);
        ctx.strokeStyle = w.deflect ? "#e2e8f0" : "#cbd5e1";
        ctx.lineWidth = w.deflect ? 4 : 3;
        const len = w.range * 0.6;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8 + len, 0); ctx.stroke();
        if (f.swing > 0) {
          ctx.strokeStyle = `rgba(255,255,255,${f.swing / 0.18 * 0.5})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, w.range, -0.7, 0.7); ctx.stroke();
        }
      } else {
        ctx.fillStyle = "#0f172a";
        const barrelLen = f.weapon === "sniper" ? 30 : f.weapon === "rpg" ? 26 : f.weapon === "shotgun" ? 22 : 16;
        ctx.fillRect(6 - f.recoil * 5, -3, barrelLen, 6); // gun kicks back on fire
        if (f.weapon === "dual") { ctx.fillRect(2 - f.recoil * 4, -8, 14, 4); }
        if (f.weapon === "rpg") { ctx.fillStyle = "#dc2626"; ctx.fillRect(26 - f.recoil * 5, -5, 8, 10); }
        if (f.weapon === "sniper" && f.laserT > 0) {
          ctx.strokeStyle = "rgba(239,68,68,0.8)"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(1000, 0); ctx.stroke();
        }
      }
      // Katana deflection glint while the swing window is open.
      if (w.deflect && f.deflectT > 0) {
        ctx.strokeStyle = `rgba(226,232,240,${f.deflectT * 3})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 40, f.aim - 1.2, f.aim + 1.2); ctx.stroke();
      }
      ctx.restore();

      // Sniper laser sight (spec §4).
      if (f.weapon === "sniper" && f.laserT > 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(f.x, f.y - 28); ctx.lineTo(f.x + Math.cos(f.aim) * 1000, f.y - 28 + Math.sin(f.aim) * 1000); ctx.stroke();
      }
    }

    // Shield bubble (Heavy Armor).
    if (f.shield > 0) {
      ctx.strokeStyle = `rgba(148,163,184,${0.4 + 0.2 * Math.sin(t * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -28, 26, 0, Math.PI * 2); ctx.stroke();
    }
    // Hit flash.
    if (f.hitFlash > 0) {
      ctx.globalAlpha = Math.min(1, f.hitFlash * 4);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, -30, 20, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Nameplate + HP bar above head.
    if (!match.ended || !f.alive) {
      const alive = f.alive;
      ctx.save();
      ctx.translate(f.x, f.y - 78);
      ctx.globalAlpha = alive ? 1 : 0.45;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      const label = `${f.flag} ${f.name.toUpperCase()}`;
      ctx.strokeText(label, 0, 0); ctx.fillStyle = "#fff"; ctx.fillText(label, 0, 0);
      // HP bar.
      const bw = 64, hpFrac = Math.max(0, f.hp / f.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(-bw / 2, 5, bw, 6);
      ctx.fillStyle = hpFrac > 0.5 ? "#22c55e" : hpFrac > 0.25 ? "#f59e0b" : "#ef4444";
      ctx.fillRect(-bw / 2, 5, bw * hpFrac, 6);
      if (f.shield > 0) {
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(-bw / 2, 12, bw * Math.min(1, f.shield / 30), 3);
      }
      ctx.restore();
    }
  }

  // Bullet tracers: glowing streaks along velocity instead of static dots.
  function drawProjectiles() {
    for (const pr of match.projectiles) {
      if (pr.type === "rocket") {
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f97316";
        ctx.beginPath(); ctx.arc(pr.x - pr.vx * 0.012, pr.y - pr.vy * 0.012, 3, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      const len = Math.min(26, sp * 0.02);
      const tx = pr.x - (pr.vx / sp) * len, ty = pr.y - (pr.vy / sp) * len;
      const g = ctx.createLinearGradient(tx, ty, pr.x, pr.y);
      g.addColorStop(0, "rgba(253,224,71,0)");
      g.addColorStop(1, pr.owner === 2 ? "rgba(248,113,113,0.9)" : "rgba(253,230,138,0.95)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(pr.x, pr.y); ctx.stroke();
    }
  }

  // Muzzle flashes: short-lived directional light blobs.
  function drawFlashes() {
    for (const fl of match.flashes) {
      const a = fl.life / fl.maxLife;
      const g = ctx.createRadialGradient(fl.x, fl.y, 1, fl.x, fl.y, fl.size);
      g.addColorStop(0, `rgba(255,255,240,${0.95 * a})`);
      g.addColorStop(0.4, `rgba(253,224,71,${0.6 * a})`);
      g.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.size, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Expanding shockwave rings (hits, kills, explosions).
  function drawRings() {
    for (const rg of match.rings) {
      const a = Math.max(0, rg.life / rg.maxLife);
      ctx.strokeStyle = rg.color;
      ctx.globalAlpha = a * 0.85;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of match.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.type === "smoke") {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - a), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWeather(dt, biome) {
    for (const w of weather) {
      w.y += w.v * dt;
      w.x += w.drift * 30 * dt;
      if (biome.weather === "sand") w.x += w.v * dt * 0.9;
      if (w.y > H + 20) { w.y = -20; w.x = Math.random() * (W + 200) - 100; }
      if (w.x > W + 120) w.x = -100; if (w.x < -120) w.x = W + 100;
      if (biome.weather === "rain") {
        ctx.strokeStyle = "rgba(148,197,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(w.x - 3, w.y + w.s); ctx.stroke();
      } else if (biome.weather === "snow") {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath(); ctx.arc(w.x, w.y, w.s, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(217,169,90,0.28)";
        ctx.fillRect(w.x, w.y, w.s * 2, 1.6);
      }
    }
  }

  function drawFloatingTexts() {
    ctx.textAlign = "center";
    for (const ft of match.floating) {
      ctx.globalAlpha = Math.min(1, ft.life * 2);
      ctx.font = `900 ${ft.big ? 26 : 17}px system-ui, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
  }

  // ————— Main frame —————
  let match = null;
  let thunder = 0;
  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    if (!match) return;

    // Ambient lightning intensity decays.
    thunder = Math.max(0, thunder - dt * 2.2);

    // — Camera transform —
    const zoom = match.camZoom;
    const shakeX = (Math.random() - 0.5) * match.shake * 2;
    const shakeY = (Math.random() - 0.5) * match.shake * 2;
    ctx.save();
    ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
    ctx.scale(zoom, zoom);
    ctx.translate(-match.camX, -match.camY);

    drawBackground(match.biome, t, thunder);
    drawPlatforms(match.biome);
    drawFires(t);
    drawBarrels();
    drawCrates(t);
    drawTurrets(t);
    drawProjectiles();
    drawFlashes();
    for (const f of match.fighters) drawFighter(f, t);
    drawParticles();
    drawRings();
    drawFloatingTexts();
    ctx.restore();

    // Weather above world, screen-space.
    drawWeather(dt, match.biome);

    // Fog / vignette.
    if (match.biome.fog > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.35 + match.biome.fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // Hit flash.
    if (match.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${match.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    // Chromatic aberration flash on kills (spec §3).
    if (match.aberration > 0) {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(255,0,60,${match.aberration * 0.18})`;
      ctx.fillRect(-3, 0, W, H);
      ctx.fillStyle = `rgba(0,255,255,${match.aberration * 0.18})`;
      ctx.fillRect(3, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
    // Slow-mo letterbox (killcam).
    const lb = match.letterbox || 0;
    if (lb > 0) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, lb * 60);
      ctx.fillRect(0, H - lb * 60, W, lb * 60);
      if (lb > 0.3) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "900 22px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("⏱ KILLCAM", 28, 44);
      }
    }
    // Mode banner.
    if (match.camMode && !match.ended) {
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(`CAM: ${match.camMode}${match.timeScale < 1 ? ` · ${match.timeScale.toFixed(1)}x` : ""}`, W - 16, H - 14);
    }
  }

  return {
    setMatch(m) {
      match = m;
      if (m && m.biomeKey !== lastBiome) {
        lastBiome = m.biomeKey;
        seedWeather(m.biome);
      }
    },
    frame,
    getCtx: () => ctx,
    W, H,
  };
}
