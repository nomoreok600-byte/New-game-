// Achievement definitions + evaluation.

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_merge", name: "First Spark", desc: "Perform your first merge", icon: "✨" },
  { id: "merge5", name: "Chain Reaction", desc: "Reach a combo of 5", icon: "🔗" },
  { id: "combo10", name: "Unstoppable", desc: "Reach a combo of 10", icon: "🌋" },
  { id: "score1000", name: "Getting Warm", desc: "Score 1,000 in one run", icon: "🔥" },
  { id: "score3000", name: "Nova Maker", desc: "Score 3,000 in one run", icon: "🌟" },
  { id: "score7500", name: "Supernova", desc: "Score 7,500 in one run", icon: "💥" },
  { id: "lines50", name: "Line Cook", desc: "Clear 50 lines (lifetime)", icon: "📏" },
  { id: "merges100", name: "Alchemist", desc: "Merge 100 times (lifetime)", icon: "⚗️" },
  { id: "streak7", name: "Weekly Ritual", desc: "Play 7 days in a row", icon: "📅" },
  { id: "daily1", name: "Daily Dose", desc: "Complete a Puzzle Time run", icon: "⏱️" },
  { id: "rescue1", name: "Second Wind", desc: "Use a Second Chance", icon: "🛟" },
  { id: "games25", name: "Regular", desc: "Play 25 rounds", icon: "🎮" },
];

export type Stats = {
  score: number;
  combo: number;
  totalLines: number;
  totalMerges: number;
  streakBest: number;
  dailyDone: boolean;
  rescues: number;
  games: number;
};

export function evalAchievements(s: Stats, owned: string[]): string[] {
  const rules: Record<string, boolean> = {
    first_merge: s.totalMerges >= 1,
    merge5: s.combo >= 5,
    combo10: s.combo >= 10,
    score1000: s.score >= 1000,
    score3000: s.score >= 3000,
    score7500: s.score >= 7500,
    lines50: s.totalLines >= 50,
    merges100: s.totalMerges >= 100,
    streak7: s.streakBest >= 7,
    daily1: s.dailyDone,
    rescue1: s.rescues >= 1,
    games25: s.games >= 25,
  };
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!owned.includes(a.id) && rules[a.id]) fresh.push(a.id);
  }
  return fresh;
}
