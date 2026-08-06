// ---------------------------------------------------------------------------
// Missions, achievements and daily rewards.
// Daily/weekly missions are deterministically derived from the date so every
// player sees the same set and progress persists across sessions.
// ---------------------------------------------------------------------------

import type { RunResult } from "./types";
import type { SaveData } from "./storage";

export type Metric =
  | "distance"
  | "coins"
  | "jumps"
  | "slides"
  | "dashes"
  | "bosses"
  | "crystals"
  | "perfect";

export interface MissionDef {
  id: string;
  desc: string;
  metric: Metric;
  target: number;
  reward: number;
  kind: "daily" | "weekly";
}

const DAILY_POOL: Omit<MissionDef, "id" | "kind">[] = [
  { desc: "Run {n}m in total", metric: "distance", target: 1500, reward: 150 },
  { desc: "Collect {n} coins", metric: "coins", target: 120, reward: 120 },
  { desc: "Jump {n} times", metric: "jumps", target: 40, reward: 100 },
  { desc: "Slide {n} times", metric: "slides", target: 15, reward: 100 },
  { desc: "Dash {n} times", metric: "dashes", target: 12, reward: 100 },
  { desc: "Pull off {n} perfect dodges", metric: "perfect", target: 6, reward: 180 },
  { desc: "Grab {n} Omega Crystals", metric: "crystals", target: 2, reward: 200 },
];

const WEEKLY_POOL: Omit<MissionDef, "id" | "kind">[] = [
  { desc: "Run {n}m this week", metric: "distance", target: 12000, reward: 600 },
  { desc: "Collect {n} coins this week", metric: "coins", target: 900, reward: 500 },
  { desc: "Defeat {n} bosses", metric: "bosses", target: 3, reward: 800 },
  { desc: "Jump {n} times this week", metric: "jumps", target: 300, reward: 450 },
  { desc: "{n} perfect dodges this week", metric: "perfect", target: 40, reward: 700 },
];

// Simple string hash → seeded selection (stable per date string).
function seed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(pool: T[], s: number, n: number): T[] {
  const arr = [...pool];
  const out: T[] = [];
  let x = s;
  while (out.length < n && arr.length) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(arr.splice(x % arr.length, 1)[0]);
  }
  return out;
}

export function dailyKey(): string {
  return new Date().toISOString().slice(0, 10);
}
export function weeklyKey(): string {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

export function getDailyMissions(): MissionDef[] {
  const s = seed("daily-" + dailyKey());
  return pick(DAILY_POOL, s, 3).map((m, i) => ({
    ...m,
    id: `daily-${dailyKey()}-${i}`,
    desc: m.desc.replace("{n}", String(m.target)),
    kind: "daily",
  }));
}
export function getWeeklyMissions(): MissionDef[] {
  const s = seed("weekly-" + weeklyKey());
  return pick(WEEKLY_POOL, s, 3).map((m, i) => ({
    ...m,
    id: `weekly-${weeklyKey()}-${i}`,
    desc: m.desc.replace("{n}", String(m.target)),
    kind: "weekly",
  }));
}

export function metricFromRun(r: RunResult, m: Metric): number {
  switch (m) {
    case "distance":
      return r.distance;
    case "coins":
      return r.coins;
    case "jumps":
      return r.stats.jumps;
    case "slides":
      return r.stats.slides;
    case "dashes":
      return r.stats.dashes;
    case "bosses":
      return r.stats.bosses;
    case "crystals":
      return r.crystals;
    case "perfect":
      return r.stats.perfectDodges;
  }
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  check: (s: SaveData) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_run", name: "First Steps", desc: "Complete your first escape run", icon: "🏃", check: (s) => s.runs >= 1 },
  { id: "d1000", name: "Block Runner", desc: "Run 1,000M in a single run", icon: "🌆", check: (s) => s.best >= 1000 },
  { id: "d3000", name: "District Breaker", desc: "Run 3,000M in a single run", icon: "🚇", check: (s) => s.best >= 3000 },
  { id: "d7500", name: "City Ghost", desc: "Run 7,500M in a single run", icon: "👻", check: (s) => s.best >= 7500 },
  { id: "boss1", name: "Mech Down", desc: "Defeat your first Omega boss", icon: "🤖", check: (s) => s.stats.bosses >= 1 },
  { id: "boss5", name: "Guardian Slayer", desc: "Defeat 5 bosses", icon: "⚔️", check: (s) => s.stats.bosses >= 5 },
  { id: "coins10k", name: "Data Baron", desc: "Collect 10,000 lifetime coins", icon: "💰", check: (s) => s.totalCoins >= 10000 },
  { id: "crystals25", name: "Core Hunter", desc: "Collect 25 Omega Crystals", icon: "◈", check: (s) => s.totalCrystals >= 25 },
  { id: "perfect50", name: "Untouchable", desc: "50 lifetime perfect dodges", icon: "✨", check: (s) => s.stats.perfectDodges >= 50 },
  { id: "lvl10", name: "Veteran Subject", desc: "Reach Level 10", icon: "🎖️", check: (s) => s.level >= 10 },
  { id: "all_chars", name: "Full Roster", desc: "Unlock every character", icon: "🧬", check: (s) => s.unlockedChars.length >= 6 },
  { id: "collector", name: "Collector", desc: "Own 5 skins, trails or boards", icon: "🛍️", check: (s) => s.unlockedSkins.length + s.unlockedTrails.length + s.unlockedBoards.length >= 5 },
];

// ---------------------------------------------------------------------------
// Daily reward — streak-based coin grant
// ---------------------------------------------------------------------------
export function dailyRewardAmount(streak: number): number {
  return 100 + Math.min(streak, 7) * 50;
}
export function canClaimDaily(save: SaveData): boolean {
  return save.lastDailyClaim !== dailyKey();
}
