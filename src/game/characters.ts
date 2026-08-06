// ---------------------------------------------------------------------------
// Character roster, skins, trails and hoverboards for OMEGA ESCAPE.
// All gameplay-relevant character data lives here; the engine consumes a
// resolved Loadout built from these definitions in App.
// ---------------------------------------------------------------------------

export interface CharacterStats {
  speed: number;
  power: number;
  agility: number;
  defense: number;
}

import type { CharSilhouette } from "./types";

export interface CharacterDef {
  id: string;
  name: string;
  role: string;
  ability: string;
  abilityName: string;
  abilityDesc: string;
  passiveName: string;
  passiveDesc: string;
  difficulty: "Easy" | "Medium" | "Hard";
  faction: string;
  origin: string;
  age: number;
  bio: string;
  lore: string;
  colors: { primary: string; secondary: string; glow: string; accent?: string };
  build: number;
  silhouette: CharSilhouette;
  hood?: boolean;
  hair?: string;
  stats: CharacterStats;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
  price: number; // 0 = default unlocked
  unlockDesc: string;
  unlockCheck: (s: { best: number; totalCoins: number; bosses: number; runs: number; jumps: number }) => boolean;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "nex",
    name: "NEX",
    role: "The Runner",
    ability: "timeDash",
    abilityName: "Time Dash",
    abilityDesc: "Dashing briefly bends time, slowing the world around you.",
    passiveName: "Momentum",
    passiveDesc: "Builds run speed 25% faster than anyone else.",
    difficulty: "Easy",
    faction: "Free Runners",
    origin: "Undercity",
    age: 21,
    bio: "A skilled parkour runner who can manipulate time for a short burst.",
    lore: "Nex grew up on the rooftops of the Undercity, racing courier drones for food credits. When Omega tagged him for the X-Project, he outran the extraction team — twice.",
    colors: { primary: "#00f7ff", secondary: "#1a2a4a", glow: "#00f7ff", accent: "#67e8f9" },
    build: 1,
    silhouette: "runner",
    hair: "#101418",
    stats: { speed: 78, power: 55, agility: 82, defense: 50 },
    rarity: "Common",
    price: 0,
    unlockDesc: "Available by default",
    unlockCheck: () => true,
  },
  {
    id: "zara",
    name: "ZARA",
    role: "The Hacker",
    ability: "hackDrones",
    abilityName: "Drone Hack",
    abilityDesc: "Security drones are hijacked — they drop credits and never harm you.",
    passiveName: "EMP Resistance",
    passiveDesc: "Electric hazards and EMP zones are completely ignored.",
    difficulty: "Medium",
    faction: "Ghostwire Collective",
    origin: "Neon Downtown",
    age: 24,
    bio: "Ex-Omega netrunner who turned her own implants against the corporation.",
    lore: "Zara wrote half of Omega's surveillance stack before she found the kill-switch they buried in it. Now every drone in the city whispers her name.",
    colors: { primary: "#ff2ed1", secondary: "#2a103a", glow: "#c026d3", accent: "#f0abfc" },
    build: 0.94,
    silhouette: "hacker",
    hair: "#7c3aed",
    stats: { speed: 68, power: 62, agility: 76, defense: 58 },
    rarity: "Rare",
    price: 1800,
    unlockDesc: "Reach 1,500M best distance",
    unlockCheck: (s) => s.best >= 1500,
  },
  {
    id: "void",
    name: "VOID",
    role: "The Shadow",
    ability: "phaseDash",
    abilityName: "Invisible Dash",
    abilityDesc: "While dashing you phase through all obstacles.",
    passiveName: "Critical Escape",
    passiveDesc: "Survives one lethal hit every 40 seconds.",
    difficulty: "Hard",
    faction: "Unknown",
    origin: "Redacted",
    age: 27,
    bio: "An assassin erased from every database. Even Omega doesn't know what he is.",
    lore: "Security footage of Void corrupts on playback. Witnesses forget his face. The only evidence he exists is a purple glyph left at every Omega checkpoint he has dismantled.",
    colors: { primary: "#8a2be2", secondary: "#0c0618", glow: "#a855f7", accent: "#c084fc" },
    build: 1.02,
    silhouette: "shadow",
    hood: true,
    stats: { speed: 74, power: 70, agility: 90, defense: 44 },
    rarity: "Epic",
    price: 3500,
    unlockDesc: "Defeat 3 bosses",
    unlockCheck: (s) => s.bosses >= 3,
  },
  {
    id: "rift",
    name: "RIFT",
    role: "The Rebel",
    ability: "overdrive",
    abilityName: "Overdrive",
    abilityDesc: "Activating dash ignites Overdrive: massive speed + brief invincibility.",
    passiveName: "Adrenaline",
    passiveDesc: "Base run speed increased by 8%.",
    difficulty: "Medium",
    faction: "Redline Insurgency",
    origin: "Industrial Sector",
    age: 29,
    bio: "Demolitions expert who blew the gates off Omega's labor camp.",
    lore: "Rift's crew stole a fusion core and never gave it back. His jacket still carries the burn marks — he keeps them as a reminder of what speed costs.",
    colors: { primary: "#22d3ee", secondary: "#0b2830", glow: "#38bdf8", accent: "#a5f3fc" },
    build: 1.05,
    silhouette: "rebel",
    hair: "#38bdf8",
    stats: { speed: 88, power: 66, agility: 70, defense: 56 },
    rarity: "Rare",
    price: 2500,
    unlockDesc: "Earn 2,500 total coins",
    unlockCheck: (s) => s.totalCoins >= 2500,
  },
  {
    id: "luna",
    name: "LUNA",
    role: "The Scout",
    ability: "tripleJump",
    abilityName: "Triple Jump",
    abilityDesc: "Lightweight frame allows a third jump in mid-air.",
    passiveName: "Featherlight",
    passiveDesc: "Reduced gravity — floats longer, falls softer.",
    difficulty: "Easy",
    faction: "Sky Bridge Watch",
    origin: "Upper Spires",
    age: 19,
    bio: "Courier of the high bridges. She has never touched a road she didn't choose.",
    lore: "Luna mapped every sky-bridge in the city before she was twelve. Omega wants her maps. She wants the sunrise they privatized.",
    colors: { primary: "#ffd500", secondary: "#3a2f08", glow: "#facc15", accent: "#fef08a" },
    build: 0.88,
    silhouette: "scout",
    hair: "#f8fafc",
    stats: { speed: 72, power: 48, agility: 94, defense: 42 },
    rarity: "Rare",
    price: 2200,
    unlockDesc: "Jump 500 total times",
    unlockCheck: (s) => s.jumps >= 500,
  },
  {
    id: "atlas",
    name: "ATLAS",
    role: "The Tank",
    ability: "energyShield",
    abilityName: "Energy Shield",
    abilityDesc: "Starts every run with a shield charge; regenerates one every 45s.",
    passiveName: "Plated Armor",
    passiveDesc: "Obstacles you smash while invincible grant bonus coins.",
    difficulty: "Medium",
    faction: "Omega Defector",
    origin: "Research Facility 7",
    age: 34,
    bio: "A decommissioned siege unit that chose to protect instead of destroy.",
    lore: "Atlas was built to crush riots. On day one he carried a child out of the blast zone instead. Omega branded him defective. The city calls him something else.",
    colors: { primary: "#ff6a00", secondary: "#2a1406", glow: "#fb923c", accent: "#fdba74" },
    build: 1.32,
    silhouette: "tank",
    stats: { speed: 58, power: 92, agility: 46, defense: 90 },
    rarity: "Epic",
    price: 4000,
    unlockDesc: "Reach 3,000M best distance",
    unlockCheck: (s) => s.best >= 3000,
  },
];

export interface SkinDef {
  id: string;
  charId: string;
  name: string;
  rarity: "Default" | "Rare" | "Epic" | "Legendary";
  price: number;
  colors: { primary: string; secondary: string; glow: string; accent?: string };
  hood?: boolean;
}

// Two signature skins per character — enough to feel real, scoped to ship.
export const SKINS: SkinDef[] = [
  { id: "nex_default", charId: "nex", name: "Street Runner", rarity: "Default", price: 0, colors: { primary: "#00f7ff", secondary: "#1a2a4a", glow: "#00f7ff" } },
  { id: "nex_stealth", charId: "nex", name: "Stealth Suit", rarity: "Epic", price: 900, colors: { primary: "#475569", secondary: "#0f172a", glow: "#94a3b8" } },
  { id: "zara_default", charId: "zara", name: "Netrunner", rarity: "Default", price: 0, colors: { primary: "#ff2ed1", secondary: "#2a103a", glow: "#c026d3" } },
  { id: "zara_neon", charId: "zara", name: "Animated Neon", rarity: "Legendary", price: 1500, colors: { primary: "#f0abfc", secondary: "#3b0764", glow: "#e879f9" } },
  { id: "void_default", charId: "void", name: "Shadow", rarity: "Default", price: 0, colors: { primary: "#8a2be2", secondary: "#0c0618", glow: "#a855f7" }, hood: true },
  { id: "void_samurai", charId: "void", name: "Cyber Samurai", rarity: "Legendary", price: 1800, colors: { primary: "#f43f5e", secondary: "#1e0a12", glow: "#fb7185" }, hood: true },
  { id: "rift_default", charId: "rift", name: "Redline", rarity: "Default", price: 0, colors: { primary: "#22d3ee", secondary: "#0b2830", glow: "#38bdf8" } },
  { id: "rift_proto", charId: "rift", name: "Prototype Suit", rarity: "Epic", price: 1000, colors: { primary: "#a3e635", secondary: "#1a2e05", glow: "#84cc16" } },
  { id: "luna_default", charId: "luna", name: "Sky Courier", rarity: "Default", price: 0, colors: { primary: "#ffd500", secondary: "#3a2f08", glow: "#facc15" } },
  { id: "luna_battle", charId: "luna", name: "Battle Armor", rarity: "Rare", price: 700, colors: { primary: "#fbbf24", secondary: "#431407", glow: "#f59e0b" } },
  { id: "atlas_default", charId: "atlas", name: "Siege Unit", rarity: "Default", price: 0, colors: { primary: "#ff6a00", secondary: "#2a1406", glow: "#fb923c" } },
  { id: "atlas_omega", charId: "atlas", name: "Omega Skin", rarity: "Legendary", price: 2000, colors: { primary: "#c084fc", secondary: "#2e1065", glow: "#a855f7" } },
];

export interface TrailDef {
  id: string;
  name: string;
  color: string;
  style: "neon" | "spark" | "glitch";
  price: number;
}
export const TRAILS: TrailDef[] = [
  { id: "cyan", name: "Ion Trail", color: "#22d3ee", style: "neon", price: 0 },
  { id: "ember", name: "Ember Sparks", color: "#fb923c", style: "spark", price: 400 },
  { id: "glitch", name: "Glitch Phase", color: "#e879f9", style: "glitch", price: 800 },
];

export interface BoardDef {
  id: string;
  name: string;
  color: string;
  price: number;
}
export const BOARDS: BoardDef[] = [
  { id: "none", name: "On Foot", color: "#000000", price: 0 },
  { id: "volt", name: "Volt Board", color: "#22d3ee", price: 1200 },
  { id: "magma", name: "Magma Board", color: "#f97316", price: 1200 },
];

export const RARITY_COLOR: Record<string, string> = {
  Common: "#94a3b8",
  Default: "#94a3b8",
  Rare: "#38bdf8",
  Epic: "#a855f7",
  Legendary: "#fbbf24",
};

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

// ---------------------------------------------------------------------------
// Movement personality — how each hero *feels* to control. The engine reads
// these multipliers so every character plays and looks distinct.
// ---------------------------------------------------------------------------
export interface Personality {
  jumpMul: number;      // jump velocity multiplier
  gravityMul: number;   // fall speed multiplier (light vs heavy)
  accelMul: number;     // how fast run speed ramps
  leanMul: number;      // forward body-tilt while running
  trailIntensity: number; // 0..1 base trail strength
  signature: "streaks" | "holo" | "shadow" | "electric" | "jet" | "shock";
  sigColor: string;
  landShock: number;    // ground shockwave strength on landing
  footstep: "light" | "soft" | "silent" | "heavy" | "hop" | "stomp";
  voice: string;        // short intro line shown in select
}

export const PERSONALITY: Record<string, Personality> = {
  nex:   { jumpMul: 1.02, gravityMul: 1.0,  accelMul: 1.25, leanMul: 1.4, trailIntensity: 0.9, signature: "streaks",  sigColor: "#22d3ee", landShock: 0.5, footstep: "light",  voice: "Catch me if the Network can." },
  zara:  { jumpMul: 1.0,  gravityMul: 1.0,  accelMul: 1.0,  leanMul: 0.8, trailIntensity: 0.6, signature: "holo",     sigColor: "#ff2ed1", landShock: 0.4, footstep: "soft",   voice: "Every door has a backdoor." },
  void:  { jumpMul: 1.02, gravityMul: 0.95, accelMul: 1.05, leanMul: 1.0, trailIntensity: 0.85, signature: "shadow",  sigColor: "#a855f7", landShock: 0.2, footstep: "silent", voice: "You never saw me." },
  rift:  { jumpMul: 1.0,  gravityMul: 1.08, accelMul: 1.1,  leanMul: 1.2, trailIntensity: 0.8, signature: "electric", sigColor: "#38bdf8", landShock: 0.7, footstep: "heavy",  voice: "Burn it all down." },
  luna:  { jumpMul: 1.06, gravityMul: 0.82, accelMul: 1.05, leanMul: 1.0, trailIntensity: 0.7, signature: "jet",      sigColor: "#facc15", landShock: 0.35, footstep: "hop",   voice: "See you at the sunrise." },
  atlas: { jumpMul: 0.96, gravityMul: 1.15, accelMul: 0.85, leanMul: 0.7, trailIntensity: 0.5, signature: "shock",    sigColor: "#ff6a00", landShock: 1.2, footstep: "stomp",  voice: "I will not break." },
};

export function getPersonality(id: string): Personality {
  return PERSONALITY[id] ?? PERSONALITY.nex;
}
