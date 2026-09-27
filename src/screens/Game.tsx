import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOARD_SIZE,
  boardHealth,
  canPlace,
  dailyChallengeFor,
  dailyKey,
  hasAnyMove,
  idx,
  MAX_LIVES,
  placePiece,
  PUZZLE_TIME_SECONDS,
  RESCUE_SCORE_STEP,
  rescueHand,
  START_LIVES,
  type Board,
  type Piece,
} from "../game/engine";
import { clearRun, saveRun } from "../game/storage";
import { evalAchievements } from "../game/achievements";
import type { Block } from "../game/engine";
import { playSfx, haptic } from "../game/audio";
import {
  IconHome,
  IconHourglass,
  IconPause,
  IconPlay,
  IconRestart,
} from "../components/Icons";

export type Mode = "endless" | "time";

export interface GameOverInfo {
  score: number;
  lines: number;
  merges: number;
  bestCombo: number;
  isBest: boolean;
  rescueAvailable: boolean;
}

interface FloatScore {
  id: number;
  x: number;
  y: number;
  text: string;
}

interface RunSnapshot {
  board: number[];
  blocks: { id: number; color: number; cells: [number, number][] }[];
  hand: ({ shape: [number, number][]; color: number } | null)[];
  score: number;
  combo: number;
  nextId: number;
  lives: number;
}

export interface ProfileLike {
  bests: { endless: number; time: number };
  totals: { games: number; lines: number; merges: number; stars: number; rescues: number; bestCombo: number };
  achievements: string[];
  streak: { current: number; best: number; last: string | null };
  daily: { day: string | null; done: boolean };
  settings: { sound: boolean; haptics: boolean };
}

export default function Game({
  mode,
  profile,
  resume,
  onExit,
  onGameOver,
  onProfileChange,
  onToast,
}: {
  mode: Mode;
  profile: ProfileLike;
  resume: RunSnapshot | null;
  onExit: () => void;
  onGameOver: (info: GameOverInfo) => void;
  onProfileChange: (updater: (p: ProfileLike) => ProfileLike) => void;
  onToast: (icon: string, text: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  const boardState = useRef<Board>(new Array(64).fill(0) as Board);
  const blocksState = useRef<Block[]>([]);
  const handState = useRef<(Piece | null)[]>([]);
  const nextIdRef = useRef(1);
  const statLines = useRef(0);
  const statMerges = useRef(0);
  const statCombo = useRef(0);
  const finishedRef = useRef(false);

  const [view, setView] = useState<Board>(new Array(64).fill(0) as Board);
  const [hand, setHand] = useState<(Piece | null)[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [secondsLeft, setSecondsLeft] = useState(PUZZLE_TIME_SECONDS);
  const [clearing, setClearing] = useState<Set<number>>(new Set());
  const [floats, setFloats] = useState<FloatScore[]>([]);
  const [over, setOver] = useState<GameOverInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [health, setHealth] = useState(100);
  const [best, setBest] = useState(0);
  const [ghost, setGhost] = useState<number[]>([]);
  const [drag, setDrag] = useState<{ slot: number; x: number; y: number } | null>(null);
  const [bump, setBump] = useState(false);
  const [handKey, setHandKey] = useState(0);

  const soundOn = profile.settings.sound;
  const hapticsOn = profile.settings.haptics;
  const sfx = useCallback(
    (s: Parameters<typeof playSfx>[0]) => {
      playSfx(s, soundOn);
      if (hapticsOn) haptic(s.type === "pop" ? 35 : 12);
    },
    [soundOn, hapticsOn]
  );

  const timeDanger = mode === "time" && secondsLeft <= 10 && secondsLeft > 0 && !over && !paused;

  // ---- Run lifecycle -------------------------------------------------------
  useEffect(() => {
    finishedRef.current = false;
    statLines.current = 0;
    statMerges.current = 0;
    statCombo.current = 0;
    setOver(null);
    setPaused(false);
    setClearing(new Set());
    setFloats([]);
    setBest(mode === "endless" ? profile.bests.endless : profile.bests.time);

    if (resume) {
      boardState.current = resume.board.slice() as Board;
      blocksState.current = resume.blocks.map((b) => ({ ...b, color: b.color as Piece["color"] }));
      handState.current = resume.hand.map((p) => (p ? { shape: p.shape, color: p.color as Piece["color"] } : null));
      nextIdRef.current = resume.nextId;
      setView(boardState.current.slice());
      setHand(handState.current.slice());
      setScore(resume.score);
      setCombo(resume.combo);
      setLives(resume.lives);
    } else {
      boardState.current = new Array(64).fill(0) as Board;
      blocksState.current = [];
      nextIdRef.current = 1;
      const dealt = rescueHand(boardState.current);
      handState.current = dealt;
      setView(new Array(64).fill(0) as Board);
      setHand(dealt);
      setScore(0);
      setCombo(0);
      setLives(START_LIVES);
      setSecondsLeft(PUZZLE_TIME_SECONDS);
      setHandKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const persist = useCallback(() => {
    if (mode !== "endless" || finishedRef.current) return;
    saveRun({
      board: boardState.current as number[],
      blocks: blocksState.current.map((b) => ({ id: b.id, color: b.color, cells: b.cells })),
      hand: handState.current.map((p) => (p ? { shape: p.shape, color: p.color } : null)),
      score,
      combo,
      nextId: nextIdRef.current,
      lives,
    });
  }, [mode, score, combo, lives]);

  useEffect(() => {
    persist();
  }, [view, hand, persist]);

  const persistSoon = useCallback(() => {
    window.setTimeout(persist, 120);
  }, [persist]);

  // ---- Helpers -------------------------------------------------------------
  const cellGeom = () => {
    const rect = boardRef.current?.getBoundingClientRect();
    const size = rect ? rect.width : 340;
    const pad = 9;
    const gap = 5;
    const cell = (size - pad * 2 - gap * (BOARD_SIZE - 1)) / BOARD_SIZE;
    return { rect, pad, gap, cell };
  };

  const halfOfPiece = (slot: number): { x: number; y: number } => {
    const el = slotRefs.current[slot];
    const pieceEl = el?.querySelector(".piece") as HTMLElement | null;
    if (!pieceEl) return { x: 24, y: 24 };
    const r = pieceEl.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  };

  const addFloat = (x: number, y: number, text: string) => {
    const id = Date.now() + Math.random();
    setFloats((f) => [...f, { id, x, y, text }]);
    window.setTimeout(() => setFloats((f) => f.filter((v) => v.id !== id)), 950);
  };

  const finish = useCallback(
    (reason: "stuck" | "timeout") => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const prevBest = mode === "endless" ? profile.bests.endless : profile.bests.time;
      const info: GameOverInfo = {
        score,
        lines: statLines.current,
        merges: statMerges.current,
        bestCombo: statCombo.current,
        isBest: score > prevBest,
        rescueAvailable:
          reason === "stuck" && mode === "endless" && score >= RESCUE_SCORE_STEP && lives > 0,
      };
      sfx({ type: "gameover" });
      if (hapticsOn) haptic(80);
      setOver(info);
      if (mode === "endless") clearRun();
      onGameOver(info);
    },
    [mode, profile.bests.endless, profile.bests.time, score, lives, sfx, hapticsOn, onGameOver]
  );

  // Puzzle Time countdown.
  useEffect(() => {
    if (mode !== "time" || over || paused) return;
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [mode, over, paused]);

  // Time runs out.
  useEffect(() => {
    if (mode === "time" && secondsLeft === 0 && !over) finish("timeout");
  }, [mode, secondsLeft, over, finish]);

  // ---- Placing a piece -----------------------------------------------------
  const objectiveMet = (challenge: string, s: { score: number; combo: number; lines: number; merges: number }) => {
    const m = challenge.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    if (challenge.includes("combo")) return s.combo >= n;
    if (challenge.includes("merges")) return s.merges >= n;
    if (challenge.includes("points")) return s.score >= n;
    if (challenge.includes("lines")) return s.lines >= n;
    return false;
  };

  const commitPlace = (slot: number, r: number, c: number) => {
    if (over || paused || finishedRef.current) return;
    const piece = hand[slot];
    if (!piece) return;
    if (!canPlace(boardState.current, piece.shape, r, c)) return;

    const res = placePiece(boardState.current, blocksState.current, piece, r, c, nextIdRef.current);
    boardState.current = res.board;
    blocksState.current = res.blocks;
    nextIdRef.current = Math.max(nextIdRef.current + 1, ...res.blocks.map((b) => b.id + 1));

    const newHand = hand.map((p, i) => (i === slot ? null : p));
    let finalHand = newHand;
    if (newHand.every((p) => p === null)) {
      finalHand = rescueHand(boardState.current);
      setHandKey((k) => k + 1);
    }
    handState.current = finalHand;
    setHand(finalHand);

    // Visual clear animation on cells that just emptied.
    if (res.cleared > 0) {
      const clearedSet = new Set<number>();
      for (let i = 0; i < view.length; i++) if (view[i] !== 0 && res.board[i] === 0) clearedSet.add(i);
      setClearing(clearedSet);
      window.setTimeout(() => setClearing(new Set()), 330);
    }
    setView(res.board.slice());

    const newScore = score + res.gained;
    const newCombo = res.cleared > 0 || res.merges > 0 ? combo + 1 : 0;
    statLines.current += res.lines;
    statMerges.current += res.merges;
    statCombo.current = Math.max(statCombo.current, newCombo);

    setScore(newScore);
    setCombo(newCombo);
    setBump(true);
    window.setTimeout(() => setBump(false), 300);
    setHealth(boardHealth(res.board, finalHand.filter(Boolean) as Piece[]));

    sfx(res.cleared > 0 ? { type: "pop", lines: res.lines, combo: newCombo } : res.merges > 0 ? { type: "merge", pitch: res.merges } : { type: "place" });

    const rect = boardRef.current?.getBoundingClientRect();
    if (rect && res.gained > 0) addFloat(rect.width / 2 - 20, rect.height * 0.25, `+${res.gained}`);

    // Profile: totals, daily challenge, achievements.
    const dailyK = dailyKey(new Date());
    let dailyDoneNow = false;
    if (mode === "time" && !profile.daily.done) {
      const ch = dailyChallengeFor(dailyK);
      if (objectiveMet(ch, { score: newScore, combo: newCombo, lines: statLines.current, merges: statMerges.current })) {
        dailyDoneNow = true;
        onToast("⭐", "Daily challenge complete!");
        sfx({ type: "achievement" });
      }
    }

    const totalsDelta = {
      lines: res.lines,
      merges: res.merges,
      stars: Math.floor(res.gained / 100),
    };

    onProfileChange((p) => ({
      ...p,
      totals: {
        ...p.totals,
        lines: p.totals.lines + totalsDelta.lines,
        merges: p.totals.merges + totalsDelta.merges,
        stars: p.totals.stars + totalsDelta.stars,
      },
      daily: dailyDoneNow ? { day: dailyK, done: true } : p.daily,
    }));

    const fresh = evalAchievements(
      {
        score: newScore,
        combo: newCombo,
        totalLines: profile.totals.lines + totalsDelta.lines,
        totalMerges: profile.totals.merges + totalsDelta.merges,
        streakBest: profile.streak.best,
        dailyDone: profile.daily.done || dailyDoneNow,
        rescues: profile.totals.rescues,
        games: profile.totals.games,
      },
      profile.achievements
    );
    if (fresh.length) {
      onProfileChange((p) => ({ ...p, achievements: [...p.achievements, ...fresh] }));
      onToast("🏅", "Achievement unlocked!");
      sfx({ type: "achievement" });
    }

    persistSoon();

    // Loss / refill checks after the render settles.
    window.setTimeout(() => {
      if (finishedRef.current) return;
      const remaining = handState.current.filter(Boolean) as Piece[];
      if (remaining.length > 0 && !hasAnyMove(boardState.current, remaining)) {
        if (lives > 0) {
          setLives((l) => l - 1);
          const fresh = rescueHand(boardState.current);
          handState.current = fresh;
          setHand(fresh);
          setHandKey((k) => k + 1);
          onToast("💔", "No moves! Life lost — new pieces dealt.");
          sfx({ type: "click" });
        } else {
          finish("stuck");
        }
      }
    }, 80);
  };

  // ---- Drag & drop ---------------------------------------------------------
  const dragRef = useRef<{ slot: number; pointerId: number } | null>(null);

  const onPointerDown = (slot: number, e: React.PointerEvent) => {
    if (over || paused || !hand[slot] || dragRef.current) return;
    dragRef.current = { slot, pointerId: e.pointerId };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ slot, x: e.clientX, y: e.clientY });
    sfx({ type: "click" });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    setDrag({ slot: d.slot, x: e.clientX, y: e.clientY });
    const { rect, pad, gap, cell } = cellGeom();
    if (!rect) return;
    const lift = halfOfPiece(d.slot);
    const piece = hand[d.slot];
    if (!piece) return;
    const c = Math.floor((e.clientX - lift.x - rect.left - pad + gap / 2) / (cell + gap));
    const r = Math.floor((e.clientY - lift.y - rect.top - pad + gap / 2) / (cell + gap));
    if (r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE && canPlace(boardState.current, piece.shape, r, c)) {
      const cells: number[] = [];
      for (const [dr, dc] of piece.shape) cells.push(idx(r + dr, c + dc));
      setGhost(cells);
    } else {
      setGhost([]);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setGhost([]);
    const { rect, pad, gap, cell } = cellGeom();
    if (!rect) return;
    const lift = halfOfPiece(d.slot);
    const piece = hand[d.slot];
    if (!piece) return;
    const c = Math.floor((e.clientX - lift.x - rect.left - pad + gap / 2) / (cell + gap));
    const r = Math.floor((e.clientY - lift.y - rect.top - pad + gap / 2) / (cell + gap));
    if (r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE && canPlace(boardState.current, piece.shape, r, c)) {
      commitPlace(d.slot, r, c);
    }
  };

  // ---- Rendering -----------------------------------------------------------
  const renderPiece = (p: Piece, scale: number) => {
    const rows = Math.max(...p.shape.map((s) => s[0])) + 1;
    const cols = Math.max(...p.shape.map((s) => s[1])) + 1;
    const s = 24 * scale;
    const step = s + 3;
    return (
      <div className="piece" style={{ width: cols * step, height: rows * step }}>
        {p.shape.map(([dr, dc], i) => (
          <div
            key={i}
            className="mini-cell"
            style={{
              left: dc * step,
              top: dr * step,
              width: s,
              height: s,
              background: `linear-gradient(135deg, var(--c${p.color}a), var(--c${p.color}b))`,
              boxShadow: "0 4px 10px -2px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.45)",
            }}
          />
        ))}
      </div>
    );
  };

  const ghostColor = drag ? hand[drag.slot]?.color : undefined;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const healthColor = health > 55 ? "#22c55e" : health > 28 ? "#f59e0b" : "#ef4444";

  const dragStyle: React.CSSProperties | undefined = drag
    ? (() => {
        const lift = halfOfPiece(drag.slot);
        return { left: drag.x - lift.x, top: drag.y - lift.y };
      })()
    : undefined;

  return (
    <div className="game" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="game-top">
        <button className="icon-btn" onClick={onExit} aria-label="Home">
          <IconHome size={20} />
        </button>
        <div className="score-wrap">
          <div className={`score-val ${bump ? "score-bump" : ""}`}>{score.toLocaleString()}</div>
          <div className="best-mini">Best {best.toLocaleString()}</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            setPaused(true);
            sfx({ type: "click" });
          }}
          aria-label="Pause"
        >
          <IconPause size={20} />
        </button>
      </div>

      {mode === "time" && (
        <>
          <div className={`pt-banner ${timeDanger ? "pt-danger" : ""}`}>
            <IconHourglass size={16} />
            <span className="time-val">{fmtTime(secondsLeft)}</span>
            <span style={{ opacity: 0.7 }}>· Puzzle Time</span>
          </div>
          <div className="pt-challenge">🎯 {dailyChallengeFor(dailyKey(new Date()))}</div>
        </>
      )}

      {mode === "endless" && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
          <div className="lives-row" aria-label={`${lives} lives`}>
            {Array.from({ length: MAX_LIVES }).map((_, i) => (
              <span key={i} className={`life-dot ${i < lives ? "" : "lost"}`}>
                ❤️
              </span>
            ))}
          </div>
        </div>
      )}

      {combo >= 2 && (
        <div className="combo-pill" key={combo}>
          {combo}× COMBO
        </div>
      )}

      <div className="board-wrap" ref={boardRef}>
        <div className="board">
          {view.map((v, i) => {
            const isGhost = ghost.includes(i);
            const isClearing = clearing.has(i);
            const filled = v !== 0;
            return (
              <div
                key={i}
                className={["cell", filled ? "cell-filled" : "", isGhost ? "cell-ghost" : "", isClearing ? "cell-clearing" : ""].join(" ")}
                style={
                  isGhost
                    ? { background: `linear-gradient(135deg, var(--c${ghostColor}a), var(--c${ghostColor}b))`, opacity: 0.55 }
                    : filled
                      ? { background: `linear-gradient(135deg, var(--c${v}a), var(--c${v}b))`, boxShadow: "inset 0 1px 2px rgba(255,255,255,0.45), 0 3px 8px -2px rgba(0,0,0,0.5)" }
                      : undefined
                }
              />
            );
          })}
        </div>
        {floats.map((f) => (
          <div key={f.id} className="float-score" style={{ left: f.x, top: f.y }}>
            {f.text}
          </div>
        ))}
      </div>

      <div className="health-bar" aria-hidden>
        <div className="health-fill" style={{ width: `${health}%`, background: healthColor }} />
      </div>

      <div className="hand">
        {hand.map((p, i) => (
          <div
            key={`${handKey}-${i}`}
            ref={(el) => {
              slotRefs.current[i] = el;
            }}
            className={`hand-slot ${p === null ? "used" : ""}`}
            onPointerDown={(e) => onPointerDown(i, e)}
            style={{ touchAction: "none" }}
          >
            {p ? (
              <div className="piece-anim" style={{ opacity: drag?.slot === i ? 0.25 : 1 }}>
                {renderPiece(p, 1)}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {drag && hand[drag.slot] && (
        <div className="drag-layer" style={dragStyle}>
          {renderPiece(hand[drag.slot]!, 1.4)}
        </div>
      )}

      {paused && !over && (
        <div className="overlay" onClick={() => setPaused(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">Paused</div>
            <div className="go-actions">
              <button className="btn btn-primary btn-big" onClick={() => setPaused(false)}>
                <IconPlay size={18} /> Resume
              </button>
              <button
                className="btn btn-ghost btn-big"
                onClick={() => {
                  if (mode === "endless") clearRun();
                  onExit();
                }}
              >
                <IconHome size={18} /> Quit to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {over && (
        <div className="overlay">
          <div className="sheet">
            {over.isBest && <span className="new-best">🏆 New Personal Best!</span>}
            <div className="go-title">{mode === "time" ? "Time's Up!" : "Game Over"}</div>
            <div className="go-score">{over.score.toLocaleString()}</div>
            <div className="go-sub">{mode === "time" ? "Puzzle Time complete" : "No moves left"}</div>
            <div className="go-stats">
              <div className="go-stat">
                <div className="stat-num">{over.lines}</div>
                <div className="stat-label">Lines</div>
              </div>
              <div className="go-stat">
                <div className="stat-num">{over.merges}</div>
                <div className="stat-label">Merges</div>
              </div>
              <div className="go-stat">
                <div className="stat-num">{over.bestCombo}×</div>
                <div className="stat-label">Best Combo</div>
              </div>
            </div>
            {over.rescueAvailable && (
              <div className="rescue-box">
                <div style={{ fontWeight: 900, color: "var(--safe)" }}>🛟 Second Chance</div>
                <p>
                  Spend a life ❤️ and keep your score with a fresh board ({lives} {lives === 1 ? "life" : "lives"} left).
                </p>
                <button
                  className="btn btn-primary btn-big"
                  onClick={() => {
                    boardState.current = new Array(64).fill(0) as Board;
                    blocksState.current = [];
                    nextIdRef.current = 1;
                    handState.current = rescueHand(boardState.current);
                    setView(boardState.current.slice());
                    setHand(handState.current);
                    setCombo(0);
                    setLives((l) => l - 1);
                    statLines.current = 0;
                    statMerges.current = 0;
                    statCombo.current = 0;
                    setOver(null);
                    setHandKey((k) => k + 1);
                    sfx({ type: "achievement" });
                    onProfileChange((p) => ({
                      ...p,
                      totals: { ...p.totals, rescues: p.totals.rescues + 1 },
                    }));
                  }}
                >
                  Use Second Chance
                </button>
              </div>
            )}
            <div className="go-actions">
              <button
                className="btn btn-primary btn-big"
                onClick={() => {
                  clearRun();
                  finishedRef.current = false;
                  statLines.current = 0;
                  statMerges.current = 0;
                  statCombo.current = 0;
                  boardState.current = new Array(64).fill(0) as Board;
                  blocksState.current = [];
                  nextIdRef.current = 1;
                  const h = rescueHand(boardState.current);
                  handState.current = h;
                  setView(boardState.current.slice());
                  setHand(h);
                  setScore(0);
                  setCombo(0);
                  setLives(START_LIVES);
                  setSecondsLeft(PUZZLE_TIME_SECONDS);
                  setOver(null);
                  setHandKey((k) => k + 1);
                  setBest(mode === "endless" ? profile.bests.endless : profile.bests.time);
                  sfx({ type: "click" });
                }}
              >
                <IconRestart size={18} /> Play Again
              </button>
              <button className="btn btn-ghost btn-big" onClick={onExit}>
                <IconHome size={18} /> Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
