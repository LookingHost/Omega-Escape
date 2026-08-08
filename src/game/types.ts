// Shared runtime types for OMEGA ESCAPE.

export type GameState = "ready" | "running" | "paused" | "dead";
export type GameMode = "classic" | "hardcore" | "timeattack" | "bossrush" | "training";

export type PowerupType =
  | "magnet"
  | "shield"
  | "doubleCoins"
  | "slowMotion"
  | "invincibility"
  | "speedBoost"
  | "jetpack";

export interface RunObjective {
  id: string;
  label: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface HudState {
  state: GameState;
  distance: number;
  objective: RunObjective | null;
  coins: number;
  crystals: number;
  best: number;
  speed: number;
  multiplier: number;
  environment: string;
  weather: string;
  shieldCharges: number;
  powerups: { type: PowerupType; remaining: number; total: number }[];
  boss: boolean;
  bossHp: number;
  bossHint: string;
  combo: number;
  dashReady: boolean;
  timeLeft: number; // time attack countdown
  threat: number; // NULL threat level 1..5
}

export interface RunStats {
  jumps: number;
  slides: number;
  dashes: number;
  perfectDodges: number;
  bosses: number;
  wallJumps: number;
}

export interface RunResult {
  distance: number;
  coins: number;
  crystals: number;
  xp: number;
  maxCombo: number;
  stats: RunStats;
  mode: GameMode;
  objectiveLabel: string;
  objectiveDone: boolean;
  threat: number;
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onGameOver: (result: RunResult) => void;
}

export interface EngineSettings {
  shake: boolean;
  particles: boolean;
  colorblind: boolean;
  vibrate: boolean;
  highFx: boolean;
}

// Visual archetype controls the character's unique silhouette & features.
export type CharSilhouette =
  | "runner" // NEX — sleek, scarf, visor
  | "hacker" // ZARA — antenna, tech goggles, floating drone
  | "shadow" // VOID — hood, tattered cloak, glowing eyes
  | "rebel" // RIFT — spiky hair, energy fist
  | "scout" // LUNA — bunny-ear antennae, cape
  | "tank"; // ATLAS — bulky armor, shoulder pads

export interface Loadout {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  glow: string;
  build: number; // body scale factor
  silhouette: CharSilhouette;
  hood?: boolean;
  hair?: string;
  accent?: string; // secondary neon detail color
  ability: string; // character ability id
  trail: { id: string; color: string; style: "neon" | "spark" | "glitch" };
  board: { id: string; color: string } | null;
  personality: {
    jumpMul: number; gravityMul: number; accelMul: number; leanMul: number;
    trailIntensity: number;
    signature: "streaks" | "holo" | "shadow" | "electric" | "jet" | "shock";
    sigColor: string; landShock: number;
    footstep: "light" | "soft" | "silent" | "heavy" | "hop" | "stomp";
    voice: string;
  };
}
