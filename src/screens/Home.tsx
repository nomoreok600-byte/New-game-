import { useState } from "react";
import { ACHIEVEMENTS } from "../game/achievements";
import { dailyChallengeFor, dailyKey } from "../game/engine";
import {
  IconClose,
  IconFlame,
  IconGear,
  IconHelp,
  IconHourglass,
  IconPlay,
} from "../components/Icons";
import type { ProfileLike } from "./Game";

export default function Home({
  profile,
  hasRun,
  onPlay,
  onContinue,
  onProfileChange,
}: {
  profile: ProfileLike;
  hasRun: boolean;
  onPlay: (mode: "endless" | "time") => void;
  onContinue: () => void;
  onProfileChange: (updater: (p: ProfileLike) => ProfileLike) => void;
}) {
  const [sheet, setSheet] = useState<null | "help" | "ach" | "settings">(null);

  const dailyDone = profile.daily.day === dailyKey(new Date()) && profile.daily.done;

  return (
    <div className="home">
      <div className="app-bg" aria-hidden>
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="home-top">
        <button className="icon-btn" onClick={() => setSheet("help")} aria-label="How to play">
          <IconHelp size={20} />
        </button>
        <button className="icon-btn" onClick={() => setSheet("settings")} aria-label="Settings">
          <IconGear size={20} />
        </button>
      </div>

      {profile.streak.current > 0 && (
        <div className="streak-chip">
          <IconFlame size={14} /> {profile.streak.current}-day streak
        </div>
      )}

      <div className="hero">
        <div className="logo-badge">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 18px)", gap: 4 }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(255,255,255,0.95)" }} />
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(255,255,255,0.6)" }} />
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(255,255,255,0.6)" }} />
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(255,255,255,0.95)" }} />
          </div>
        </div>
        <h1 className="logo-title">
          Nova<span className="grad">Pop</span>
        </h1>
        <p className="logo-tagline">Merge blocks. Pop lines. Chase infinity.</p>
      </div>

      <div className="home-actions">
        {hasRun && (
          <button className="btn btn-ghost btn-big" onClick={onContinue}>
            <IconPlay size={18} /> Continue Run · {profile.bests.endless > 0 ? "keep the streak alive" : "jump back in"}
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={() => onPlay("endless")}>
          <IconPlay size={18} /> Play Endless
        </button>
        <button className="btn btn-ghost btn-big" onClick={() => onPlay("time")}>
          <IconHourglass size={18} /> Puzzle Time · 2 min
        </button>
      </div>

      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-num">{Math.max(profile.bests.endless, profile.bests.time).toLocaleString()}</div>
          <div className="stat-label">Best</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{profile.totals.stars.toLocaleString()}</div>
          <div className="stat-label">Stars</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{profile.totals.lines.toLocaleString()}</div>
          <div className="stat-label">Lines</div>
        </div>
        <button className="stat-card" onClick={() => setSheet("ach")} style={{ cursor: "pointer" }}>
          <div className="stat-num">
            {profile.achievements.length}/{ACHIEVEMENTS.length}
          </div>
          <div className="stat-label">Awards</div>
        </button>
      </div>

      {sheet === "help" && (
        <div className="overlay" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="sheet-title" style={{ textAlign: "left", marginBottom: 6 }}>
                How to play
              </div>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close">
                <IconClose size={18} />
              </button>
            </div>
            <div className="rule-row">
              <div className="rule-emoji">🧩</div>
              <div className="rule-text">
                <b>Drag pieces</b> from the tray onto the 8×8 board. Place them anywhere they fit.
              </div>
            </div>
            <div className="rule-row">
              <div className="rule-emoji">✨</div>
              <div className="rule-text">
                <b>Merge:</b> touch a block of the same color and they fuse into one bigger block. +25 each.
              </div>
            </div>
            <div className="rule-row">
              <div className="rule-emoji">💥</div>
              <div className="rule-text">
                <b>Pop lines:</b> fill a full row or column to clear it. +10 per cell. Chain moves without breaking the chain for a <b>combo</b>.
              </div>
            </div>
            <div className="rule-row">
              <div className="rule-emoji">💔</div>
              <div className="rule-text">
                <b>Lives:</b> stuck with no legal moves? A life is spent and fresh pieces are dealt. Out of lives, spend a <b>Second Chance</b> to keep your score.
              </div>
            </div>
            <div className="rule-row">
              <div className="rule-emoji">⏱️</div>
              <div className="rule-text">
                <b>Puzzle Time:</b> a fresh 2-minute run every day with a rotating challenge — same for all players.
              </div>
            </div>
          </div>
        </div>
      )}

      {sheet === "ach" && (
        <div className="overlay" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="sheet-title" style={{ textAlign: "left", marginBottom: 6 }}>
                Achievements
              </div>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close">
                <IconClose size={18} />
              </button>
            </div>
            <div className="ach-grid">
              {ACHIEVEMENTS.map((a) => {
                const got = profile.achievements.includes(a.id);
                return (
                  <div key={a.id} className={`ach-row ${got ? "unlocked" : "locked"}`}>
                    <div className="ach-icon">{got ? a.icon : "🔒"}</div>
                    <div>
                      <div className="ach-name">{a.name}</div>
                      <div className="ach-desc">{a.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {sheet === "settings" && (
        <div className="overlay" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="sheet-title" style={{ textAlign: "left", marginBottom: 6 }}>
                Settings
              </div>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close">
                <IconClose size={18} />
              </button>
            </div>
            <div className="set-row">
              <span>Sound effects</span>
              <Toggle
                on={profile.settings.sound}
                onChange={(v) => onProfileChange((p) => ({ ...p, settings: { ...p.settings, sound: v } }))}
              />
            </div>
            <div className="set-row">              <span>Haptics</span>
              <Toggle
                on={profile.settings.haptics}
                onChange={(v) => onProfileChange((p) => ({ ...p, settings: { ...p.settings, haptics: v } }))}
              />
            </div>
            <div className="set-row">
              <span>Daily streak</span>
              <span style={{ color: "var(--gold)", fontWeight: 800 }}>
                🔥 {profile.streak.current} · best {profile.streak.best}
              </span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>
              Nova Pop v1.0 · Progress saves automatically on this device. Today's challenge:{" "}
              <b style={{ color: "var(--text)" }}>{dailyChallengeFor(dailyKey(new Date()))}</b>
              {dailyDone ? " ✅" : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}
