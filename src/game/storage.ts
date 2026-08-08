// ---------------------------------------------------------------------------
// Persistence layer — profile, currency, unlocks, missions, achievements.
// Cloud-save ready: swap loadSave/writeSave for an async provider later.
// ---------------------------------------------------------------------------

import type { GameMode } from "./types";

export interface HighScoreEntry {
  distance: number;
  coins: number;
  mode: GameMode;
  date: string;
}

export interface SaveData {
  best: number;
  scores: HighScoreEntry[];
  totalCoins: number;
  totalCrystals: number;
  xp: number;
  level: number;
  runs: number;

  // lifetime gameplay stats
  stats: {
    jumps: number;
    slides: number;
    dashes: number;
    perfectDodges: number;
    bosses: number;
    wallJumps: number;
    distanceTotal: number;
  };

  // roster & cosmetics
  unlockedChars: string[];
  equippedChar: string;
  unlockedSkins: string[];
  equippedSkins: Record<string, string>;
  unlockedTrails: string[];
  equippedTrail: string;
  unlockedBoards: string[];
  equippedBoard: string;

  // meta progression
  achievements: string[];
  missionProgress: Record<string, number>;
  missionsClaimed: string[];
  dailyStreak: number;
  lastDailyClaim: string;
}

export interface Settings {
  music: boolean;
  sfx: boolean;
  musicVol: number; // 0..1
  sfxVol: number; // 0..1
  shake: boolean;
  particles: boolean;
  colorblind: boolean;
  vibrate: boolean;
  reducedMotion: boolean;
  highFx: boolean; // enable glow/bloom (off = big perf boost on low-end)
  graphics: "low" | "medium" | "high" | "ultra";
  uiScale: number; // 0.85 | 1 | 1.15
  // mobile control layout
  padScale: number; // 0.8..1.4 button size
  padOpacity: number; // 0.3..1
  leftHanded: boolean; // mirror control layout
  swipeControls: boolean; // gestures vs on-screen buttons
}

const SAVE_KEY = "omega_escape_save_v2";
const SETTINGS_KEY = "omega_escape_settings_v2";

const defaultSave: SaveData = {
  best: 0,
  scores: [],
  totalCoins: 0,
  totalCrystals: 0,
  xp: 0,
  level: 1,
  runs: 0,
  stats: {
    jumps: 0,
    slides: 0,
    dashes: 0,
    perfectDodges: 0,
    bosses: 0,
    wallJumps: 0,
    distanceTotal: 0,
  },
  unlockedChars: ["nex"],
  equippedChar: "nex",
  unlockedSkins: ["nex_default"],
  equippedSkins: { nex: "nex_default" },
  unlockedTrails: ["cyan"],
  equippedTrail: "cyan",
  unlockedBoards: ["none"],
  equippedBoard: "none",
  achievements: [],
  missionProgress: {},
  missionsClaimed: [],
  dailyStreak: 0,
  lastDailyClaim: "",
};

// Detect low-end hardware to pick sensible graphics defaults.
function detectLowEnd(): boolean {
  try {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return cores <= 4 || mem <= 3 || (mobile && cores <= 6);
  } catch {
    return false;
  }
}

const defaultSettings: Settings = {
  music: true,
  sfx: true,
  musicVol: 0.7,
  sfxVol: 0.9,
  shake: true,
  particles: true,
  colorblind: false,
  vibrate: true,
  reducedMotion: false,
  highFx: !detectLowEnd(), // low-end devices start in fast mode
  graphics: detectLowEnd() ? "low" : "high",
  uiScale: 1,
  padScale: 1,
  padOpacity: 0.85,
  leftHanded: false,
  swipeControls: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(defaultSave);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const merged = { ...structuredClone(defaultSave), ...parsed };
    merged.stats = { ...defaultSave.stats, ...(parsed.stats ?? {}) };
    return merged;
  } catch {
    return structuredClone(defaultSave);
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** XP required to reach the next level. */
export function xpForLevel(level: number): number {
  return Math.floor(500 * Math.pow(level, 1.35));
}

export function resolveLevel(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  for (;;) {
    const need = xpForLevel(level);
    if (remaining < need) return { level, into: remaining, need };
    remaining -= need;
    level++;
  }
}

export interface CommitOutput {
  save: SaveData;
  isBest: boolean;
  leveledUp: boolean;
  newAchievements: string[];
}
