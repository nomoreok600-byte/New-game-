import { useCallback, useEffect, useState } from "react";
import Home from "./screens/Home";
import Game, { type GameOverInfo, type Mode, type ProfileLike } from "./screens/Game";
import { clearRun, loadProfile, loadRun, saveProfile } from "./game/storage";
import { dailyKey, todaySeed } from "./game/engine";

type Screen = { name: "home" } | { name: "game"; mode: Mode; resume: boolean };

interface Toast {
  id: number;
  icon: string;
  text: string;
}

const yesterdayKey = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dailyKey(todaySeed(d));
};

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [profile, setProfile] = useState<ProfileLike | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((icon: string, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, icon, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  // Load profile, roll the daily streak, and check for a saved run.
  useEffect(() => {
    const p = loadProfile();
    const today = dailyKey(todaySeed(new Date()));
    if (p.streak.last !== today) {
      const consecutive = p.streak.last === yesterdayKey();
      p.streak = {
        current: consecutive ? p.streak.current + 1 : 1,
        best: Math.max(p.streak.best, consecutive ? p.streak.current + 1 : 1),
        last: today,
      };
    }
    if (p.daily.day !== today) {
      p.daily = { day: today, done: false };
    }
    saveProfile(p);
    setProfile(p);
    const run = loadRun();
    setHasRun(!!run);
  }, []);

  const updateProfile = useCallback((updater: (p: ProfileLike) => ProfileLike) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      saveProfile(next as any);
      return next;
    });
  }, []);

  const startGame = (mode: Mode, resume: boolean) => {
    if (!resume) clearRun();
    setScreen({ name: "game", mode, resume });
  };

  const handleGameOver = (info: GameOverInfo) => {
    const mode: Mode = screen.name === "game" ? screen.mode : "endless";
    updateProfile((p) => ({
      ...p,
      bests:
        mode === "time"
          ? { ...p.bests, time: Math.max(p.bests.time, info.score) }
          : { ...p.bests, endless: Math.max(p.bests.endless, info.score) },
      totals: {
        ...p.totals,
        games: p.totals.games + 1,
        bestCombo: Math.max(p.totals.bestCombo, info.bestCombo),
      },
    }));
    setHasRun(false);
  };

  const exitToHome = useCallback(() => {
    const run = loadRun();
    setHasRun(!!run);
    setScreen({ name: "home" });
  }, []);

  if (!profile) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh", color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      {screen.name === "home" ? (
        <Home
          profile={profile}
          hasRun={hasRun}
          onPlay={(mode) => startGame(mode, false)}
          onContinue={() => startGame("endless", true)}
          onProfileChange={updateProfile}
        />
      ) : (
        <Game
          key={`${screen.mode}-${screen.resume}`}
          mode={screen.mode}
          profile={profile}
          resume={screen.resume ? loadRun() : null}
          onExit={exitToHome}
          onGameOver={handleGameOver}
          onProfileChange={updateProfile}
          onToast={pushToast}
        />
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.icon}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
