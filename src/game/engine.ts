// ---------------------------------------------------------------------------
// OMEGA ESCAPE — core endless-runner engine (canvas 2D), v2.
// Systems: physics & advanced movement (double/triple jump, wall-jump, slide,
// dash, air-dash), procedural spawning, powerups, particle pool, weather,
// living city layers, boss hack-core encounters, hitstop & perfect dodges,
// character loadouts (skins/trails/hoverboards), colorblind support.
// Framerate-independent; tuned at a 720px reference height.
// ---------------------------------------------------------------------------

import { audio } from "./audio";
import type {
  EngineCallbacks,
  EngineSettings,
  GameMode,
  GameState,
  HudState,
  Loadout,
  PowerupType,
  RunResult,
  RunStats,
} from "./types";

const REF_H = 720;
const BASE_GRAVITY = 2650;
const JUMP_V = -1010;
const DOUBLE_JUMP_V = -900;
const BASE_SPEED = 360;
const MAX_SPEED = 900;
const SPEED_RAMP = 5.2;
const DASH_TIME = 0.45;
const DASH_COOLDOWN = 0.8;
const COYOTE_TIME = 0.09;
const JUMP_BUFFER = 0.12;

interface Rect { x: number; y: number; w: number; h: number; }

type ObstacleKind =
  | "block" | "wall" | "laser" | "drone" | "roller"
  | "pit" | "missile" | "electric";

interface Obstacle {
  kind: ObstacleKind;
  x: number; y: number; w: number; h: number;
  vy?: number; phase?: number;
  hit?: boolean; counted?: boolean; bestGap?: number;
}

type CollectKind = "coin" | "crystal" | "chip" | "core";
interface Collectible { kind: CollectKind; x: number; y: number; r: number; taken?: boolean; bob: number; }

interface Power { type: PowerupType; x: number; y: number; r: number; taken?: boolean; bob: number; }

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string; gravity: number; glow?: boolean;
}

interface FloatText { x: number; y: number; text: string; color: string; life: number; size: number; }
interface FlyingCoin { x: number; y: number; tx: number; ty: number; life: number; color: string; }

interface FlyCar { x: number; y: number; sp: number; color: string; len: number; dir: 1 | -1; }

interface Palette {
  name: string; skyTop: string; skyBot: string; far: string; mid: string; near: string;
  neon: string; accent: string;
}

const PALETTES: Palette[] = [
  { name: "Cyber City", skyTop: "#1a0b3a", skyBot: "#4a1d6e", far: "#2a1550", mid: "#1d0f40", near: "#120826", neon: "#22d3ee", accent: "#f97316" },
  { name: "Neon Downtown", skyTop: "#2b0a3d", skyBot: "#7a1f5c", far: "#40144f", mid: "#2b0d3a", near: "#160821", neon: "#f472b6", accent: "#38bdf8" },
  { name: "Underground Metro", skyTop: "#06121f", skyBot: "#0b2a3a", far: "#0d2233", mid: "#08151f", near: "#040a10", neon: "#34d399", accent: "#fbbf24" },
  { name: "Industrial Factory", skyTop: "#241206", skyBot: "#5a2a10", far: "#3a1a0c", mid: "#241206", near: "#140a04", neon: "#fb923c", accent: "#22d3ee" },
  { name: "Sky Bridge", skyTop: "#0a1230", skyBot: "#243b7a", far: "#16264f", mid: "#0e1836", near: "#070c1c", neon: "#60a5fa", accent: "#f472b6" },
  { name: "Omega Tower", skyTop: "#1c0630", skyBot: "#5b1080", far: "#33094d", mid: "#1e0632", near: "#0e0219", neon: "#c084fc", accent: "#f97316" },
];

type Weather = "clear" | "rain" | "storm" | "fog" | "snow" | "heat" | "sunrise";
const WEATHERS: Weather[] = ["clear", "rain", "clear", "fog", "storm", "clear", "snow", "heat", "sunrise"];

const POWER_DURATION: Record<PowerupType, number> = {
  magnet: 8, shield: 0, doubleCoins: 10, slowMotion: 6, invincibility: 6, speedBoost: 7, jetpack: 5,
};

export const POWER_LABEL: Record<PowerupType, string> = {
  magnet: "MAGNET", shield: "SHIELD", doubleCoins: "2X COINS", slowMotion: "SLOW-MO",
  invincibility: "INVINCIBLE", speedBoost: "OVERDRIVE", jetpack: "JETPACK",
};

const BILLBOARD_TEXTS = ["OMEGA CORP", "OBEY · CONNECT", "X-01 WANTED", "ESCAPE IS ILLUSION", "NET 9.4 UP", "BUY MORE"];

// NULL broadcasts — world-storytelling delivered in-run, not via walls of text.
const NULL_LINES = [
  "◤ NULL: I see you, Subject.",
  "◤ ALERT: Containment breach — sector sweep.",
  "◤ NULL: You cannot outrun the Network.",
  "◤ BROADCAST: Curfew active. Return to grid.",
  "◤ NULL: Every street remembers your face.",
  "◤ WARNING: Surveillance drones deployed.",
  "◤ NULL: There is no exit. Only me.",
  "◤ SYSTEM: Omega City lockdown initiated.",
];
const STORY_LOGS = [
  "LOG 04: The core woke up angry.",
  "LOG 11: They called it a safeguard.",
  "LOG 22: We were the experiment all along.",
  "MEMORY: The sky used to be blue here.",
];

function rand(a: number, b: number) { return a + Math.random() * (b - a); }
function choice<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function overlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private raf = 0;
  private lastT = 0;
  private hudTimer = 0;

  // adaptive quality — auto-drops effects if the device can't keep up
  private fpsSamples: number[] = [];
  private autoDowngraded = false;

  private W = 0; private H = 0; private scale = 1; private groundY = 0;

  settings: EngineSettings = { shake: true, particles: true, colorblind: false, vibrate: true, highFx: true };

  // Set shadow glow only when highFx is enabled (shadowBlur is very expensive).
  private glowOn(color: string, blur: number) {
    if (this.settings.highFx) {
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = blur;
    }
  }
  private glowOff() {
    if (this.settings.highFx) this.ctx.shadowBlur = 0;
  }

  state: GameState = "ready";
  mode: GameMode = "classic";
  loadout: Loadout | null = null;

  // player
  private px = 0; private py = 0; private pw = 46; private ph = 62;
  private vy = 0; private onGround = true; private jumps = 0;
  private sliding = false; private slideTimer = 0; private slideHeld = false;
  private dashing = false; private dashTimer = 0; private dashCd = 0; private airDashUsed = false;
  private wallSliding = false;
  private coyote = 0; private jumpBuffer = 0;
  private animTime = 0; private hurtFlash = 0; private dead = false;
  private landSquash = 0; // 0..1 squash strength on landing, decays quickly

  // world
  private speed = BASE_SPEED; private distance = 0; private elapsed = 0;
  private worldX = 0; private timeScale = 1;
  private obstacles: Obstacle[] = []; private collects: Collectible[] = [];
  private powers: Power[] = []; private particles: Particle[] = [];
  private particlePool: Particle[] = []; private texts: FloatText[] = [];
  private rings: { x: number; y: number; r: number; max: number; color: string; life: number }[] = [];
  private flyCoins: FlyingCoin[] = [];
  private nextSpawnX = 0;

  // scoring / stats
  private coins = 0; private crystals = 0; private combo = 0; private maxCombo = 0;
  private multiplier = 1; best = 0; private comboTimer = 0;
  private stats: RunStats = { jumps: 0, slides: 0, dashes: 0, perfectDodges: 0, bosses: 0, wallJumps: 0 };

  // powers
  private activePowers: Map<PowerupType, number> = new Map();
  private shieldCharges = 0;
  private escapeCd = 0; // VOID passive
  private atlasTimer = 0;

  // feel
  private hitstop = 0; private flash = 0; private flashColor = "#ffffff";
  private shake = 0; private shakeX = 0; private shakeY = 0;
  private camX = 0; private camY = 0; // smooth cinematic camera offsets
  private zoom = 1; private zoomTarget = 1; // cinematic dash zoom
  private slowPulse = 0; // perfect-dodge slow-mo
  // Overscan margin so camera shake/zoom/offset never expose empty edges.
  // Backgrounds are drawn OX px beyond the viewport on every side.
  private OX = 60; private OY = 60;
  private tuts = { slide: false, jump: false, dash: false, wall: false };

  // env / weather / city life
  private paletteIdx = 0; private weather: Weather = "clear"; private weatherTimer = 0;
  private lightning = 0; private ambientTimer = 0; private weatherAmbientStarted = "";
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private rainDrops: { x: number; y: number; len: number; sp: number }[] = [];
  private snowFlakes: { x: number; y: number; r: number; sp: number; ph: number }[] = [];
  private flyCars: FlyCar[] = []; private carTimer = 2;
  private trainX = -9999; private trainTimer = 14;
  private birds: { x: number; y: number; ph: number }[] = []; private birdTimer = 8;

  // boss
  private boss = false; private bossTimer = 0; private bossHint = "";
  private nextBossDist = 2000; private bossFireTimer = 0; private bossX = 0;
  private bossHp = 0; private bossHpMax = 8; private coreTimer = 0;

  // time attack
  private timeLeft = 60;

  // NULL — the hunting AI. Random glitches + broadcasts build dread.
  private glitchAmt = 0; // 0..1 corruption intensity this frame
  private nullTimer = 8; // countdown to next NULL event
  private broadcast = ""; // current on-screen radio/AI line
  private broadcastTimer = 0;
  private lockdown = 0; // brief red screen tint during lockdowns
  private threat = 1; // NULL threat level 1..5 — escalates with distance
  private threatPulse = 0; // flash when threat rises
  private nextMilestone = 500; // distance checkpoints every 500M

  // Per-run objective — a mini-mission that makes every run tell a story.
  private objective: { id: string; label: string; target: number; progress: number; reward: number; done: boolean } | null = null;
  private objTimer = 0; // for time-based objectives

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.cb = cb;
    this.resize();
  }

  // -- lifecycle -----------------------------------------------------------
  setBest(b: number) { this.best = b; }
  setSettings(s: EngineSettings) {
    const prevFx = this.settings.highFx;
    this.settings = { ...this.settings, ...s };
    if (prevFx !== this.settings.highFx) this.resize(); // re-apply DPR cap
  }
  setLoadout(l: Loadout) { this.loadout = l; }

  resize() {
    // cap DPR — fast mode renders at lower resolution for big perf gains
    const cap = this.settings.highFx ? 2 : 1.35;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const rect = this.canvas.getBoundingClientRect();
    // fall back to window size if the canvas hasn't been laid out yet
    this.W = rect.width || window.innerWidth || 360;
    this.H = rect.height || window.innerHeight || 640;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = this.H / REF_H;
    this.groundY = this.H * 0.8;
    // +15% player size for a more heroic, readable character on screen
    this.pw = 53 * this.scale; this.ph = 71 * this.scale;
    this.px = this.W * 0.24;
    if (this.state === "ready" || this.state === "dead") this.py = this.groundY - this.ph;
    // overscan = max shake(26) + look-ahead(W*0.03) + vert follow(H*0.09) + zoom(6%) + safety
    this.OX = Math.ceil(26 + this.W * 0.03 + this.W * 0.06 + 24);
    this.OY = Math.ceil(26 + this.H * 0.09 + this.H * 0.06 + 24);
    this.vignetteCache = null;
    this.buildSky();
  }

  private buildSky() {
    this.stars = [];
    const n = Math.floor((this.W * this.H) / 26000);
    for (let i = 0; i < n; i++)
      this.stars.push({ x: Math.random() * this.W, y: Math.random() * this.groundY * 0.85, r: rand(0.4, 1.8) * this.scale, tw: Math.random() * Math.PI * 2 });
    this.rainDrops = [];
    for (let i = 0; i < 150; i++)
      this.rainDrops.push({ x: Math.random() * this.W, y: Math.random() * this.H, len: rand(10, 26) * this.scale, sp: rand(700, 1100) * this.scale });
    this.snowFlakes = [];
    for (let i = 0; i < 90; i++)
      this.snowFlakes.push({ x: Math.random() * this.W, y: Math.random() * this.H, r: rand(1.5, 3.5) * this.scale, sp: rand(50, 130) * this.scale, ph: Math.random() * 6 });
  }

  start(mode: GameMode) {
    this.mode = mode;
    this.reset();
    this.state = "running";
    audio.resume();
    audio.startMusic();
    this.lastT = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop(this.lastT);
  }

  private reset() {
    const s = this.scale;
    this.py = this.groundY - this.ph;
    this.vy = 0; this.onGround = true; this.jumps = 0;
    this.sliding = false; this.slideHeld = false; this.dashing = false; this.dashTimer = 0; this.dashCd = 0;
    this.airDashUsed = false; this.wallSliding = false;
    this.dead = false; this.hurtFlash = 0; this.landSquash = 0;
    this.speed = this.mode === "hardcore" ? BASE_SPEED * 1.35 : BASE_SPEED;
    this.distance = 0; this.elapsed = 0; this.worldX = 0;
    this.obstacles = []; this.collects = []; this.powers = [];
    this.particles = []; this.texts = []; this.rings = []; this.flyCoins = [];
    this.nextSpawnX = this.W + 200;
    this.coins = 0; this.crystals = 0; this.combo = 0; this.maxCombo = 0; this.multiplier = 1; this.comboTimer = 0;
    this.timeScale = 1;
    this.activePowers.clear();
    this.shieldCharges = this.loadout?.ability === "energyShield" ? 1 : 0;
    this.atlasTimer = 45; this.escapeCd = 0;
    this.stats = { jumps: 0, slides: 0, dashes: 0, perfectDodges: 0, bosses: 0, wallJumps: 0 };
    this.hitstop = 0; this.flash = 0; this.shake = 0; this.slowPulse = 0;
    this.camX = 0; this.camY = 0; this.zoom = 1; this.zoomTarget = 1;
    this.tuts = { slide: false, jump: false, dash: false, wall: false };
    this.paletteIdx = 0; this.weather = "clear"; this.weatherTimer = 12;
    this.boss = false; this.bossTimer = 0; this.bossHp = 0; this.bossFireTimer = 0;
    this.coreTimer = 0; this.bossX = 0;
    this.nextBossDist = this.mode === "bossrush" ? 350 : 2000;
    this.bossHint = "";
    this.timeLeft = 60;
    this.glitchAmt = 0; this.nullTimer = rand(10, 16); this.broadcast = ""; this.broadcastTimer = 0; this.lockdown = 0;
    this.threat = 1; this.threatPulse = 0;
    this.nextMilestone = 500;
    this.pickObjective();
    this.flyCars = []; this.birds = []; this.carTimer = 2; this.birdTimer = 8; this.trainTimer = 12;
    this.accum = 0;
    this.fpsSamples = [];
    void s;
  }

  pause() {
    if (this.state !== "running") return;
    this.state = "paused";
    audio.stopMusic();
    cancelAnimationFrame(this.raf);
    this.emitHud();
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "running";
    audio.resume(); audio.startMusic();
    this.lastT = performance.now();
    this.accum = 0;
    cancelAnimationFrame(this.raf);
    this.loop(this.lastT);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    audio.stopMusic();
    audio.stopAmbient();
  }

  private vibrate(ms: number) {
    if (this.settings.vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(ms); } catch { /* unsupported */ }
    }
  }

  // -- input ---------------------------------------------------------------
  jump() {
    if (this.state !== "running") return;
    this.jumpBuffer = JUMP_BUFFER;
    this.tryJump();
  }
  private maxJumps() {
    return this.loadout?.ability === "tripleJump" ? 3 : 2;
  }
  private tryJump() {
    if (this.jetpackActive()) return;
    if (this.wallSliding) {
      this.vy = JUMP_V * 0.98 * this.scale;
      this.wallSliding = false;
      this.jumps = 1;
      this.jumpBuffer = 0;
      this.stats.wallJumps++;
      audio.wallJump();
      this.spawnBurst(this.px + this.pw, this.py + this.ph * 0.5, 10, this.loadout?.glow ?? "#22d3ee", 0.5);
      this.floatText(this.px, this.py - 10 * this.scale, "WALL JUMP", "#7dd3fc");
      return;
    }
    const pj = this.loadout?.personality.jumpMul ?? 1;
    if (this.onGround || this.coyote > 0) {
      const mult = (this.loadout?.ability === "tripleJump" ? 1.04 : 1) * pj;
      this.vy = JUMP_V * mult * this.scale;
      this.onGround = false; this.jumps = 1; this.coyote = 0; this.jumpBuffer = 0;
      this.sliding = false;
      this.stats.jumps++;
      audio.jump();
      this.spawnDust(9);
    } else if (this.jumps < this.maxJumps()) {
      this.vy = DOUBLE_JUMP_V * pj * this.scale;
      this.jumps++;
      this.jumpBuffer = 0;
      this.stats.jumps++;
      audio.doubleJump();
      this.spawnBurst(this.px + this.pw / 2, this.py + this.ph, 12, this.loadout?.glow ?? "#22d3ee", 0.5);
    }
  }
  slideStart() {
    if (this.state !== "running" || this.jetpackActive()) return;
    this.slideHeld = true;
    if (this.onGround) {
      if (!this.sliding) this.stats.slides++;
      this.sliding = true; this.slideTimer = 0.6;
      audio.slide();
      this.spawnDust(8);
    } else {
      this.vy = Math.max(this.vy, 950 * this.scale); // fast-fall then slide on land
    }
  }
  slideEnd() { this.slideHeld = false; this.slideTimer = Math.min(this.slideTimer, 0.12); }
  dashStart() {
    if (this.state !== "running") return;
    if (this.dashCd > 0) return;
    if (!this.onGround && this.airDashUsed) return;
    if (!this.onGround) this.airDashUsed = true;
    this.dashing = true; this.dashTimer = DASH_TIME; this.dashCd = DASH_COOLDOWN;
    this.stats.dashes++;
    audio.dash();
    this.shakeCam(5);
    this.zoomTarget = 1.06; // punchy cinematic dash zoom
    // character abilities tied to dash
    const ab = this.loadout?.ability;
    if (ab === "timeDash") this.timeScale = 0.45;
    if (ab === "overdrive") {
      this.activePowers.set("speedBoost", Math.max(this.activePowers.get("speedBoost") ?? 0, 1.6));
      this.activePowers.set("invincibility", Math.max(this.activePowers.get("invincibility") ?? 0, 0.8));
    }
  }
  dashEnd() { /* dash is a timed burst; reserved for hold mechanics */ }

  // -- helpers -------------------------------------------------------------
  private palette(): Palette { return PALETTES[this.paletteIdx % PALETTES.length]; }
  private hazardColor(): string { return this.settings.colorblind ? "#ff9f1c" : "#f43f5e"; }
  private jetpackActive() { return (this.activePowers.get("jetpack") ?? 0) > 0; }
  private isInvincible() {
    const ab = this.loadout?.ability;
    return (
      (this.activePowers.get("invincibility") ?? 0) > 0 ||
      this.jetpackActive() ||
      this.hurtFlash > 0.9 ||
      (ab === "phaseDash" && this.dashing)
    );
  }
  private playerRect(): Rect {
    const h = this.sliding ? this.ph * 0.52 : this.ph;
    const shrink = this.pw * 0.16;
    return { x: this.px + shrink, y: this.py + (this.ph - h) + this.ph * 0.06, w: this.pw - shrink * 2, h: h - this.ph * 0.1 };
  }
  private shakeCam(a: number) { if (this.settings.shake) this.shake = Math.min(this.shake + a, 26); }
  private floatText(x: number, y: number, text: string, color: string, size = 16) {
    this.texts.push({ x, y, text, color, life: 1.1, size: size * this.scale });
    if (this.texts.length > 12) this.texts.shift();
  }

  // -- main loop -----------------------------------------------------------
  private loop = (t: number) => {
    if (this.state !== "running") return;
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.1) dt = 0.1; // ignore huge gaps (tab return etc.)

    this.monitorFps(dt);

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      if (this.hitstop < 0) this.hitstop = 0;
      this.render(); // freeze frame — the "hit pause"
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    // Fixed-timestep sub-stepping: guarantees collisions never tunnel and the
    // simulation stays identical across 30Hz, 60Hz and 120Hz displays.
    const STEP = 1 / 120;
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP && steps < 8) {
      this.update(STEP);
      this.accum -= STEP;
      steps++;
      if (this.state !== "running") break; // died mid-step
    }
    // drain any remaining time if we hit the step cap (avoid spiral of death)
    if (steps >= 8) this.accum = 0;

    if (this.state === "running") this.render();
    this.raf = requestAnimationFrame(this.loop);
  };
  private accum = 0;

  // Watch frame times; if the device sustains <45fps with effects on, drop to
  // fast mode automatically so the game stays playable on weak hardware.
  private monitorFps(dt: number) {
    if (this.autoDowngraded || !this.settings.highFx || dt <= 0) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length > 90) this.fpsSamples.shift();
    if (this.fpsSamples.length >= 90) {
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      if (avg < 45) {
        this.autoDowngraded = true;
        this.settings.highFx = false;
        this.resize(); // apply lower DPR
        this.floatText(this.px, this.py - 30 * this.scale, "PERFORMANCE MODE", "#fbbf24", 13);
      }
    }
  }

  private update(dt: number) {
    this.elapsed += dt;
    this.animTime += dt * (this.dashing ? 2.2 : 1);

    // ability-driven slow-mo restoration
    if (this.loadout?.ability !== "timeDash" || !this.dashing) {
      // slowPulse (perfect dodge) handled below
    }
    if (this.dashing && this.loadout?.ability === "timeDash") {
      // keep slowed while dashing
    } else if (this.timeScale < 1 && (this.activePowers.get("slowMotion") ?? 0) <= 0) {
      this.timeScale = Math.min(1, this.timeScale + dt * 2.5);
    }
    if (this.slowPulse > 0) {
      this.slowPulse -= dt;
      this.timeScale = Math.min(this.timeScale, 0.4);
    }
    if ((this.activePowers.get("slowMotion") ?? 0) > 0) this.timeScale = 0.55;

    let ramp = this.elapsed * SPEED_RAMP * (this.loadout?.personality.accelMul ?? 1);
    let effSpeed = Math.min(BASE_SPEED + ramp, MAX_SPEED) * this.scale;
    if (this.mode === "hardcore") effSpeed *= 1.3;
    if (this.loadout?.ability === "overdrive" && this.loadout.id === "rift") effSpeed *= 1.08;
    if ((this.activePowers.get("speedBoost") ?? 0) > 0) effSpeed *= 1.35;
    if (this.dashing) effSpeed *= 1.9;
    this.speed = effSpeed;

    const worldSpeed = this.speed * this.timeScale;
    const move = worldSpeed * dt;
    this.worldX += move;
    this.distance += (move / this.scale) * 0.1;

    // distance checkpoint celebrations every 500M
    if (this.distance >= this.nextMilestone) {
      this.floatText(this.px + this.pw / 2, this.py - 22 * this.scale, `${this.nextMilestone}M`, "#fbbf24", 22);
      this.rings.push({ x: this.px + this.pw / 2, y: this.py + this.ph / 2, r: this.pw, max: this.W * 0.3, color: "#fbbf24", life: 1 });
      this.slowPulse = 0.2;
      this.coins += 10 + Math.floor(this.nextMilestone * 0.02);
      audio.perfect();
      this.nextMilestone += 500;
    }

    // combo decay — lose combo if you don't collect/dodge for 4 seconds
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && this.combo > 0) {
      this.combo = Math.max(0, this.combo - 1);
    }
    this.multiplier = 1 + Math.floor(this.combo / 8) + ((this.activePowers.get("speedBoost") ?? 0) > 0 ? 1 : 0);

    const targetPalette = Math.floor(this.distance / 600) % PALETTES.length;
    if (targetPalette !== this.paletteIdx) {
      this.paletteIdx = targetPalette;
      const name = PALETTES[this.paletteIdx].name;
      this.broadcast = `◤ ENTERING ${name.toUpperCase()}`;
      this.broadcastTimer = 3;
      this.flash = 0.3;
      this.flashColor = PALETTES[this.paletteIdx].neon;
    }

    this.updateWeather(dt);
    this.updateCity(dt);
    this.updatePlayer(dt);
    this.updatePowerTimers(dt);
    this.updateSpawning(move);
    this.updateEntities(move, dt);
    this.updateParticles(dt * this.timeScale);
    this.updateRings(dt);
    this.updateFlyCoins(dt);
    this.updateTexts(dt);
    this.updateNull(dt);
    this.updateObjective(dt);
    this.updateBoss(dt);

    // time attack countdown
    if (this.mode === "timeattack") {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.die(true); }
    }

    // ambient weather sounds
    if (this.weather !== this.weatherAmbientStarted) {
      this.weatherAmbientStarted = this.weather;
      audio.startAmbient(this.weather);
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(30, 55);
      if (Math.random() < 0.3) audio.siren();
    }

    // adaptive music intensity
    audio.setIntensity(this.boss ? 2 : this.speed > 620 * this.scale ? 1 : 0);

    // camera
    this.shake *= Math.pow(0.001, dt);
    if (this.shake < 0.4) this.shake = 0;
    this.shakeX = rand(-1, 1) * this.shake;
    this.shakeY = rand(-1, 1) * this.shake;
    // cinematic camera: look-ahead by speed + gentle vertical follow on jumps
    const lookTarget = -Math.min(1, this.speed / (MAX_SPEED * this.scale)) * this.W * 0.03;
    const floor = this.groundY - this.ph;
    const airRise = Math.max(0, floor - this.py);
    const vTarget = Math.min(this.H * 0.09, airRise * 0.22); // follow up a fraction
    this.camX += (lookTarget - this.camX) * Math.min(1, dt * 3);
    this.camY += (vTarget - this.camY) * Math.min(1, dt * 5);
    // dash zoom eases in, then relaxes back to 1
    if (!this.dashing) this.zoomTarget = 1;
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 8);
    this.flash = Math.max(0, this.flash - dt * 3);

    this.weatherDt = dt;
    this.hudTimer += dt;
    if (this.hudTimer > 0.06) { this.hudTimer = 0; this.emitHud(); }
  }

  private updateWeather(dt: number) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weather = choice(WEATHERS);
      this.weatherTimer = rand(14, 24);
    }
    if (this.weather === "storm" && Math.random() < dt * 0.35) {
      this.lightning = 0.4;
      audio.thunder();
    }
    this.lightning = Math.max(0, this.lightning - dt * 1.5);
  }

  private updateCity(dt: number) {
    const s = this.scale;
    // flying cars
    this.carTimer -= dt;
    if (this.carTimer <= 0 && this.flyCars.length < 6) {
      this.carTimer = rand(1.2, 3.5);
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      this.flyCars.push({
        x: dir === 1 ? -100 : this.W + 100,
        y: rand(this.H * 0.12, this.groundY * 0.55),
        sp: rand(180, 420) * s,
        color: choice(["#22d3ee", "#f472b6", "#fbbf24", "#a855f7"]),
        len: rand(26, 46) * s,
        dir,
      });
    }
    for (const c of this.flyCars) c.x += c.sp * c.dir * dt;
    this.flyCars = this.flyCars.filter((c) => c.x > -200 && c.x < this.W + 200);

    // background train
    this.trainTimer -= dt;
    if (this.trainTimer <= 0) {
      this.trainTimer = rand(16, 30);
      this.trainX = this.W + 200;
      audio.trainHorn();
    }
    if (this.trainX > -1200) this.trainX -= 500 * s * dt;

    // birds
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && this.birds.length < 5) {
      this.birdTimer = rand(6, 14);
      const y = rand(this.H * 0.08, this.H * 0.3);
      for (let i = 0; i < 4; i++) this.birds.push({ x: this.W + 40 + i * 22 * s, y: y + rand(-10, 10) * s, ph: Math.random() * 6 });
    }
    for (const b of this.birds) { b.x -= 120 * s * dt; b.ph += dt * 10; }
    this.birds = this.birds.filter((b) => b.x > -40);

    // occasional steam vent puffs from the road
    if (this.settings.particles && Math.random() < dt * 0.8) {
      const x = rand(this.W * 0.5, this.W);
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: x + rand(-4, 4) * s, y: this.groundY,
          vx: rand(-15, 15) * s, vy: rand(-90, -40) * s,
          life: rand(0.6, 1.2), max: 1.2, size: rand(3, 7) * s,
          color: "rgba(200,210,230,0.25)", gravity: -40 * s,
        });
      }
    }
  }

  private updatePlayer(dt: number) {
    const s = this.scale;
    this.coyote = this.onGround ? COYOTE_TIME : this.coyote - dt;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.escapeCd = Math.max(0, this.escapeCd - dt);

    if (this.dashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) { this.dashing = false; if (this.loadout?.ability === "timeDash") this.timeScale = 1; }
      if (this.settings.particles) {
        this.emitSignature(this.px, this.py + this.ph * 0.5, 0.6);
        if (Math.random() < 0.5) this.emitSignature(this.px + this.pw * 0.4, this.py + this.ph * 0.3, 0.5);
      }
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      // keep sliding as long as the button is held and we're grounded
      if (this.slideHeld && this.onGround) this.slideTimer = Math.max(this.slideTimer, 0.1);
      if (this.slideTimer <= 0) this.sliding = false;
      if (this.settings.particles) {
        // signature sparks/smoke while sliding
        if (Math.random() < 0.6) this.emitSignature(this.px, this.py + this.ph * 0.9, 0.4);
        this.spawnDust(1);
      }
    }
    // ambient signature emission (subtle, keeps each hero visually distinct)
    if (this.settings.particles && this.settings.highFx) {
      const p = this.loadout?.personality;
      if (p && Math.random() < 0.12 * p.trailIntensity) {
        this.emitSignature(this.px + this.pw * 0.3, this.py + this.ph * 0.55, 0.25);
      }
    }
    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0 || this.wallSliding)) this.tryJump();

    // ATLAS shield regen
    if (this.loadout?.ability === "energyShield") {
      this.atlasTimer -= dt;
      if (this.atlasTimer <= 0) {
        this.atlasTimer = 45;
        if (this.shieldCharges < 2) {
          this.shieldCharges++;
          this.floatText(this.px, this.py - 14 * s, "SHIELD UP", "#38bdf8");
          audio.powerup();
        }
      }
    }

    if (this.jetpackActive()) {
      const targetY = this.groundY - this.ph - this.H * 0.28;
      this.vy += (targetY - this.py) * 6 * dt;
      this.vy *= 0.9;
      this.py += this.vy * dt;
      this.onGround = false;
      if (this.settings.particles && Math.random() < 0.8)
        this.spawnBurst(this.px + this.pw * 0.2, this.py + this.ph, 2, "#f97316", 0.4);
    } else {
      let g = BASE_GRAVITY * s * (this.loadout?.personality.gravityMul ?? 1);
      if (this.loadout?.ability === "tripleJump") g *= 0.86;
      if (this.wallSliding) g *= 0.25;
      this.vy += g * dt;
      this.py += this.vy * dt;
    }

    // wall-slide detection against block/wall fronts
    this.wallSliding = false;
    if (!this.onGround && this.vy > 0 && !this.jetpackActive()) {
      const pr = this.playerRect();
      for (const o of this.obstacles) {
        if (o.kind !== "block" && o.kind !== "wall") continue;
        // generous cling zone so wall jumps read as responsive
        const front: Rect = { x: o.x - 14 * s, y: o.y + 2 * s, w: 26 * s, h: o.h - 4 * s };
        if (overlap(pr, front)) {
          this.wallSliding = true;
          this.jumps = Math.min(this.jumps, 1); // keep one air jump
          if (this.settings.particles && Math.random() < 0.3) this.spawnDust(1);
          break;
        }
      }
    }

    // ground / pit resolution
    const overPit = this.obstacles.some(
      (o) => o.kind === "pit" && this.px + this.pw * 0.5 > o.x && this.px + this.pw * 0.5 < o.x + o.w,
    );
    const floor = this.groundY - this.ph;
    if (!this.jetpackActive()) {
      if (this.py >= floor && !overPit) {
        if (!this.onGround && this.vy > 200 * s) {
          const shock = this.loadout?.personality.landShock ?? 0.5;
          this.spawnDust(Math.min(16, Math.floor(this.vy / (120 * s)) + Math.round(shock * 3)));
          this.shakeCam(Math.min(6, this.vy / (400 * s)) * (0.6 + shock));
          audio.land();
          // signature landing shockwave ring
          if (this.settings.particles && this.vy > 380 * s) {
            const col = this.loadout?.personality.sigColor ?? "#22d3ee";
            this.rings.push({ x: this.px + this.pw / 2, y: this.groundY, r: this.pw * 0.4, max: this.pw * (2 + shock * 2.5), color: col, life: 1 });
          }
          // perfect landing: fall hard and jump again immediately
          if (this.vy > 720 * s && this.jumpBuffer > 0) {
            this.floatText(this.px, this.py - 12 * s, "PERFECT LANDING", "#4ade80", 14);
            this.combo += 2;
            this.activePowers.set("speedBoost", Math.max(this.activePowers.get("speedBoost") ?? 0, 0.8));
            audio.perfect();
          }
        }
        const fallVy = this.vy; // capture before zeroing
        this.py = floor; this.vy = 0; this.onGround = true;
        this.jumps = 0; this.airDashUsed = false; this.wallSliding = false;
        this.landSquash = Math.min(1, fallVy / (800 * s)); // squash proportional to fall speed
        // resume slide immediately if the player is still holding down
        if (this.slideHeld && !this.sliding) { this.sliding = true; this.slideTimer = 0.6; }
      } else {
        this.onGround = false;
      }
    }

    if (this.py > this.H + this.ph) {
      if (this.mode === "training") {
        // training: teleport back to ground instead of dying
        this.py = this.groundY - this.ph;
        this.vy = 0;
        this.onGround = true;
        this.spawnBurst(this.px + this.pw / 2, this.groundY, 12, "#94a3b8", 0.5);
        audio.land();
      } else {
        this.die(true);
      }
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.landSquash = Math.max(0, this.landSquash - dt * 8); // fast decay ~3 frames
  }

  private updatePowerTimers(dt: number) {
    for (const [k, v] of this.activePowers) {
      const nv = v - dt;
      if (nv <= 0) this.activePowers.delete(k);
      else this.activePowers.set(k, nv);
    }
  }

  // -- spawning ------------------------------------------------------------
  private lastPattern = "";
  private updateSpawning(move: number) {
    this.nextSpawnX -= move;
    if (this.nextSpawnX > this.W) return;
    if (this.boss) { this.nextSpawnX = this.W + rand(240, 380); return; }
    const diff = Math.min(1, this.elapsed / 120);
    this.spawnPattern(this.W + 60, diff);
    // minimum gap scales with speed so players always have time to react
    const baseGap = Math.max(280, 420 - diff * 140);
    const speedFactor = Math.min(1.5, this.speed / (BASE_SPEED * this.scale));
    const gap = rand(baseGap, baseGap + 160) * speedFactor;
    this.nextSpawnX = this.W + 60 + gap;
  }

  private spawnPattern(x: number, diff: number) {
    const s = this.scale;
    const gY = this.groundY;
    let roll = Math.random();
    // prevent same pattern twice in a row
    const patterns = ["block","laser","drone","pit","combo","wall","stairs","gauntlet","coins"];
    const idx = roll < 0.2 ? 0 : roll < 0.36 ? 1 : roll < 0.5 ? 2 : roll < 0.64 ? 3 : roll < 0.78 ? 4 : roll < 0.9 ? 5 : roll < 0.94 ? 6 : roll < 0.97 ? 7 : 8;
    if (patterns[idx] === this.lastPattern) {
      roll = (roll + 0.25) % 1;
    }
    this.lastPattern = patterns[Math.min(8, idx)];
    if (Math.random() < 0.16) this.spawnPower(x + rand(60, 160), gY - this.H * rand(0.14, 0.3));

    if (roll < 0.2) {
      const w = rand(40, 66) * s, h = rand(46, 78) * s;
      this.obstacles.push({ kind: choice(["block", "roller"] as const), x, y: gY - h, w, h });
      this.coinArc(x - 40 * s, gY - h - 30 * s, 6, 60 * s);
    } else if (roll < 0.36) {
      const h = rand(40, 60) * s;
      const lw = rand(60, 90) * s;
      this.obstacles.push({ kind: "laser", x, y: gY - this.ph * 0.95 - h, w: lw, h });
      this.coinLine(x + 5 * s, gY - this.ph * 0.28, 4, 36 * s);
      if (!this.tuts.slide && this.elapsed < 30) {
        this.tuts.slide = true;
        this.floatText(x - 40 * s, gY - this.ph * 0.6, "↓ SLIDE", "#38bdf8", 18);
      }
    } else if (roll < 0.5) {
      this.obstacles.push({ kind: "drone", x, y: gY - this.ph * 1.15, w: 54 * s, h: 40 * s, phase: Math.random() * Math.PI * 2 });
      this.coinArc(x - 20 * s, gY - this.ph - 40 * s, 5, 55 * s);
    } else if (roll < 0.64) {
      const w = rand(90, 150 + diff * 90) * s;
      this.obstacles.push({ kind: "pit", x, y: gY, w, h: this.H - gY });
      this.coinArc(x, gY - 70 * s, 7, w + 20 * s);
    } else if (roll < 0.78) {
      const w = 46 * s, h = 56 * s;
      this.obstacles.push({ kind: "block", x, y: gY - h, w, h });
      this.obstacles.push({ kind: "electric", x: x + 150 * s, y: gY - h, w, h: h * 0.7 });
      this.coinArc(x - 20 * s, gY - h - 60 * s, 8, 200 * s);
    } else if (roll < 0.9) {
      const w = 40 * s, h = rand(80, 110) * s;
      this.obstacles.push({ kind: "wall", x, y: gY - h, w, h });
      this.coinLine(x + 60 * s, gY - h - 20 * s, 4, 40 * s);
      if (!this.tuts.wall && this.elapsed < 60) {
        this.tuts.wall = true;
        this.floatText(x - 30 * s, gY - h * 0.6, "WALL JUMP →", "#7dd3fc", 14);
      }
    } else if (roll < 0.94) {
      // staircase: ascending blocks with coins on top — test double jump
      for (let st = 0; st < 3; st++) {
        const bh = (40 + st * 28) * s;
        const bw = 38 * s;
        const bx = x + st * 80 * s;
        this.obstacles.push({ kind: "block", x: bx, y: gY - bh, w: bw, h: bh });
        this.collects.push({ kind: st === 2 ? "chip" : "coin", x: bx + bw / 2, y: gY - bh - 22 * s, r: 11 * s, bob: Math.random() * 6 });
      }
    } else if (roll < 0.97) {
      // gauntlet: block + overhead laser = must jump then immediately slide
      const bw = rand(40, 56) * s, bh = rand(46, 62) * s;
      this.obstacles.push({ kind: "block", x, y: gY - bh, w: bw, h: bh });
      const lw = rand(50, 70) * s;
      this.obstacles.push({ kind: "laser", x: x + bw + 90 * s, y: gY - this.ph * 0.95 - 40 * s, w: lw, h: 40 * s });
      this.coinArc(x - 20 * s, gY - bh - 40 * s, 5, 140 * s);
    } else {
      // coin field + rare crystal
      this.coinArc(x, gY - 90 * s, 10, 320 * s);
      if (Math.random() < 0.5)
        this.collects.push({ kind: "crystal", x: x + 160 * s, y: gY - 150 * s, r: 16 * s, bob: Math.random() * 6 });
    }
  }

  private coinArc(x: number, baseY: number, n: number, span: number) {
    const s = this.scale;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.collects.push({
        kind: Math.random() < 0.06 ? "chip" : "coin",
        x: x + t * span, y: baseY - Math.sin(t * Math.PI) * 60 * s,
        r: 11 * s, bob: Math.random() * 6,
      });
    }
  }
  private coinLine(x: number, y: number, n: number, gap: number) {
    for (let i = 0; i < n; i++) this.collects.push({ kind: "coin", x: x + i * gap, y, r: 11 * this.scale, bob: Math.random() * 6 });
  }
  private spawnPower(x: number, y: number) {
    const types: PowerupType[] = ["magnet", "shield", "doubleCoins", "slowMotion", "invincibility", "speedBoost", "jetpack"];
    this.powers.push({ type: choice(types), x, y, r: 18 * this.scale, bob: Math.random() * 6 });
  }

  // -- entities ------------------------------------------------------------
  private updateEntities(move: number, dt: number) {
    const s = this.scale;
    const pr = this.playerRect();
    const magnet = (this.activePowers.get("magnet") ?? 0) > 0;
    const dbl = (this.activePowers.get("doubleCoins") ?? 0) > 0;
    const zara = this.loadout?.ability === "hackDrones";

    for (const o of this.obstacles) {
      o.x -= move;
      // missiles fly toward player (extra leftward velocity)
      if (o.kind === "missile" && o.vy) {
        o.x -= o.vy * s * dt;
      }
      if (o.kind === "drone" && o.phase !== undefined) { o.phase += dt * 3; o.y += Math.sin(o.phase) * 0.6 * s; }
      if (!o.hit && o.kind !== "pit") {
        if (overlap(pr, o)) {
          this.onObstacleHit(o);
        } else {
          const g = gapBetween(pr, o);
          if (o.bestGap === undefined || g < o.bestGap) o.bestGap = g;
        }
      }
      // perfect dodge evaluation once fully passed
      if (!o.counted && o.x + o.w < this.px) {
        o.counted = true;
        if (!o.hit && o.bestGap !== undefined && o.bestGap < 28 * s && o.bestGap > 0 && o.kind !== "missile") {
          this.stats.perfectDodges++;
          if (this.objective?.id === "perfect") this.objProgress(1);
          this.combo += 2;
          this.comboTimer = 3;
          this.slowPulse = 0.28;
          this.floatText(this.px + this.pw, this.py - 8 * s, "PERFECT", "#4ade80", 16);
          audio.perfect();
          this.spawnBurst(this.px + this.pw, this.py + this.ph / 2, 8, "#4ade80", 0.4, true);
        }
        if (zara && o.kind === "drone" && !o.hit) {
          this.coins += 3 * this.multiplier;
          this.floatText(o.x + o.w, o.y, "+HACK", "#ff2ed1", 12);
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -120);

    for (const c of this.collects) {
      c.x -= move;
      c.bob += dt * 4;
      if (c.taken) continue;
      if (magnet && c.kind !== "crystal" && c.kind !== "core") {
        const dx = this.px + this.pw / 2 - c.x, dy = this.py + this.ph / 2 - c.y;
        const d = Math.hypot(dx, dy);
        if (d < 260 * s) { c.x += (dx / d) * 620 * s * dt; c.y += (dy / d) * 620 * s * dt; }
      }
      if (overlap(pr, { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 })) {
        c.taken = true;
        this.collect(c, dbl);
      }
    }
    this.collects = this.collects.filter((c) => !c.taken && c.x + c.r > -40);

    for (const p of this.powers) {
      p.x -= move;
      p.bob += dt * 3;
      if (p.taken) continue;
      if (overlap(pr, { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 })) {
        p.taken = true;
        this.activatePower(p.type);
      }
    }
    this.powers = this.powers.filter((p) => !p.taken && p.x + p.r > -40);
  }

  private collect(c: Collectible, dbl: boolean) {
    if (c.kind === "crystal") {
      this.crystals++;
      audio.crystal();
      this.spawnBurst(c.x, c.y, 18, "#c084fc", 0.7, true);
      if (this.flyCoins.length < 16) {
        const sx = c.x + this.shakeX + this.camX, sy = c.y + this.shakeY + this.camY;
        for (let i = 0; i < 3; i++)
          this.flyCoins.push({ x: sx + rand(-8, 8), y: sy + rand(-8, 8), tx: 120, ty: 22, life: 1.2, color: "#c084fc" });
      }
    } else if (c.kind === "core") {
      this.bossHp = Math.max(0, this.bossHp - 1);
      audio.laser();
      this.spawnBurst(c.x, c.y, 16, "#f43f5e", 0.8, true);
      this.floatText(c.x, c.y - 10 * this.scale, "HACKED", "#f87171", 14);
      this.shakeCam(4);
      if (this.bossHp <= 0) this.defeatBoss();
    } else {
      const val = (c.kind === "chip" ? 5 : 1) * (dbl ? 2 : 1) * this.multiplier;
      this.coins += val;
      this.combo++;
      this.comboTimer = 4;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      audio.coin();
      this.spawnBurst(c.x, c.y, 5, this.palette().accent, 0.4);
      // score popup
      if (val >= 3) this.floatText(c.x, c.y - 10 * this.scale, `+${val}`, "#fbbf24", 12);
      // coin-fly-to-HUD animation (convert world→screen for the fly particle)
      if (this.flyCoins.length < 12) {
        const sx = c.x + this.shakeX + this.camX;
        const sy = c.y + this.shakeY + this.camY;
        this.flyCoins.push({ x: sx, y: sy, tx: 60, ty: 22, life: 1, color: c.kind === "chip" ? "#38bdf8" : "#fbbf24" });
      }
      if (this.objective?.id === "coins") this.objProgress(val);
      if (this.objective?.id === "cores" && c.kind === "chip") this.objProgress(1); // data chips = energy cores
    }
  }

  private activatePower(type: PowerupType) {
    audio.powerup();
    this.spawnBurst(this.px + this.pw / 2, this.py + this.ph / 2, 16, this.loadout?.glow ?? "#22d3ee", 0.7, true);
    if (type === "shield") this.shieldCharges = Math.min(this.shieldCharges + 1, 3);
    else this.activePowers.set(type, POWER_DURATION[type]);
    this.shakeCam(4);
  }

  private onObstacleHit(o: Obstacle) {
    const immuneToElectric = this.loadout?.ability === "hackDrones"; // EMP resistance
    if (o.kind === "electric" && immuneToElectric) { o.hit = true; return; }
    if (this.isInvincible()) {
      o.hit = true;
      const bonus = this.loadout?.ability === "energyShield" ? 2 : 0;
      if (bonus) this.coins += bonus;
      this.spawnBurst(o.x + o.w / 2, o.y + o.h / 2, 16, this.palette().accent, 0.6, true);
      audio.explosion();
      this.shakeCam(6);
      if (this.dashing && this.objective?.id === "dashes") this.objProgress(1); // dashed through a hazard
      return;
    }
    if (this.mode === "training") {
      o.hit = true;
      this.spawnBurst(this.px + this.pw / 2, this.py, 8, "#94a3b8", 0.4);
      return;
    }
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      o.hit = true;
      this.hurtFlash = 1.0;
      this.hitstop = 0.07;
      audio.hit();
      this.vibrate(60);
      this.spawnBurst(this.px + this.pw / 2, this.py + this.ph / 2, 18, "#38bdf8", 0.6, true);
      this.shakeCam(10);
      this.flash = 0.5; this.flashColor = "#38bdf8";
      this.combo = 0;
      // "avoid detection" objective resets its no-hit streak
      if (this.objective?.id === "nohit" && !this.objective.done) { this.objective.progress = 0; this.objBaseDist = this.distance; }
      return;
    }
    // VOID critical escape
    if (this.loadout?.ability === "phaseDash" && this.escapeCd <= 0) {
      this.escapeCd = 40;
      o.hit = true;
      this.activePowers.set("invincibility", 1.6);
      this.hurtFlash = 1.4;
      this.hitstop = 0.08;
      audio.powerup();
      this.floatText(this.px, this.py - 14 * this.scale, "CRITICAL ESCAPE", "#a855f7", 15);
      return;
    }
    this.die(false);
    this.spawnBurst(o.x + o.w / 2, o.y + o.h / 2, 22, "#f97316", 0.9, true);
  }

  private die(fell: boolean) {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.hitstop = 0.12;
    this.flash = 0.7; this.flashColor = fell ? "#0ea5e9" : "#f43f5e";
    audio.stopMusic();
    audio.stopAmbient();
    fell ? audio.hit() : audio.explosion();
    this.vibrate(180);
    this.shakeCam(22);
    this.spawnBurst(this.px + this.pw / 2, this.py + this.ph / 2, 40, "#f97316", 1.1, true);
    cancelAnimationFrame(this.raf);
    this.emitHud();

    const timeBonus = this.mode === "timeattack" ? Math.floor(Math.max(0, this.timeLeft) * 10) : 0;
    const xp = Math.floor(this.distance * 1.2 + this.coins * 2 + this.crystals * 50 + this.maxCombo * 3 + this.stats.perfectDodges * 8 + timeBonus);
    const result: RunResult = {
      distance: Math.floor(this.distance),
      coins: this.coins,
      crystals: this.crystals,
      xp,
      maxCombo: this.maxCombo,
      stats: { ...this.stats },
      mode: this.mode,
      objectiveLabel: this.objective?.label ?? "",
      objectiveDone: this.objective?.done ?? false,
      threat: this.threat,
    };
    const deathStart = performance.now();
    this.lastT = performance.now();
    const anim = () => {
      if (this.state !== "dead") return; // aborted by retry/home
      const t = performance.now();
      const d = Math.min((t - this.lastT) / 1000, 1 / 30);
      this.lastT = t;
      this.updateParticles(d);
      this.updateTexts(d);
      this.shake *= 0.9;
      this.flash = Math.max(0, this.flash - d * 2);
      this.shakeX = rand(-1, 1) * this.shake;
      this.shakeY = rand(-1, 1) * this.shake;
      this.render();
      if (t - deathStart < 850) this.raf = requestAnimationFrame(anim);
      else this.cb.onGameOver(result);
    };
    this.raf = requestAnimationFrame(anim);
  }

  revive() {
    if (this.state !== "dead") return;
    this.dead = false;
    this.state = "running";
    this.py = this.groundY - this.ph;
    this.vy = 0; this.onGround = true; this.sliding = false;
    this.combo = 0;
    this.obstacles = this.obstacles.filter((o) => o.x > this.W * 0.7);
    this.activePowers.set("invincibility", 3);
    audio.resume(); audio.startMusic();
    this.lastT = performance.now();
    this.accum = 0;
    cancelAnimationFrame(this.raf);
    this.loop(this.lastT);
  }

  // -- boss ----------------------------------------------------------------
  // Choose a random per-run objective (a mini-mission for narrative variety).
  private pickObjective() {
    // targets tuned so a solid single run can complete one objective
    const pool: { id: string; label: string; target: number; reward: number }[] = [
      { id: "cores", label: "Collect {n} Data Cores", target: 5, reward: 120 },
      { id: "distance", label: "Reach the Safe Zone ({n}M)", target: 700, reward: 150 },
      { id: "survive", label: "Survive the NULL Hunt ({n}s)", target: 35, reward: 160 },
      { id: "perfect", label: "Pull off {n} perfect dodges", target: 4, reward: 180 },
      { id: "dashes", label: "Dash through {n} hazards", target: 6, reward: 130 },
      { id: "coins", label: "Recover {n} credits", target: 80, reward: 120 },
      { id: "nohit", label: "Avoid detection — no hits for {n}M", target: 500, reward: 200 },
    ];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.objective = { ...pick, label: pick.label.replace("{n}", String(pick.target)), progress: 0, done: false };
    this.objTimer = 0;
    this.objBaseDist = 0;
  }
  private objBaseDist = 0;

  private objProgress(amount: number) {
    if (!this.objective || this.objective.done) return;
    this.objective.progress = Math.min(this.objective.target, this.objective.progress + amount);
    if (this.objective.progress >= this.objective.target) this.completeObjective();
  }
  private completeObjective() {
    if (!this.objective || this.objective.done) return;
    this.objective.done = true;
    this.coins += this.objective.reward;
    this.floatText(this.px + this.pw / 2, this.py - 20 * this.scale, "MISSION COMPLETE", "#4ade80", 18);
    this.broadcast = "◤ OBJECTIVE COMPLETE — REWARD SECURED";
    this.broadcastTimer = 3;
    this.slowPulse = 0.4;
    audio.bossDown();
    this.spawnBurst(this.px + this.pw / 2, this.py + this.ph / 2, 24, "#4ade80", 0.8, true);
  }
  // Objectives that advance passively each frame (distance/survive/nohit).
  private updateObjective(dt: number) {
    const o = this.objective;
    if (!o || o.done) return;
    if (o.id === "distance") o.progress = Math.min(o.target, Math.floor(this.distance));
    else if (o.id === "survive") { this.objTimer += dt; o.progress = Math.min(o.target, Math.floor(this.objTimer)); }
    else if (o.id === "nohit") o.progress = Math.min(o.target, Math.floor(this.distance - this.objBaseDist));
    if (o.progress >= o.target && !o.done) this.completeObjective();
  }

  // NULL hunts the player: threat escalates with distance, driving danger.
  private updateNull(dt: number) {
    this.glitchAmt = Math.max(0, this.glitchAmt - dt * 2.5);
    this.lockdown = Math.max(0, this.lockdown - dt * 0.8);
    this.threatPulse = Math.max(0, this.threatPulse - dt * 1.5);
    if (this.broadcastTimer > 0) this.broadcastTimer -= dt;
    else this.broadcast = "";

    // Threat level 1..5 rises every ~800m (faster in hardcore).
    const step = this.mode === "hardcore" ? 600 : 800;
    const newThreat = Math.min(5, 1 + Math.floor(this.distance / step));
    if (newThreat > this.threat) {
      this.threat = newThreat;
      this.threatPulse = 1;
      this.glitchAmt = 0.8;
      this.broadcast = `◤ THREAT LEVEL ${this.threat} — NULL IS HUNTING`;
      this.broadcastTimer = 3.5;
      audio.nullVoice();
      audio.glitch();
      this.shakeCam(8);
    }

    if (this.boss) return; // NULL's boss is present, skip ambient events
    this.nullTimer -= dt;
    if (this.nullTimer <= 0) {
      // higher threat = more frequent NULL activity
      this.nullTimer = rand(20, 32) - this.threat * 2.5;
      const roll = Math.random();
      if (roll < 0.5) {
        this.broadcast = choice(NULL_LINES);
        this.broadcastTimer = 4;
        this.glitchAmt = 0.4 + this.threat * 0.1;
        audio.glitch();
        if (this.threat >= 3 && Math.random() < 0.6) audio.nullVoice();
      } else if (roll < 0.78) {
        this.broadcast = choice(STORY_LOGS);
        this.broadcastTimer = 4.5;
        this.glitchAmt = 0.3;
      } else {
        this.broadcast = "◤ SECURITY LOCKDOWN";
        this.broadcastTimer = 3;
        this.lockdown = 0.6 + this.threat * 0.08;
        this.glitchAmt = 0.9;
        audio.glitch();
        this.shakeCam(6);
      }
    }
  }

  private updateBoss(dt: number) {
    const s = this.scale;
    if (!this.boss && this.distance >= this.nextBossDist) {
      this.boss = true;
      this.bossTimer = 18;
      this.bossFireTimer = 1;
      this.bossHp = this.bossHpMax;
      this.coreTimer = 0;
      this.bossX = this.W * 0.82;
      this.bossHint = "⚠ OMEGA GUARDIAN DETECTED — HACK THE CORES";
      audio.bossAlarm();
      this.shakeCam(12);
    }
    if (!this.boss) return;

    this.bossTimer -= dt;
    this.bossX = this.W * 0.82 + Math.sin(this.elapsed * 1.5) * 30 * s;
    this.bossFireTimer -= dt;
    if (this.bossFireTimer <= 0) {
      this.bossFireTimer = Math.max(0.6, 1.3 - (18 - this.bossTimer) * 0.04);
      const targetY = this.groundY - this.pw * rand(0.4, 2.4);
      this.obstacles.push({ kind: "missile", x: this.bossX, y: targetY, w: 40 * s, h: 16 * s, vy: rand(200, 420) });
      audio.laser();
    }
    // spawn hack cores arcing toward the player
    this.coreTimer -= dt;
    if (this.coreTimer <= 0 && this.bossHp > 0) {
      this.coreTimer = 1.4;
      this.collects.push({
        kind: "core",
        x: this.W + 40 * s,
        y: this.groundY - rand(60, 220) * s,
        r: 15 * s,
        bob: Math.random() * 6,
      });
    }
    if (this.bossTimer <= 0) {
      this.boss = false;
      this.bossHint = "GUARDIAN RETREATS";
      this.nextBossDist += this.mode === "bossrush" ? 450 : 2000;
      setTimeout(() => { if (this.bossHint === "GUARDIAN RETREATS") this.bossHint = ""; }, 2200);
    }
  }

  private defeatBoss() {
    this.boss = false;
    this.stats.bosses++;
    this.bossHint = "GUARDIAN DESTROYED";
    this.nextBossDist += this.mode === "bossrush" ? 450 : 2000;
    // clear all boss missiles
    for (const o of this.obstacles) {
      if (o.kind === "missile" && !o.hit) {
        o.hit = true;
        this.spawnBurst(o.x, o.y, 6, "#f97316", 0.4);
      }
    }
    audio.bossDown();
    audio.explosion();
    this.shakeCam(18);
    this.flash = 0.6; this.flashColor = "#fbbf24";
    this.spawnBurst(this.bossX, this.groundY - this.H * 0.35, 50, "#f97316", 1.2, true);
    this.coins += 50 * this.multiplier;
    // reward chest
    const gY = this.groundY;
    for (let i = 0; i < 14; i++)
      this.collects.push({ kind: i % 5 === 0 ? "chip" : "coin", x: this.W + i * 34 * this.scale, y: gY - rand(50, 150) * this.scale, r: 12 * this.scale, bob: Math.random() * 6 });
    this.collects.push({ kind: "crystal", x: this.W + 120 * this.scale, y: gY - 140 * this.scale, r: 16 * this.scale, bob: 0 });
    setTimeout(() => { if (this.bossHint === "GUARDIAN DESTROYED") this.bossHint = ""; }, 2500);
  }

  // -- particles (pooled) --------------------------------------------------
  private getParticle(): Particle {
    return this.particlePool.pop() ?? { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#fff", gravity: 0 };
  }
  private spawnDust(n: number) {
    if (!this.settings.particles) return;
    for (let i = 0; i < n; i++) {
      const p = this.getParticle();
      p.x = this.px + rand(0, this.pw); p.y = this.py + this.ph;
      p.vx = rand(-90, -20) * this.scale; p.vy = rand(-120, -20) * this.scale;
      p.life = rand(0.3, 0.6); p.max = 0.6; p.size = rand(2, 5) * this.scale;
      p.color = "rgba(180,190,220,0.8)"; p.gravity = 500 * this.scale; p.glow = false;
      this.particles.push(p);
    }
  }
  // Emit a character's signature particle flavour (streaks, holo, shadow, etc.)
  private emitSignature(x: number, y: number, power: number) {
    const p = this.loadout?.personality;
    if (!p) return;
    const s = this.scale;
    const col = p.sigColor;
    const push = (vx: number, vy: number, life: number, size: number, color: string, gravity: number, glow: boolean) => {
      const pt = this.getParticle();
      pt.x = x; pt.y = y; pt.vx = vx; pt.vy = vy;
      pt.life = life; pt.max = life; pt.size = size; pt.color = color; pt.gravity = gravity; pt.glow = glow;
      this.particles.push(pt);
    };
    switch (p.signature) {
      case "streaks": // NEX — horizontal blue streaks
        push(rand(-260, -140) * s, rand(-8, 8) * s, rand(0.2, 0.4), rand(2, 4) * s, col, 0, true);
        break;
      case "holo": // ZARA — square digital pixels
        push(rand(-60, 40) * s, rand(-60, -10) * s, rand(0.4, 0.7), rand(2, 4) * s, Math.random() < 0.5 ? col : "#67e8f9", -30 * s, true);
        break;
      case "shadow": // VOID — rising purple smoke
        push(rand(-40, -10) * s, rand(-50, -20) * s, rand(0.5, 1), rand(4, 8) * s, "rgba(138,43,226,0.5)", -20 * s, false);
        break;
      case "electric": // RIFT — jittery arcs
        push(rand(-120, 60) * s, rand(-120, 60) * s, rand(0.15, 0.3), rand(1.5, 3) * s, Math.random() < 0.4 ? "#ffffff" : col, 0, true);
        break;
      case "jet": // LUNA — downward yellow jet
        push(rand(-30, 30) * s, rand(60, 160) * s, rand(0.2, 0.4), rand(2, 5) * s, col, 40 * s, true);
        break;
      case "shock": // ATLAS — heavy orange embers
        push(rand(-80, -20) * s, rand(-40, 10) * s, rand(0.4, 0.7), rand(3, 6) * s, col, 260 * s, true);
        break;
    }
    void power;
  }

  private spawnBurst(x: number, y: number, n: number, color: string, power = 0.5, glow = false) {
    if (!this.settings.particles) n = Math.min(n, 3);
    for (let i = 0; i < n; i++) {
      const p = this.getParticle();
      const a = Math.random() * Math.PI * 2;
      const sp = rand(60, 340) * power * this.scale;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.life = rand(0.3, 0.8) * (0.6 + power); p.max = 1;
      p.size = rand(2, 5) * this.scale; p.color = color;
      p.gravity = rand(200, 600) * this.scale; p.glow = glow;
      this.particles.push(p);
    }
    const cap = this.settings.highFx ? 600 : 220;
    while (this.particles.length > cap) this.particlePool.push(this.particles.shift()!);
  }
  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particlePool.push(p);
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
      }
    }
  }
  private updateTexts(dt: number) {
    for (const t of this.texts) { t.life -= dt; t.y -= 40 * this.scale * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }
  private updateRings(dt: number) {
    for (const r of this.rings) {
      r.r += (r.max - r.r) * Math.min(1, dt * 6);
      r.x -= this.speed * this.timeScale * dt * 0.35;
      r.life -= dt * 1.8;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }
  private updateFlyCoins(dt: number) {
    for (const f of this.flyCoins) {
      // ease toward top-left HUD corner (coin counter position)
      f.x += (f.tx - f.x) * Math.min(1, dt * 6);
      f.y += (f.ty - f.y) * Math.min(1, dt * 6);
      f.life -= dt * 1.6;
    }
    this.flyCoins = this.flyCoins.filter((f) => f.life > 0);
  }
  private drawRings() {
    const ctx = this.ctx;
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.6;
      ctx.strokeStyle = r.color;
      this.glowOn(r.color, 12 * this.scale);
      ctx.lineWidth = 3 * this.scale * r.life;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      this.glowOff();
    }
    ctx.globalAlpha = 1;
  }

  // -- HUD -----------------------------------------------------------------
  private emitHud() {
    const powers = Array.from(this.activePowers.entries()).map(([type, remaining]) => ({
      type, remaining, total: POWER_DURATION[type],
    }));
    const hud: HudState = {
      state: this.state,
      distance: Math.floor(this.distance),
      coins: this.coins,
      crystals: this.crystals,
      best: Math.max(this.best, Math.floor(this.distance)),
      speed: this.speed / this.scale,
      multiplier: this.multiplier,
      environment: this.palette().name,
      weather: this.weather,
      shieldCharges: this.shieldCharges,
      powerups: powers,
      boss: this.boss,
      bossHp: this.boss ? this.bossHp / this.bossHpMax : 0,
      bossHint: this.bossHint,
      combo: this.combo,
      dashReady: this.dashCd <= 0,
      timeLeft: this.mode === "timeattack" ? this.timeLeft : -1,
      threat: this.threat,
      objective: this.objective ? { ...this.objective, id: this.objective.id } : null,
    };
    this.cb.onHud(hud);
  }

  // =======================================================================
  // RENDERING
  // =======================================================================
  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shakeX + this.camX, this.shakeY + this.camY);
    // cinematic zoom around the player when dashing
    if (this.zoom !== 1) {
      const zx = this.px + this.pw / 2, zy = this.py + this.ph / 2;
      ctx.translate(zx, zy);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-zx, -zy);
    }
    this.drawSky();
    this.drawClouds();
    this.drawCityLife();
    this.drawParallax();
    this.drawGround();
    this.drawRings();
    this.drawCollectibles();
    this.drawPowerups();
    this.drawObstacles();
    if (this.boss) this.drawBossMech();
    this.drawPlayer();
    this.drawForeground();
    this.drawParticles();
    this.drawTexts();
    this.drawWeather();
    this.drawFX();
    ctx.restore();
    // flying coin-to-HUD animations (screen space)
    for (const f of this.flyCoins) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      this.glowOn(f.color, 8 * this.scale);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 5 * this.scale * f.life, 0, Math.PI * 2);
      ctx.fill();
      this.glowOff();
    }
    ctx.globalAlpha = 1;
    // full-screen flashes drawn unscaled
    if (this.flash > 0) {
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = this.flash * 0.5;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
  }

  private drawSky() {
    const ctx = this.ctx;
    const p = this.palette();
    const ox = this.OX, oy = this.OY;
    // gradient anchored to the overscanned bounds so no seam appears at edges
    const g = ctx.createLinearGradient(0, -oy, 0, this.H + oy);
    if (this.weather === "sunrise") {
      g.addColorStop(0, "#2a1a4a");
      g.addColorStop(0.6, "#7a3b6e");
      g.addColorStop(1, "#d97757");
    } else if (this.weather === "heat") {
      g.addColorStop(0, p.skyTop);
      g.addColorStop(1, "#6e2a1d");
    } else {
      g.addColorStop(0, p.skyTop);
      g.addColorStop(1, p.skyBot);
    }
    ctx.fillStyle = g;
    ctx.fillRect(-ox, -oy, this.W + ox * 2, this.H + oy * 2);

    if (this.weather !== "sunrise") {
      const mx = this.W * 0.62 - (this.worldX * 0.01) % this.W;
      const my = this.H * 0.22;
      const mr = 58 * this.scale;
      if (this.settings.highFx) {
        const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 2.4);
        mg.addColorStop(0, "rgba(240,230,255,0.9)");
        mg.addColorStop(0.4, "rgba(220,200,255,0.45)");
        mg.addColorStop(1, "rgba(220,200,255,0)");
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(mx, my, mr * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#f3ecff";
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      for (const st of this.stars) {
        ctx.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(this.elapsed * 2 + st.tw));
        ctx.fillStyle = "#dbeafe";
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      ctx.globalAlpha = 1;
    } else {
      // rising sun
      const sx = this.W * 0.7, sy = this.groundY * 0.75;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 180 * this.scale);
      sg.addColorStop(0, "rgba(255,200,120,0.95)");
      sg.addColorStop(0.5, "rgba(255,140,90,0.4)");
      sg.addColorStop(1, "rgba(255,140,90,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(-this.OX, -this.OY, this.W + this.OX * 2, this.H + this.OY * 2);
    }
  }

  // foreground atmospheric details drawn over the player layer
  private drawForeground() {
    const ctx = this.ctx;
    const s = this.scale;
    const gY = this.groundY;
    // scrolling gutter drain grate accents
    ctx.fillStyle = "rgba(100,80,160,0.08)";
    const grateW = 22 * s, grateSpace = 200 * s;
    const grateOff = (this.worldX * 0.7) % grateSpace;
    for (let gx = -grateOff - this.OX; gx < this.W + this.OX; gx += grateSpace) {
      ctx.fillRect(gx, gY + 5 * s, grateW, 3 * s);
      ctx.fillRect(gx + 4 * s, gY + 5 * s, 2 * s, 6 * s); // vertical bar
      ctx.fillRect(gx + 12 * s, gY + 5 * s, 2 * s, 6 * s);
    }

    // occasional random electrical sparks on the road
    if (this.settings.particles && Math.random() < 0.015) {
      const sx = rand(this.W * 0.3, this.W);
      for (let i = 0; i < 3; i++) {
        const p = this.getParticle();
        p.x = sx + rand(-6, 6) * s; p.y = gY - rand(0, 4) * s;
        p.vx = rand(-80, 80) * s; p.vy = rand(-140, -50) * s;
        p.life = rand(0.1, 0.25); p.max = 0.25;
        p.size = rand(1, 2.5) * s; p.color = this.palette().neon;
        p.gravity = 600 * s; p.glow = true;
        this.particles.push(p);
      }
    }
  }

  // slow-drifting cloud wisps add sky depth
  private drawClouds() {
    if (!this.settings.highFx) return;
    const ctx = this.ctx;
    const s = this.scale;
    ctx.fillStyle = "rgba(180,170,210,0.06)";
    // 4 procedural cloud patches at different parallax rates
    for (let i = 0; i < 4; i++) {
      const rate = 0.015 + i * 0.008;
      let cx = ((i * this.W * 0.55 - this.worldX * rate) % (this.W * 1.5));
      if (cx < -300 * s) cx += this.W * 1.5;
      const cy = this.H * (0.14 + i * 0.06);
      const rw = (120 + i * 40) * s;
      const rh = (18 + i * 6) * s;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + rw * 0.6, cy - rh * 0.3, rw * 0.5, rh * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCityLife() {
    const ctx = this.ctx;
    const s = this.scale;
    // background train on an elevated rail
    if (this.trainX > -1200 && this.trainX < this.W + 200) {
      const ty = this.groundY - this.H * 0.34;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, ty + 26 * s, this.W, 3 * s);
      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2 * s;
      for (let i = 0; i < 5; i++) {
        const cx = this.trainX + i * 110 * s;
        ctx.fillRect(cx, ty, 100 * s, 26 * s);
        ctx.strokeRect(cx, ty, 100 * s, 26 * s);
        ctx.fillStyle = "rgba(34,211,238,0.5)";
        for (let w = 0; w < 5; w++) ctx.fillRect(cx + 8 * s + w * 19 * s, ty + 7 * s, 12 * s, 8 * s);
        ctx.fillStyle = "#1e293b";
      }
    }
    // flying cars with light trails
    for (const c of this.flyCars) {
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x - c.dir * c.len, c.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.color;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 8 * s;
      ctx.fillRect(c.x - 4 * s, c.y - 2 * s, 8 * s, 4 * s);
      ctx.shadowBlur = 0;
    }
    // birds
    ctx.strokeStyle = "rgba(148,163,184,0.7)";
    ctx.lineWidth = 1.5 * s;
    for (const b of this.birds) {
      const flap = Math.sin(b.ph) * 3 * s;
      ctx.beginPath();
      ctx.moveTo(b.x - 4 * s, b.y);
      ctx.lineTo(b.x, b.y - flap);
      ctx.lineTo(b.x + 4 * s, b.y);
      ctx.stroke();
    }
  }

  private drawBuildingLayer(parallax: number, color: string, neon: string, baseline: number, minH: number, maxH: number, density: number, seedOff: number) {
    const ctx = this.ctx;
    const s = this.scale;
    const scroll = this.worldX * parallax;
    const tile = 180 * s;
    const ox = this.OX;
    // begin one tile before the left overscan edge, run past the right overscan edge
    const start = -ox - tile - ((scroll % tile) + tile);
    ctx.fillStyle = color;
    for (let x = start, i = 0; x < this.W + ox + tile; x += tile * density, i++) {
      const idx = Math.floor((scroll + x) / (tile * density)) + seedOff;
      const r = Math.sin(idx * 12.9898) * 43758.5453;
      const rr = r - Math.floor(r);
      const bw = tile * density * rand2(idx, 0.55, 0.92);
      const bh = minH + (maxH - minH) * Math.abs(rr);
      const bx = x, by = baseline - bh;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = neon;
      const cols = Math.max(1, Math.floor(bw / (14 * s)));
      const rows = Math.max(1, Math.floor(bh / (18 * s)));
      for (let cx = 0; cx < cols; cx++)
        for (let cy = 0; cy < rows; cy++)
          if (rand2(idx * 31 + cx * 7 + cy * 13, 0, 1) > 0.72) {
            ctx.globalAlpha = 0.4 + 0.5 * rand2(idx + cx + cy, 0, 1);
            ctx.fillRect(bx + 5 * s + cx * 14 * s, by + 6 * s + cy * 18 * s, 4 * s, 7 * s);
          }
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
    }
  }

  private drawParallax() {
    const p = this.palette();
    const gY = this.groundY;
    const s = this.scale;
    this.drawBuildingLayer(0.05, p.far, p.neon, gY - 4, this.H * 0.18, this.H * 0.42, 1.4, 100);
    this.drawBuildingLayer(0.14, p.mid, p.accent, gY - 2, this.H * 0.22, this.H * 0.5, 1.0, 300);

    // animated billboards on the mid layer
    const ctx = this.ctx;
    const bi = Math.floor(this.elapsed * 0.8) % BILLBOARD_TEXTS.length;
    for (let k = 0; k < 2; k++) {
      const spacing = this.W * 0.9;
      let bx = ((k * spacing - this.worldX * 0.2) % (spacing * 2));
      if (bx < -260 * s) bx += spacing * 2;
      if (bx > this.W + 40) continue;
      const by = gY - this.H * 0.46;
      const bw = 150 * s, bh = 54 * s;
      const flicker = Math.sin(this.elapsed * 18 + k) > -0.9 ? 1 : 0.4;
      ctx.globalAlpha = flicker;
      ctx.fillStyle = "#0b0618";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = k === 0 ? "#f472b6" : "#22d3ee";
      ctx.shadowColor = ctx.strokeStyle as string;
      ctx.shadowBlur = 14 * s;
      ctx.lineWidth = 2 * s;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.font = `900 ${13 * s}px Rajdhani, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(BILLBOARD_TEXTS[(bi + k) % BILLBOARD_TEXTS.length], bx + bw / 2, by + bh / 2);
      ctx.globalAlpha = 1;
    }

    this.drawBuildingLayer(0.28, p.near, p.neon, gY, this.H * 0.14, this.H * 0.38, 0.7, 700);

    // street-level details: lamp posts with neon tops, power cables
    const ox = this.OX;
    const lampSpace = 320 * s;
    const lampOff = (this.worldX * 0.35) % lampSpace;
    ctx.strokeStyle = "#1e1836";
    ctx.lineWidth = 3 * s;
    for (let lx = -lampOff; lx < this.W + ox + lampSpace; lx += lampSpace) {
      const lampH = 90 * s;
      // post
      ctx.beginPath();
      ctx.moveTo(lx, gY); ctx.lineTo(lx, gY - lampH);
      ctx.stroke();
      // neon tip
      ctx.fillStyle = p.neon;
      this.glowOn(p.neon, 8 * s);
      ctx.beginPath();
      ctx.arc(lx, gY - lampH, 3.5 * s, 0, Math.PI * 2);
      ctx.fill();
      this.glowOff();
      // light cone below
      ctx.fillStyle = p.neon;
      ctx.globalAlpha = 0.03;
      ctx.beginPath();
      ctx.moveTo(lx - 20 * s, gY); ctx.lineTo(lx, gY - lampH + 8 * s); ctx.lineTo(lx + 20 * s, gY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // horizontal power cables between lamps
    ctx.strokeStyle = "rgba(100,100,140,0.25)";
    ctx.lineWidth = 1 * s;
    for (let lx = -lampOff; lx < this.W + ox; lx += lampSpace) {
      const sag = 12 * s;
      ctx.beginPath();
      ctx.moveTo(lx, gY - 80 * s);
      ctx.quadraticCurveTo(lx + lampSpace / 2, gY - 80 * s + sag, lx + lampSpace, gY - 80 * s);
      ctx.stroke();
    }
  }

  private drawGround() {
    const ctx = this.ctx;
    const p = this.palette();
    const s = this.scale;
    const gY = this.groundY;
    const ox = this.OX, oy = this.OY;
    const L = -ox, R = this.W + ox, BOT = this.H + oy;
    const pits = this.obstacles.filter((o) => o.kind === "pit");
    const segs: [number, number][] = [[L, R]];
    for (const pit of pits)
      for (let i = segs.length - 1; i >= 0; i--) {
        const [a, b] = segs[i];
        if (pit.x < b && pit.x + pit.w > a) {
          segs.splice(i, 1);
          if (pit.x > a) segs.push([a, pit.x]);
          if (pit.x + pit.w < b) segs.push([pit.x + pit.w, b]);
        }
      }

    // layered ground: sidewalk edge → road surface → sub-grade
    const roadTop = gY + 4 * s;
    for (const [a, b] of segs) {
      // dark sub-grade
      const grad = ctx.createLinearGradient(0, gY, 0, BOT);
      grad.addColorStop(0, "#1e1834");
      grad.addColorStop(0.3, "#18122c");
      grad.addColorStop(1, "#0a0616");
      ctx.fillStyle = grad;
      ctx.fillRect(a, gY, b - a, BOT - gY);

      // road surface (slightly lighter)
      ctx.fillStyle = "#221c38";
      ctx.fillRect(a, roadTop, b - a, this.H * 0.08);

      // sidewalk curb edge (top neon line)
      ctx.fillStyle = p.neon;
      this.glowOn(p.neon, 14 * s);
      ctx.fillRect(a, gY, b - a, 3 * s);
      this.glowOff();

      // secondary edge stripe
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(a, gY + 3 * s, b - a, 1.5 * s);
      ctx.globalAlpha = 1;
    }

    // scrolling circuit grid lines (vertical)
    ctx.strokeStyle = "rgba(120,200,255,0.12)";
    ctx.lineWidth = 1 * s;
    const tile = 70 * s;
    const off = (this.worldX * 0.7) % tile;
    for (const [a, b] of segs)
      for (let x = a - off; x < b; x += tile)
        if (x >= a) {
          ctx.beginPath();
          ctx.moveTo(x, gY + 8 * s);
          ctx.lineTo(x, BOT);
          ctx.stroke();
        }

    // horizontal lane markings (dashed center line)
    const laneY = gY + this.H * 0.04 + 2 * s;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([18 * s, 26 * s]);
    const dashOff = (this.worldX * 0.7) % ((18 + 26) * s);
    for (const [a, b] of segs) {
      ctx.beginPath();
      ctx.moveTo(a - dashOff, laneY);
      ctx.lineTo(b, laneY);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // neon reflection on road surface (subtle translucent mirror strip)
    if (this.settings.highFx) {
      ctx.fillStyle = p.neon;
      ctx.globalAlpha = 0.04;
      for (const [a, b] of segs) {
        ctx.fillRect(a, gY + 4 * s, b - a, this.H * 0.08);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawObstacles() {
    const ctx = this.ctx;
    const s = this.scale;
    const p = this.palette();
    const hz = this.hazardColor();
    for (const o of this.obstacles) {
      if (o.hit) continue;
      switch (o.kind) {
        case "block":
        case "roller":
          this.neonBox(o.x, o.y, o.w, o.h, "#3a2f52", p.accent);
          if (o.kind === "roller") {
            ctx.strokeStyle = p.accent;
            ctx.lineWidth = 2 * s;
            ctx.beginPath();
            ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.28, this.worldX * 0.02, this.worldX * 0.02 + 5);
            ctx.stroke();
          }
          break;
        case "wall":
          this.neonBox(o.x, o.y, o.w, o.h, "#241b3a", hz);
          // wall-jump affordance chevrons
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          for (let i = 0; i < 3; i++) {
            const yy = o.y + o.h * 0.25 + i * 16 * s;
            ctx.beginPath();
            ctx.moveTo(o.x + o.w * 0.7, yy);
            ctx.lineTo(o.x + o.w * 0.4, yy + 6 * s);
            ctx.lineTo(o.x + o.w * 0.7, yy + 12 * s);
            ctx.closePath();
            ctx.fill();
          }
          break;
        case "electric":
          this.neonBox(o.x, o.y, o.w, o.h, "#1a2a40", this.settings.colorblind ? "#4cc9f0" : "#38bdf8");
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = 2 * s;
          ctx.beginPath();
          for (let i = 0; i <= 5; i++) {
            const yy = o.y + (o.h * i) / 5;
            const xx = o.x + o.w / 2 + (i % 2 ? 6 : -6) * s;
            i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
          }
          ctx.stroke();
          break;
        case "laser": {
          ctx.fillStyle = "#334155";
          ctx.fillRect(o.x - 4 * s, o.y, 8 * s, o.h + this.ph * 0.9);
          ctx.fillRect(o.x + o.w - 4 * s, o.y, 8 * s, o.h + this.ph * 0.9);
          // warning dots on posts
          const dotPulse = (Math.sin(this.elapsed * 12) > 0) ? 1 : 0.3;
          ctx.fillStyle = hz;
          ctx.globalAlpha = dotPulse;
          ctx.beginPath();
          ctx.arc(o.x, o.y + 6 * s, 3 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(o.x + o.w, o.y + 6 * s, 3 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          const beamY = o.y + o.h;
          ctx.strokeStyle = hz;
          this.glowOn(hz, 16 * s);
          ctx.lineWidth = (3 + Math.sin(this.elapsed * 20) * 1.5) * s;
          if (this.settings.colorblind) ctx.setLineDash([8 * s, 5 * s]);
          ctx.beginPath();
          ctx.moveTo(o.x, beamY);
          ctx.lineTo(o.x + o.w, beamY);
          ctx.stroke();
          ctx.setLineDash([]);
          this.glowOff();
          break;
        }
        case "drone":
          this.drawDrone(o);
          break;
        case "missile":
          this.drawMissile(o);
          break;
        case "pit": {
          // hazard stripes at edges
          ctx.fillStyle = this.hazardColor();
          ctx.globalAlpha = 0.6;
          ctx.fillRect(o.x - 6 * s, o.y - 4 * s, 6 * s, 4 * s);
          ctx.fillRect(o.x + o.w, o.y - 4 * s, 6 * s, 4 * s);
          ctx.globalAlpha = 1;
          // depth glow
          const g = ctx.createLinearGradient(0, o.y, 0, this.H);
          g.addColorStop(0, "rgba(244,63,94,0)");
          g.addColorStop(1, "rgba(244,63,94,0.35)");
          ctx.fillStyle = g;
          ctx.fillRect(o.x, o.y + 20 * s, o.w, this.H - o.y);
          break;
        }
      }
    }
    ctx.shadowBlur = 0;
  }

  private neonBox(x: number, y: number, w: number, h: number, fill: string, neon: string) {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = neon;
    this.glowOn(neon, 12 * s);
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    this.glowOff();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1 * s;
    ctx.strokeRect(x + 5 * s, y + 5 * s, w - 10 * s, h - 10 * s);
  }

  private drawDrone(o: Obstacle) {
    const ctx = this.ctx;
    const s = this.scale;
    const hacked = this.loadout?.ability === "hackDrones";
    ctx.save();
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.fillStyle = "#2b2340";
    ctx.strokeStyle = hacked ? "#4ade80" : "#f97316";
    this.glowOn(ctx.strokeStyle, 12 * s);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(0, 0, o.w * 0.4, o.h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = hacked ? "#4ade80" : "#f43f5e";
    ctx.beginPath();
    ctx.arc(o.w * 0.14, 0, o.h * 0.14, 0, Math.PI * 2);
    ctx.fill();
    this.glowOff();
    ctx.strokeStyle = "rgba(148,163,184,0.6)";
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * o.w * 0.32, -o.h * 0.34);
      ctx.rotate(this.worldX * 0.1);
      ctx.beginPath();
      ctx.moveTo(-o.w * 0.16, 0);
      ctx.lineTo(o.w * 0.16, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawMissile(o: Obstacle) {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.save();
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.fillStyle = "#f97316";
    this.glowOn("#f97316", 14 * s);
    ctx.beginPath();
    ctx.moveTo(-o.w / 2, -o.h / 2);
    ctx.lineTo(o.w / 2, 0);
    ctx.lineTo(-o.w / 2, o.h / 2);
    ctx.closePath();
    ctx.fill();
    this.glowOff();
    ctx.fillStyle = "rgba(251,191,36,0.7)";
    ctx.beginPath();
    ctx.moveTo(-o.w / 2, -o.h * 0.3);
    ctx.lineTo(-o.w * 0.9 - Math.sin(this.elapsed * 30) * 6 * s, 0);
    ctx.lineTo(-o.w / 2, o.h * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawBossMech() {
    const ctx = this.ctx;
    const s = this.scale;
    const x = this.bossX;
    const y = this.groundY - this.H * 0.42 + Math.sin(this.elapsed * 2) * 8 * s;
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(0, 40 * s, 0, 0, 40 * s, 130 * s);
    g.addColorStop(0, "rgba(249,115,22,0.4)");
    g.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-130 * s, -50 * s, 260 * s, 180 * s);
    ctx.fillStyle = "#241b33";
    ctx.strokeStyle = "#f97316";
    this.glowOn("#f97316", 20 * s);
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.roundRect(-72 * s, -32 * s, 144 * s, 84 * s, 14 * s);
    ctx.fill(); ctx.stroke();
    const dmg = 1 - this.bossHp / this.bossHpMax;
    ctx.fillStyle = dmg > 0.6 ? "#fecaca" : "#fca5a5";
    ctx.shadowColor = "#f43f5e";
    ctx.beginPath();
    ctx.arc(0, 0, (13 + Math.sin(this.elapsed * 6) * 3) * s, 0, Math.PI * 2);
    ctx.fill();
    // cracked armor as HP drops
    if (dmg > 0.3) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(-30 * s, -20 * s); ctx.lineTo(-10 * s, 5 * s); ctx.lineTo(-24 * s, 24 * s);
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  private drawCollectibles() {
    const ctx = this.ctx;
    const s = this.scale;
    for (const c of this.collects) {
      if (c.taken) continue;
      const y = c.y + Math.sin(c.bob) * 3 * s;
      if (c.kind === "crystal") {
        ctx.save();
        ctx.translate(c.x, y);
        ctx.rotate(this.elapsed * 1.5);
        ctx.fillStyle = "#c084fc";
        this.glowOn("#c084fc", 20 * s);
        const r = c.r;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (c.kind === "core") {
        ctx.save();
        ctx.translate(c.x, y);
        ctx.rotate(-this.elapsed * 3);
        ctx.strokeStyle = this.hazardColor();
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 16 * s;
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.arc(0, 0, c.r, 0, Math.PI * 1.5);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(0, 0, c.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        const isChip = c.kind === "chip";
        ctx.fillStyle = isChip ? "#38bdf8" : "#fbbf24";
        this.glowOn(ctx.fillStyle, 12 * s);
        ctx.beginPath();
        ctx.arc(c.x, y, c.r, 0, Math.PI * 2);
        ctx.fill();
        this.glowOff();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.arc(c.x, y, c.r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }

  private drawPowerups() {
    const ctx = this.ctx;
    const s = this.scale;
    const icons: Record<PowerupType, string> = {
      magnet: "🧲", shield: "🛡", doubleCoins: "✦", slowMotion: "⏱",
      invincibility: "★", speedBoost: "⚡", jetpack: "🚀",
    };
    for (const p of this.powers) {
      if (p.taken) continue;
      const y = p.y + Math.sin(p.bob) * 4 * s;
      ctx.save();
      ctx.translate(p.x, y);
      const pulse = 1 + Math.sin(this.elapsed * 5) * 0.08;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "rgba(20,10,40,0.85)";
      ctx.strokeStyle = "#c084fc";
      ctx.shadowColor = "#c084fc";
      ctx.shadowBlur = 18 * s;
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${p.r * 1.3}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(icons[p.type], 0, 1 * s);
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  private drawPlayer() {
    const ctx = this.ctx;
    const s = this.scale;
    const L = this.loadout;
    const primary = L?.primary ?? "#22d3ee";
    const secondary = L?.secondary ?? "#2a2140";
    const glow = L?.glow ?? primary;
    const accent = L?.accent ?? primary;
    const build = L?.build ?? 1;
    const sil = L?.silhouette ?? "runner";
    const slide = this.sliding;
    const h = slide ? this.ph * 0.52 : this.ph;
    const baseY = this.py + (this.ph - h);
    const cx = this.px + this.pw / 2;
    const board = L?.board && L.board.id !== "none" ? L.board : null;

    // trail
    const trailStyle = L?.trail.style ?? "neon";
    const trailColor = L?.trail.color ?? primary;
    if (this.dashing || this.speed > 520 * s) {
      if (trailStyle === "glitch") {
        for (let i = 1; i <= 3; i++) {
          ctx.globalAlpha = 0.2 * (1 - i / 4);
          ctx.fillStyle = i % 2 ? trailColor : "#ffffff";
          ctx.fillRect(this.px - i * 16 * s + rand(-2, 2), baseY + rand(-2, 2), this.pw, h);
        }
        ctx.globalAlpha = 1;
      } else {
        const tg = ctx.createLinearGradient(this.px - 46 * s, 0, this.px, 0);
        tg.addColorStop(0, "transparent");
        tg.addColorStop(1, trailColor);
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = tg;
        ctx.fillRect(this.px - 46 * s, baseY + h * 0.15, 46 * s, h * 0.55);
        ctx.globalAlpha = 1;
      }
    }

    ctx.save();
    ctx.translate(cx, baseY + h / 2);
    if (this.hurtFlash > 0 && Math.floor(this.hurtFlash * 20) % 2 === 0) ctx.globalAlpha = 0.4;
    if (this.isInvincible()) { ctx.shadowColor = "#fbbf24"; ctx.shadowBlur = 22 * s; }

    const bodyW = this.pw * 0.7 * build;
    const bodyH = h * 0.6;

    // squash/stretch animation for juice
    let scaleX = 1, scaleY = 1;
    if (this.onGround && !slide && !this.dashing) {
      // idle breathing — subtle pulse when standing
      const breathe = Math.sin(this.animTime * 3) * 0.012;
      scaleX = 1 - breathe;
      scaleY = 1 + breathe;
    }
    if (!this.onGround) {
      if (this.vy < -200 * this.scale) {
        // rising — stretch vertically
        scaleX = 0.92; scaleY = 1.1;
      } else if (this.vy > 300 * this.scale) {
        // falling — compress horizontally
        scaleX = 1.08; scaleY = 0.92;
      }
    }
    // landing squash (applied for a few frames after landing via hurtless ground hit)
    if (this.landSquash > 0) {
      const sq = this.landSquash;
      scaleX = 1 + sq * 0.15;
      scaleY = 1 - sq * 0.15;
    }

    ctx.rotate(slide ? 0.15 : this.dashing ? 0.28 : this.onGround ? 0 : 0.12);
    ctx.scale(scaleX, scaleY);

    // ---- CAPE / CLOAK (drawn behind body) --------------------------------
    const flutter = Math.sin(this.animTime * 10) * 4 * s;
    if (sil === "runner") {
      // NEX — flowing scarf
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.2, -bodyH * 0.25);
      ctx.quadraticCurveTo(-bodyW * 0.9 - this.speed * 0.004, -bodyH * 0.1 + flutter, -bodyW * 1.2 - this.speed * 0.006, bodyH * 0.15 + flutter);
      ctx.lineTo(-bodyW * 1.1 - this.speed * 0.006, bodyH * 0.32 + flutter);
      ctx.quadraticCurveTo(-bodyW * 0.7, bodyH * 0.05, -bodyW * 0.2, -bodyH * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (sil === "shadow") {
      // VOID — tattered cloak
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.55, -bodyH * 0.4);
      ctx.lineTo(-bodyW * 0.95 - this.speed * 0.004, bodyH * 0.5 + flutter);
      ctx.lineTo(-bodyW * 0.6, bodyH * 0.35);
      ctx.lineTo(-bodyW * 0.75, bodyH * 0.6 + flutter);
      ctx.lineTo(-bodyW * 0.35, bodyH * 0.4);
      ctx.lineTo(-bodyW * 0.5, bodyH * 0.62 + flutter);
      ctx.lineTo(bodyW * 0.55, bodyH * 0.4);
      ctx.lineTo(bodyW * 0.55, -bodyH * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (sil === "scout") {
      // LUNA — short cape
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.3, -bodyH * 0.35);
      ctx.quadraticCurveTo(-bodyW * 0.8, bodyH * 0.1 + flutter, -bodyW * 0.6, bodyH * 0.45 + flutter);
      ctx.lineTo(bodyW * 0.1, bodyH * 0.3);
      ctx.lineTo(bodyW * 0.2, -bodyH * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- LEGS / BOARD ----------------------------------------------------
    if (board) {
      ctx.fillStyle = board.color;
      ctx.shadowColor = board.color;
      ctx.shadowBlur = 16 * s;
      ctx.beginPath();
      ctx.ellipse(0, bodyH * 0.55 + Math.sin(this.animTime * 8) * 2 * s, bodyW * 0.75, 5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "#e0d0ff";
      ctx.lineWidth = (sil === "tank" ? 7 : 5) * s * Math.min(build, 1.15);
      ctx.lineCap = "round";
      const run = this.animTime * 12;
      if (this.onGround && !slide) {
        for (const side of [-1, 1]) {
          const ph = run + (side > 0 ? Math.PI : 0);
          ctx.beginPath();
          ctx.moveTo(side * 4 * s * build, bodyH * 0.3);
          ctx.lineTo(side * 4 * s * build + Math.cos(ph) * 8 * s, bodyH * 0.78 + Math.max(0, Math.sin(ph)) * 4 * s);
          ctx.stroke();
        }
      } else if (slide) {
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.4, bodyH * 0.3);
        ctx.lineTo(bodyW * 0.6, bodyH * 0.3);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-4 * s, bodyH * 0.2); ctx.lineTo(-10 * s, bodyH * 0.5);
        ctx.moveTo(6 * s, bodyH * 0.2); ctx.lineTo(12 * s, bodyH * 0.45);
        ctx.stroke();
      }
    }

    // ---- TORSO -----------------------------------------------------------
    const grad = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
    grad.addColorStop(0, primary);
    grad.addColorStop(0.35, secondary);
    grad.addColorStop(1, secondary);
    ctx.fillStyle = grad;
    ctx.strokeStyle = primary;
    if (!this.isInvincible()) { ctx.shadowColor = glow; ctx.shadowBlur = 12 * s; }
    ctx.lineWidth = 2 * s;
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, 8 * s);
    ctx.fill(); ctx.stroke();

    // TANK — bulky shoulder pads
    if (sil === "tank") {
      ctx.fillStyle = secondary;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * s;
      for (const side of [-1, 1]) {
        roundRect(ctx, side * bodyW * 0.5 - (side < 0 ? bodyW * 0.28 : 0), -bodyH * 0.5, bodyW * 0.28, bodyH * 0.32, 5 * s);
        ctx.fill(); ctx.stroke();
      }
      // chest plate line
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.3, -bodyH * 0.1);
      ctx.lineTo(bodyW * 0.3, -bodyH * 0.1);
      ctx.stroke();
    }
    // REBEL — energy fist
    if (sil === "rebel") {
      const fx = bodyW * 0.55 + Math.sin(this.animTime * 12) * 3 * s;
      ctx.fillStyle = accent;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 16 * s;
      ctx.beginPath();
      ctx.arc(fx, bodyH * 0.1, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // chest core
    ctx.shadowBlur = 8 * s;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.05, (sil === "tank" ? 6 : 5) * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ---- HEAD ------------------------------------------------------------
    const headTop = -bodyH / 2 - 16 * s;
    ctx.fillStyle = secondary;
    roundRect(ctx, -bodyW * 0.42, headTop, bodyW * 0.84, 16 * s, 5 * s);
    ctx.fill();

    if (sil === "shadow" || L?.hood) {
      // VOID — deep hood
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.52, headTop + 4 * s);
      ctx.quadraticCurveTo(0, headTop - 14 * s, bodyW * 0.52, headTop + 4 * s);
      ctx.lineTo(bodyW * 0.42, headTop + 14 * s);
      ctx.lineTo(-bodyW * 0.42, headTop + 14 * s);
      ctx.closePath();
      ctx.fill();
      // glowing eyes inside hood
      ctx.fillStyle = primary;
      ctx.shadowColor = primary;
      ctx.shadowBlur = 10 * s;
      ctx.beginPath(); ctx.arc(-bodyW * 0.14, headTop + 8 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bodyW * 0.14, headTop + 8 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (sil === "rebel") {
      // RIFT — spiky hair
      ctx.fillStyle = L?.hair ?? primary;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * bodyW * 0.14, headTop);
        ctx.lineTo(i * bodyW * 0.14 - 3 * s, headTop - (10 + Math.abs(i) * 2) * s);
        ctx.lineTo(i * bodyW * 0.14 + 4 * s, headTop);
        ctx.closePath();
        ctx.fill();
      }
    } else if (sil === "scout") {
      // LUNA — bunny-ear antennae
      ctx.strokeStyle = secondary;
      ctx.fillStyle = accent;
      ctx.lineWidth = 3 * s;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * bodyW * 0.2, headTop);
        ctx.rotate(side * 0.25);
        roundRect(ctx, -2 * s, -22 * s, 4 * s, 22 * s, 2 * s);
        ctx.fill();
        ctx.restore();
      }
    } else if (sil === "hacker") {
      // ZARA — single antenna + tech goggles
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(bodyW * 0.3, headTop);
      ctx.lineTo(bodyW * 0.42, headTop - 12 * s);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.shadowColor = accent; ctx.shadowBlur = 8 * s;
      ctx.beginPath(); ctx.arc(bodyW * 0.42, headTop - 12 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (L?.hair) {
      // NEX — hair strip
      ctx.fillStyle = L.hair;
      ctx.fillRect(-bodyW * 0.42, headTop - 3 * s, bodyW * 0.84, 5 * s);
    }

    // visor (all except deep-hood which has its own eyes)
    if (sil !== "shadow" && !L?.hood) {
      ctx.fillStyle = primary;
      ctx.shadowColor = primary;
      ctx.shadowBlur = 10 * s;
      ctx.fillRect(-bodyW * 0.3, headTop + 4 * s, bodyW * 0.6, 5 * s);
      ctx.shadowBlur = 0;
    }

    // ---- HACKER companion drone (orbits) ---------------------------------
    if (sil === "hacker") {
      const dx = -bodyW * 0.9 + Math.sin(this.animTime * 3) * 6 * s;
      const dy = -bodyH * 0.4 + Math.cos(this.animTime * 3) * 6 * s;
      ctx.fillStyle = secondary;
      ctx.strokeStyle = accent;
      ctx.shadowColor = accent; ctx.shadowBlur = 8 * s;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.arc(dx, dy, 5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = primary;
      ctx.beginPath(); ctx.arc(dx + 2 * s, dy, 1.6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (this.jetpackActive()) {
      ctx.fillStyle = "#f97316";
      ctx.shadowColor = "#f97316";
      ctx.shadowBlur = 16 * s;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.3, bodyH / 2);
      ctx.lineTo(0, bodyH / 2 + (18 + Math.random() * 8) * s);
      ctx.lineTo(bodyW * 0.1, bodyH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (this.shieldCharges > 0) {
      ctx.strokeStyle = "rgba(56,189,248,0.7)";
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 14 * s;
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.arc(0, 0, bodyW * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private drawParticles() {
    const ctx = this.ctx;
    const s = this.scale;
    const hi = this.settings.highFx;
    ctx.shadowBlur = 0;
    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      if (hi && p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10 * s; }
      else { ctx.shadowBlur = 0; }
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private drawTexts() {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life);
      ctx.font = `900 ${t.size}px Rajdhani, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 8;
      ctx.fillText(t.text, t.x, t.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private weatherDt = 0; // store last frame dt for weather animation
  private drawWeather() {
    const ctx = this.ctx;
    const s = this.scale;
    const wdt = this.weatherDt;
    const ox = this.OX, oy = this.OY;
    const FX = -ox, FY = -oy, FW = this.W + ox * 2, FH = this.H + oy * 2;
    if (this.weather === "rain" || this.weather === "storm") {
      ctx.strokeStyle = "rgba(150,190,255,0.35)";
      ctx.lineWidth = 1.4 * s;
      for (const d of this.rainDrops) {
        d.y += d.sp * wdt; d.x -= d.sp * 0.3 * wdt;
        if (d.y > this.H + oy) { d.y = -oy - 20; d.x = rand(-ox, this.W + ox); }
        if (d.x < -ox) d.x = this.W + ox;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.3, d.y + d.len);
        ctx.stroke();
      }
    }
    if (this.weather === "snow") {
      ctx.fillStyle = "rgba(240,248,255,0.85)";
      for (const f of this.snowFlakes) {
        f.y += f.sp * wdt; f.x += Math.sin(f.ph + this.elapsed) * 20 * s * wdt; f.ph += wdt;
        if (f.y > this.H + oy) { f.y = -oy - 10; f.x = rand(-ox, this.W + ox); }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.weather === "fog") {
      const g = ctx.createLinearGradient(0, FY, 0, this.H + oy);
      g.addColorStop(0, "rgba(180,180,210,0.05)");
      g.addColorStop(1, "rgba(180,180,210,0.3)");
      ctx.fillStyle = g;
      ctx.fillRect(FX, FY, FW, FH);
    }
    if (this.weather === "heat") {
      ctx.fillStyle = "rgba(255,120,40,0.06)";
      ctx.fillRect(FX, FY, FW, FH);
    }
    if (this.lightning > 0) {
      ctx.fillStyle = `rgba(220,230,255,${this.lightning * 0.6})`;
      ctx.fillRect(FX, FY, FW, FH);
    }
  }

  private drawFX() {
    const ctx = this.ctx;
    const s = this.scale;
    if (this.speed > 560 * s || this.dashing) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2 * s;
      for (let i = 0; i < 8; i++) {
        const y = (this.elapsed * 900 * s + i * 90 * s) % this.H;
        const len = rand(60, 160) * s;
        const x = this.W - ((this.worldX * 3 + i * 200) % this.W);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len, y);
        ctx.stroke();
      }
    }
    // incoming obstacle warning arrows on screen edge
    const warnColor = this.hazardColor();
    for (const o of this.obstacles) {
      if (o.hit || o.kind === "pit") continue;
      if (o.x > this.W && o.x < this.W + 180 * s) {
        const oy = Math.max(24 * s, Math.min(o.y + o.h / 2, this.groundY - 10 * s));
        const warningAlpha = 1 - (o.x - this.W) / (180 * s);
        ctx.globalAlpha = warningAlpha * 0.7;
        ctx.fillStyle = warnColor;
        ctx.beginPath();
        ctx.moveTo(this.W - 4 * s, oy);
        ctx.lineTo(this.W - 16 * s, oy - 8 * s);
        ctx.lineTo(this.W - 16 * s, oy + 8 * s);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // vignette (cached gradient — only rebuilt on resize)
    if (this.settings.highFx) {
      if (!this.vignetteCache) {
        const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.4, this.W / 2, this.H / 2, this.H * 0.95);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.45)");
        this.vignetteCache = vg;
      }
      ctx.fillStyle = this.vignetteCache;
      ctx.fillRect(-this.OX, -this.OY, this.W + this.OX * 2, this.H + this.OY * 2);
    }
    this.drawNull();
  }
  private vignetteCache: CanvasGradient | null = null;

  // NULL corruption overlay: RGB-split glitch bars, red lockdown tint, broadcast.
  private drawNull() {
    const ctx = this.ctx;
    const s = this.scale;
    const ox = this.OX, oy = this.OY;
    const FX = -ox, FY = -oy, FW = this.W + ox * 2, FH = this.H + oy * 2;
    // sustained red hostility at high NULL threat (city turns against you)
    if (this.threat >= 4) {
      const base = this.threat >= 5 ? 0.1 : 0.05;
      const pulse = base + Math.sin(this.elapsed * 3) * 0.02;
      ctx.fillStyle = `rgba(244,63,94,${Math.max(0, pulse)})`;
      ctx.fillRect(FX, FY, FW, FH);
    }
    // threat-up burst flash
    if (this.threatPulse > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.threatPulse * 0.25})`;
      ctx.fillRect(FX, FY, FW, FH);
    }
    // red lockdown tint
    if (this.lockdown > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.lockdown * 0.14})`;
      ctx.fillRect(FX, FY, FW, FH);
    }
    // glitch bars
    if (this.glitchAmt > 0.02) {
      const bars = Math.floor(this.glitchAmt * 6) + 1;
      for (let i = 0; i < bars; i++) {
        const by = Math.random() * this.H;
        const bh = rand(4, 22) * s;
        const off = rand(-14, 14) * s * this.glitchAmt;
        ctx.globalAlpha = 0.5 * this.glitchAmt;
        ctx.fillStyle = Math.random() < 0.5 ? "#f43f5e" : "#22d3ee";
        ctx.fillRect(FX + off, by, FW, bh);
      }
      ctx.globalAlpha = 1;
    }
    // broadcast banner (radio / AI line)
    if (this.broadcast && this.broadcastTimer > 0) {
      const alpha = Math.min(1, this.broadcastTimer);
      const isNull = this.broadcast.includes("NULL") || this.broadcast.includes("SECURITY") || this.broadcast.includes("ALERT") || this.broadcast.includes("WARNING");
      ctx.globalAlpha = alpha;
      ctx.font = `700 ${14 * s}px Rajdhani, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const y = this.H * 0.16;
      // typewriter-ish flicker
      if (Math.sin(this.elapsed * 40) > -0.8) {
        ctx.fillStyle = isNull ? "#fca5a5" : "#a5f3fc";
        this.glowOn(isNull ? "#f43f5e" : "#22d3ee", 10 * s);
        ctx.fillText(this.broadcast, this.W / 2, y);
        this.glowOff();
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  }

  renderIdle() {
    this.animTime += 0.016;
    this.elapsed += 0.016;
    this.weatherDt = 0.016;
    this.updateParticles(0.016);
    if (this.settings.particles && Math.random() < 0.12) {
      const p = this.getParticle();
      p.x = rand(0, this.W); p.y = this.H;
      p.vx = rand(-10, 10); p.vy = rand(-60, -20) * this.scale;
      p.life = rand(1, 2.5); p.max = 2.5; p.size = rand(1, 3) * this.scale;
      p.color = this.palette().neon; p.gravity = -20 * this.scale; p.glow = true;
      this.particles.push(p);
    }
    this.render();
  }
}

function rand2(seed: number, min: number, max: number) {
  const r = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  const f = r - Math.floor(r);
  return min + f * (max - min);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
