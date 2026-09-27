// Local persistence for Nova Pop — everything lives in localStorage.

export interface GameSnapshot {
  board: number[];
  blocks: { id: number; color: number; cells: [number, number][] }[];
  hand: ({ shape: [number, number][]; color: number } | null)[];
  score: number;
  combo: number;
  nextId: number;
  lives: number;
}

export interface Bests {
  endless: number;
  time: number;
}

export interface Totals {
  games: number;
  lines: number;
  merges: number;
  stars: number;
  rescues: number;
  bestCombo: number;
}

export interface StreakState {
  current: number;
  best: number;
  last: string | null;
}

export interface DailyState {
  day: string | null;
  done: boolean;
}

export interface Settings {
  sound: boolean;
  haptics: boolean;
}

export interface Profile {
  bests: Bests;
  totals: Totals;
  achievements: string[];
  streak: StreakState;
  daily: DailyState;
  settings: Settings;
}

const KEY = "novapop.profile.v1";

const defaultProfile = (): Profile => ({
  bests: { endless: 0, time: 0 },
  totals: { games: 0, lines: 0, merges: 0, stars: 0, rescues: 0, bestCombo: 0 },
  achievements: [],
  streak: { current: 0, best: 0, last: null },
  daily: { day: null, done: false },
  settings: { sound: true, haptics: true },
});

export function loadProfile(): Profile {
  if (typeof window === "undefined") return defaultProfile();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<Profile>;
    const d = defaultProfile();
    return {
      bests: { ...d.bests, ...(parsed.bests ?? {}) },
      totals: { ...d.totals, ...(parsed.totals ?? {}) },
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      streak: { ...d.streak, ...(parsed.streak ?? {}) },
      daily: { ...d.daily, ...(parsed.daily ?? {}) },
      settings: { ...d.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked — game still playable */
  }
}

const RUN_KEY = "novapop.run.v1";

export function saveRun(run: GameSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* ignore */
  }
}

export function loadRun(): GameSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameSnapshot;
    if (!Array.isArray(parsed.board) || parsed.board.length !== 64) return null;
    if (!Array.isArray(parsed.hand)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}
