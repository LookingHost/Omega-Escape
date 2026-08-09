import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Users, ShoppingBag, Target, Trophy, Settings as SettingsIcon, Home,
  RotateCcw, Share2, Heart, Pause, ChevronLeft, Lock, Check, Gift, Gauge, Zap,
} from "lucide-react";
import { GameEngine, POWER_LABEL } from "./game/engine";
import { audio } from "./game/audio";
import {
  loadSave, loadSettings, resolveLevel, writeSave, writeSettings,
  type SaveData, type Settings, type HighScoreEntry,
} from "./game/storage";
import {
  CHARACTERS, SKINS, TRAILS, BOARDS, RARITY_COLOR, getCharacter, getPersonality, type CharacterDef, type SkinDef,
} from "./game/characters";
import {
  ACHIEVEMENTS, canClaimDaily, dailyRewardAmount, getDailyMissions, getWeeklyMissions,
  metricFromRun, dailyKey,
} from "./game/meta";
import type { GameMode, HudState, Loadout, PowerupType, RunResult } from "./game/types";
import { cn } from "./utils/cn";

type Screen =
  | "menu" | "briefing" | "playing" | "paused" | "gameover"
  | "characters" | "shop" | "missions" | "achievements" | "scores" | "settings";

const POWER_ICON: Record<PowerupType, string> = {
  magnet: "🧲", shield: "🛡️", doubleCoins: "✦", slowMotion: "⏱️",
  invincibility: "★", speedBoost: "⚡", jetpack: "🚀",
};

const MODES: { id: GameMode; name: string; desc: string; icon: string }[] = [
  { id: "classic", name: "Classic", desc: "The endless escape", icon: "🏃" },
  { id: "hardcore", name: "Hardcore", desc: "Faster. Deadlier.", icon: "💀" },
  { id: "timeattack", name: "Time Attack", desc: "60 seconds. Max distance.", icon: "⏱️" },
  { id: "bossrush", name: "Boss Rush", desc: "Constant Guardian waves", icon: "🤖" },
  { id: "training", name: "Training", desc: "Practice — no death", icon: "🎯" },
];

const emptyHud: HudState = {
  state: "ready", distance: 0, coins: 0, crystals: 0, best: 0, speed: 0, multiplier: 1,
  environment: "Cyber City", weather: "clear", shieldCharges: 0, powerups: [],
  boss: false, bossHp: 0, bossHint: "", combo: 0, dashReady: true, timeLeft: -1, threat: 1, objective: null,
};

// Resolve the player's equipped cosmetics into an engine loadout.
function resolveLoadout(save: SaveData): Loadout {
  const char = getCharacter(save.equippedChar);
  const skinId = save.equippedSkins[char.id] ?? `${char.id}_default`;
  const skin = SKINS.find((sk) => sk.id === skinId && sk.charId === char.id);
  const colors = skin?.colors ?? char.colors;
  const trail = TRAILS.find((t) => t.id === save.equippedTrail) ?? TRAILS[0];
  const board = BOARDS.find((b) => b.id === save.equippedBoard) ?? BOARDS[0];
  return {
    id: char.id, name: char.name,
    primary: colors.primary, secondary: colors.secondary, glow: colors.glow,
    accent: colors.accent ?? char.colors.accent ?? colors.primary,
    build: char.build, silhouette: char.silhouette, hood: skin?.hood ?? char.hood, hair: char.hair,
    ability: char.ability,
    trail: { id: trail.id, color: trail.color, style: trail.style },
    board: board.id === "none" ? null : { id: board.id, color: board.color },
    personality: getPersonality(char.id),
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const idleRaf = useRef(0);

  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState>(emptyHud);
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [result, setResult] = useState<RunResult | null>(null);
  const [lastMode, setLastMode] = useState<GameMode>("classic");
  const [reviveUsed, setReviveUsed] = useState(false);
  const [toasts, setToasts] = useState<string[]>([]);
  const [runFlags, setRunFlags] = useState<{ best: boolean; level: number | null; ach: string[] }>({ best: false, level: null, ach: [] });

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const loadout = useMemo(() => resolveLoadout(save), [save.equippedChar, save.equippedSkins, save.equippedTrail, save.equippedBoard]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = useCallback((msg: string) => {
    setToasts((t) => [...t.slice(-2), msg]);
    window.setTimeout(() => setToasts((t) => t.slice(1)), 3000);
  }, []);

  const persist = useCallback((next: SaveData) => {
    setSave(next);
    writeSave(next);
  }, []);

  // --- engine mount -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new GameEngine(canvas, {
      onHud: (h) => setHud(h),
      onGameOver: (r) => {
        setResult(r);
        setScreen("gameover");
        setSave((prev) => {
          const { next, flags } = applyRun(prev, r);
          engineRef.current?.setBest(next.best);
          setRunFlags({ best: flags.isBest, level: flags.leveledUp ? next.level : null, ach: flags.newAchievements });
          writeSave(next);
          return next;
        });
      },
    });
    engineRef.current = engine;
    engine.setBest(loadSave().best);
    const st = loadSettings();
    engine.setSettings({ shake: st.shake, particles: st.particles, colorblind: st.colorblind, vibrate: st.vibrate, highFx: st.highFx });
    audio.setMusic(st.music);
    audio.setSfx(st.sfx);
    audio.setMusicVol(st.musicVol);
    audio.setSfxVol(st.sfxVol);

    // Robust resize: debounced + covers mobile orientation & viewport changes.
    let resizeRaf = 0;
    const onResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => engine.resize());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
    // Idle menu preview throttled to ~30fps to save battery/CPU.
    const idleScreens = new Set(["menu", "scores", "settings", "missions", "achievements", "shop", "characters"]);
    let lastIdle = 0;
    const idle = (t: number) => {
      if (!document.hidden && idleScreens.has(screenRef.current) && t - lastIdle > 33) {
        lastIdle = t;
        engine.renderIdle();
      }
      idleRaf.current = requestAnimationFrame(idle);
    };
    idleRaf.current = requestAnimationFrame(idle);

    // Auto-pause when the tab/app loses focus so the player never dies while away.
    const onVisibility = () => {
      if (document.hidden && screenRef.current === "playing") {
        engine.pause();
        setScreen("paused");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onVisibility);

    // One-time audio unlock for iOS/Android (WebAudio needs a user gesture).
    const unlock = () => { audio.resume(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
      cancelAnimationFrame(idleRaf.current);
      cancelAnimationFrame(resizeRaf);
      engine.destroy();
    };
  }, []);

  // push loadout + settings to engine
  useEffect(() => { engineRef.current?.setLoadout(loadout); }, [loadout]);
  useEffect(() => {
    engineRef.current?.setSettings({ shake: settings.shake, particles: settings.particles, colorblind: settings.colorblind, vibrate: settings.vibrate, highFx: settings.highFx });
    // reduced-motion toggles a body class that disables CSS animations
    document.body.classList.toggle("reduce-motion", settings.reducedMotion);
  }, [settings]);

  // --- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = engineRef.current;
      if (!g || e.repeat) return;
      switch (e.code) {
        case "Space": case "ArrowUp": case "KeyW":
          e.preventDefault();
          if (screenRef.current === "playing") g.jump();
          break;
        case "ArrowDown": case "KeyS":
          e.preventDefault();
          if (screenRef.current === "playing") g.slideStart();
          break;
        case "ShiftLeft": case "ShiftRight": case "KeyD":
          if (screenRef.current === "playing") g.dashStart();
          break;
        case "Escape": case "KeyP":
          if (screenRef.current === "playing") doPause();
          else if (screenRef.current === "paused") doResume();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const g = engineRef.current;
      if (!g) return;
      if (e.code === "ArrowDown" || e.code === "KeyS") g.slideEnd();
      if (["ShiftLeft", "ShiftRight", "KeyD"].includes(e.code)) g.dashEnd();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- touch / pointer gestures ------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    let startX = 0, startY = 0, startT = 0, holdTimer = 0, moved = false;
    let activeId = -1; // track a single pointer, ignore extra fingers
    const SWIPE = 36; // px swipe threshold

    const onDown = (e: PointerEvent) => {
      if (screenRef.current !== "playing") return;
      if (activeId !== -1) return; // already tracking a finger
      activeId = e.pointerId;
      startX = e.clientX; startY = e.clientY; startT = performance.now(); moved = false;
      holdTimer = window.setTimeout(() => { if (startT !== 0) engineRef.current?.dashStart(); }, 190);
    };
    const onMove = (e: PointerEvent) => {
      if (screenRef.current !== "playing" || startT === 0 || e.pointerId !== activeId) return;
      const dy = e.clientY - startY, dx = e.clientX - startX;
      // swipe down → slide
      if (dy > SWIPE && dy > Math.abs(dx)) {
        engineRef.current?.slideStart();
        moved = true; clearTimeout(holdTimer); startT = 0;
      }
      // swipe up → jump (some players expect this)
      else if (-dy > SWIPE && -dy > Math.abs(dx)) {
        engineRef.current?.jump();
        moved = true; clearTimeout(holdTimer); startT = 0;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = -1;
      if (screenRef.current !== "playing") { startT = 0; return; }
      clearTimeout(holdTimer);
      engineRef.current?.dashEnd();
      const dt = performance.now() - startT;
      if (startT !== 0 && !moved && dt < 190) engineRef.current?.jump(); // tap = jump
      startT = 0;
    };
    const onCancel = () => { activeId = -1; startT = 0; clearTimeout(holdTimer); engineRef.current?.dashEnd(); };
    // prevent iOS double-tap zoom / scroll bounce on the play surface
    const prevent = (e: Event) => { if (screenRef.current === "playing") e.preventDefault(); };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("touchstart", prevent, { passive: false });
    canvas.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("touchstart", prevent);
      canvas.removeEventListener("touchmove", prevent);
    };
  }, []);

  // --- flow ---------------------------------------------------------------
  // Show the cinematic briefing first; the engine actually starts after countdown.
  const startGame = useCallback((mode: GameMode) => {
    audio.resume(); audio.click();
    setLastMode(mode); setReviveUsed(false); setResult(null);
    setScreen("briefing");
  }, []);

  // Called by the Briefing overlay when the countdown hits RUN.
  const launchRun = useCallback((mode: GameMode) => {
    setScreen("playing");
    engineRef.current?.setLoadout(loadout);
    engineRef.current?.start(mode);
  }, [loadout]);

  const doPause = useCallback(() => { engineRef.current?.pause(); setScreen("paused"); }, []);
  const doResume = useCallback(() => { audio.click(); setScreen("playing"); engineRef.current?.resume(); }, []);
  const doRetry = useCallback(() => startGame(lastMode), [lastMode, startGame]);
  const doHome = useCallback(() => { audio.click(); audio.stopMusic(); setScreen("menu"); }, []);
  const doRevive = useCallback(() => { audio.click(); setReviveUsed(true); setScreen("playing"); engineRef.current?.revive(); }, []);

  const nav = (s: Screen) => { audio.click(); setScreen(s); };

  const toggleSetting = useCallback((key: keyof Settings) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeSettings(next);
      if (key === "music") audio.setMusic(next.music);
      if (key === "sfx") audio.setSfx(next.sfx);
      return next;
    });
    audio.click();
  }, []);

  const setUiScale = useCallback((v: number) => {
    setSettings((prev) => { const next = { ...prev, uiScale: v }; writeSettings(next); return next; });
    audio.click();
  }, []);

  // Audio volume sliders (0..1)
  const setVolume = useCallback((key: "musicVol" | "sfxVol", v: number) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: v };
      writeSettings(next);
      if (key === "musicVol") audio.setMusicVol(v);
      else audio.setSfxVol(v);
      return next;
    });
  }, []);

  // Generic numeric setter for mobile pad layout sliders.
  const setNumber = useCallback((key: keyof Settings, v: number) => {
    setSettings((prev) => { const next = { ...prev, [key]: v }; writeSettings(next); return next; });
  }, []);

  // Graphics preset maps to individual effect toggles the engine reads.
  const setGraphics = useCallback((g: "low" | "medium" | "high" | "ultra") => {
    setSettings((prev) => {
      const next: Settings = {
        ...prev,
        graphics: g,
        particles: g !== "low",
        highFx: g === "high" || g === "ultra",
        shake: prev.shake, // respect user's shake choice
      };
      writeSettings(next);
      return next;
    });
    audio.click();
  }, []);

  // shop / roster actions
  const buyOrEquipChar = useCallback((c: CharacterDef) => {
    setSave((prev) => {
      if (prev.unlockedChars.includes(c.id)) {
        audio.click();
        return { ...prev, equippedChar: c.id };
      }
      const cond = c.unlockCheck({ best: prev.best, totalCoins: prev.totalCoins, bosses: prev.stats.bosses, runs: prev.runs, jumps: prev.stats.jumps });
      if (!cond || prev.totalCoins < c.price) { audio.deny(); return prev; }
      audio.buy();
      const next = {
        ...prev,
        totalCoins: prev.totalCoins - c.price,
        unlockedChars: [...prev.unlockedChars, c.id],
        equippedChar: c.id,
        unlockedSkins: [...prev.unlockedSkins, `${c.id}_default`],
        equippedSkins: { ...prev.equippedSkins, [c.id]: `${c.id}_default` },
      };
      writeSave(next);
      return next;
    });
  }, []);

  const buyOrEquipSkin = useCallback((sk: SkinDef) => {
    setSave((prev) => {
      if (prev.unlockedSkins.includes(sk.id)) {
        audio.click();
        const eq = { ...prev, equippedSkins: { ...prev.equippedSkins, [sk.charId]: sk.id } };
        writeSave(eq);
        return eq;
      }
      if (prev.totalCoins < sk.price) { audio.deny(); return prev; }
      audio.buy();
      const next = { ...prev, totalCoins: prev.totalCoins - sk.price, unlockedSkins: [...prev.unlockedSkins, sk.id] };
      writeSave(next);
      return next;
    });
  }, []);

  const buyTrailOrBoard = useCallback((kind: "trail" | "board", id: string, price: number) => {
    setSave((prev) => {
      const owned = kind === "trail" ? prev.unlockedTrails : prev.unlockedBoards;
      if (owned.includes(id)) {
        audio.click();
        return kind === "trail" ? { ...prev, equippedTrail: id } : { ...prev, equippedBoard: id };
      }
      if (prev.totalCoins < price) { audio.deny(); return prev; }
      audio.buy();
      const base = { ...prev, totalCoins: prev.totalCoins - price };
      const next = kind === "trail"
        ? { ...base, unlockedTrails: [...prev.unlockedTrails, id], equippedTrail: id }
        : { ...base, unlockedBoards: [...prev.unlockedBoards, id], equippedBoard: id };
      writeSave(next);
      return next;
    });
  }, []);

  const claimMission = useCallback((id: string, reward: number) => {
    setSave((prev) => {
      // find the mission target to verify completion
      const allMissions = [...getDailyMissions(), ...getWeeklyMissions()];
      const mission = allMissions.find((m) => m.id === id);
      if (!mission) return prev;
      if (prev.missionsClaimed.includes(id) || (prev.missionProgress[id] ?? 0) < mission.target) return prev;
      audio.buy();
      const next = { ...prev, totalCoins: prev.totalCoins + reward, missionsClaimed: [...prev.missionsClaimed, id] };
      writeSave(next);
      return next;
    });
  }, []);

  const claimDaily = useCallback(() => {
    setSave((prev) => {
      if (!canClaimDaily(prev)) return prev;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const streak = prev.lastDailyClaim === yesterday ? prev.dailyStreak + 1 : 1;
      const amount = dailyRewardAmount(streak);
      audio.buy();
      flash(`🎁 Daily reward: +${amount} coins (day ${streak})`);
      const next = { ...prev, totalCoins: prev.totalCoins + amount, dailyStreak: streak, lastDailyClaim: dailyKey() };
      writeSave(next);
      return next;
    });
  }, [flash]);

  const inGame = screen === "playing" || screen === "paused";
  const lvl = resolveLevel(save.xp);

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-[#070312] text-white"
      style={{
        fontSize: `${settings.uiScale * 100}%`,
        fontFamily: "Rajdhani, ui-sans-serif, system-ui",
        width: "100vw",
        height: "100dvh",
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />
      {settings.highFx && <div className="scanlines pointer-events-none absolute inset-0 z-10 opacity-40" />}

      {inGame && <GameHud hud={hud} onPause={doPause} />}
      {screen === "playing" && <TouchControls settings={settings} jump={() => engineRef.current?.jump()} slideS={() => engineRef.current?.slideStart()} slideE={() => engineRef.current?.slideEnd()} dashS={() => engineRef.current?.dashStart()} dashE={() => engineRef.current?.dashEnd()} />}

      {screen === "menu" && (
        <Menu save={save} lvl={lvl} onStart={startGame} nav={nav} onDaily={claimDaily} canDaily={canClaimDaily(save)} />
      )}
      {screen === "briefing" && (
        <Briefing char={getCharacter(save.equippedChar)} mode={lastMode} best={save.best} onLaunch={() => launchRun(lastMode)} />
      )}
      {screen === "paused" && (
        <Overlay>
          <Panel className="w-[min(92vw,420px)] text-center">
            <h2 className="font-display mb-1 text-4xl font-black tracking-widest text-cyan-300 glow-cyan">PAUSED</h2>
            <p className="mb-2 text-sm uppercase tracking-widest text-slate-400">{hud.environment} · {Math.floor(hud.distance)}M</p>
            {hud.objective && (
              <div className={cn("mb-4 rounded-md border px-3 py-2 text-left text-[11px]",
                hud.objective.done ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-200" : "border-cyan-300/30 bg-slate-950/60 text-slate-300")}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">◈ {hud.objective.label}</span>
                  <span className="font-black tabular-nums">{hud.objective.done ? "✓" : `${Math.floor(hud.objective.progress)}/${hud.objective.target}`}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className={cn("h-full", hud.objective.done ? "bg-emerald-400" : "bg-cyan-400")}
                    style={{ width: `${Math.min(100, (hud.objective.progress / hud.objective.target) * 100)}%` }} />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <NeonBtn onClick={doResume}><Play size={18} /> Resume</NeonBtn>
              <NeonBtn variant="ghost" onClick={doRetry}><RotateCcw size={16} /> Restart</NeonBtn>
              <NeonBtn variant="ghost" onClick={doHome}><Home size={16} /> Main Menu</NeonBtn>
            </div>
          </Panel>
        </Overlay>
      )}
      {screen === "gameover" && result && (
        <GameOver result={result} best={save.best} isBest={runFlags.best} leveledUp={runFlags.level}
          newAch={runFlags.ach} reviveUsed={reviveUsed || result.mode === "training"}
          onRevive={doRevive} onRetry={doRetry} onHome={doHome} />
      )}
      {screen === "characters" && <CharacterSelect save={save} persist={persist} onAction={buyOrEquipChar} onBack={() => nav("menu")} />}
      {screen === "shop" && <Shop save={save} onSkin={buyOrEquipSkin} onItem={buyTrailOrBoard} onBack={() => nav("menu")} />}
      {screen === "missions" && <Missions save={save} onClaim={claimMission} onBack={() => nav("menu")} />}
      {screen === "achievements" && <Achievements save={save} onBack={() => nav("menu")} />}
      {screen === "scores" && <Scores save={save} onBack={() => nav("menu")} />}
      {screen === "settings" && (
        <SettingsScreen settings={settings} onToggle={toggleSetting} onScale={setUiScale} onGraphics={setGraphics} onVolume={setVolume} onNumber={setNumber} onBack={() => nav("menu")} />
      )}

      {/* toasts */}
      <div className="pointer-events-none absolute left-1/2 top-20 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t, i) => (
          <div key={i} className="toast rounded-full border border-cyan-300/40 bg-slate-950/85 px-6 py-2 text-sm font-bold tracking-wide text-cyan-100 backdrop-blur-md">
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Meta: apply a finished run to the save (currency, stats, missions, achs)
// ===========================================================================
function applyRun(prev: SaveData, r: RunResult) {
  const isBest = r.distance > prev.best;
  const prevLevel = resolveLevel(prev.xp).level;
  const xp = prev.xp + r.xp;
  const newLevel = resolveLevel(xp).level;
  const scores: HighScoreEntry[] = [
    ...prev.scores,
    { distance: r.distance, coins: r.coins, mode: r.mode, date: new Date().toISOString() },
  ].sort((a, b) => b.distance - a.distance).slice(0, 10);

  let next: SaveData = {
    ...prev,
    best: Math.max(prev.best, r.distance),
    scores,
    totalCoins: prev.totalCoins + r.coins,
    totalCrystals: prev.totalCrystals + r.crystals,
    xp,
    level: newLevel,
    runs: prev.runs + 1,
    stats: {
      jumps: prev.stats.jumps + r.stats.jumps,
      slides: prev.stats.slides + r.stats.slides,
      dashes: prev.stats.dashes + r.stats.dashes,
      perfectDodges: prev.stats.perfectDodges + r.stats.perfectDodges,
      bosses: prev.stats.bosses + r.stats.bosses,
      wallJumps: prev.stats.wallJumps + r.stats.wallJumps,
      distanceTotal: prev.stats.distanceTotal + r.distance,
    },
  };

  // mission progress
  const missions = [...getDailyMissions(), ...getWeeklyMissions()];
  const progress = { ...next.missionProgress };
  for (const m of missions) {
    if (next.missionsClaimed.includes(m.id)) continue;
    progress[m.id] = Math.min(m.target, (progress[m.id] ?? 0) + metricFromRun(r, m.metric));
  }
  next = { ...next, missionProgress: progress };

  // achievements
  const newAchievements: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!next.achievements.includes(a.id) && a.check(next)) newAchievements.push(a.id);
  }
  if (newAchievements.length) next = { ...next, achievements: [...next.achievements, ...newAchievements] };

  return { next, flags: { isBest, leveledUp: newLevel > prevLevel, newAchievements } };
}

// ===========================================================================
// UI primitives
// ===========================================================================
function Overlay({ children, dim = true }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div className={cn("screen-in safe-pad absolute inset-0 z-30 overflow-y-auto p-3 sm:p-6", dim && "bg-black/55 backdrop-blur-[3px]")}>
      <div className="flex min-h-full w-full items-center justify-center py-2">
        {children}
      </div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel-cut relative border border-white/15 bg-[#0d0821]/85 p-6 backdrop-blur-xl shadow-[0_0_70px_-18px_rgba(139,92,246,0.55)]", className)}>
      {children}
    </div>
  );
}

function NeonBtn({ children, variant = "primary", className, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "accent" | "ghost" | "danger" }) {
  const v: Record<string, string> = {
    primary: "border-cyan-300/60 from-cyan-400/80 to-blue-600/80 text-white shadow-[0_0_22px_-6px_rgba(34,211,238,0.8)]",
    accent: "border-orange-300/60 from-orange-400/80 to-rose-600/80 text-white shadow-[0_0_22px_-6px_rgba(249,115,22,0.8)]",
    danger: "border-rose-300/60 from-rose-500/80 to-red-700/80 text-white",
    ghost: "border-white/20 from-white/10 to-white/[0.03] text-cyan-100 hover:border-cyan-300/50",
  };
  return (
    <button {...rest} className={cn(
      "font-display relative inline-flex items-center justify-center gap-2 rounded-lg border bg-gradient-to-b px-5 py-2.5 text-sm font-bold uppercase tracking-widest transition-all duration-150 hover:brightness-110 active:scale-95",
      v[variant], className)}>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-lg bg-gradient-to-b from-white/25 to-transparent" />
      {children}
    </button>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span>{label}</span><span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ===========================================================================
// HUD
// ===========================================================================
function GameHud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  return (
    <div className="safe-pad pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <HudChip icon="⬡" value={hud.coins} color="text-amber-300" />
          <HudChip icon="◈" value={hud.crystals} color="text-fuchsia-300" />
          {hud.multiplier > 1 && (
            <div className="rounded-md border border-orange-300/50 bg-orange-500/20 px-3 py-1.5 font-display text-sm font-black text-orange-200 backdrop-blur-md">×{hud.multiplier}</div>
          )}
          {hud.combo >= 8 && (
            <div className="animate-pulse rounded-md border border-cyan-300/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 backdrop-blur-md">COMBO {hud.combo}</div>
          )}
          <ThreatMeter level={hud.threat} />
        </div>
        <div className="flex items-center gap-2">
          {hud.timeLeft >= 0 && (
            <div className={cn("rounded-md border px-3 py-1.5 font-display text-lg font-black tabular-nums backdrop-blur-md", hud.timeLeft < 10 ? "animate-pulse border-rose-400/60 bg-rose-500/20 text-rose-200" : "border-cyan-300/40 bg-slate-900/60 text-cyan-200")}>
              {Math.ceil(hud.timeLeft)}s
            </div>
          )}
          <div className="rounded-lg border border-white/15 bg-slate-950/60 px-4 py-2 text-right backdrop-blur-md">
            <div className="font-display text-xl font-black tabular-nums leading-none text-cyan-200 glow-cyan sm:text-2xl">{Math.floor(hud.distance)}M</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Best {hud.best}M</div>
          </div>
          <button onClick={onPause} aria-label="Pause"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-slate-950/60 text-cyan-200 backdrop-blur-md transition active:scale-90">
            <Pause size={18} />
          </button>
        </div>
      </div>

      {/* boss banner + HP */}
      {(hud.boss || hud.bossHint) && (
        <div className="mx-auto -mt-2 flex flex-col items-center gap-1">
          {hud.bossHint && (
            <div className={cn("rounded-full border px-5 py-1.5 font-display text-xs font-black tracking-widest backdrop-blur-md",
              hud.boss ? "animate-pulse border-rose-400/60 bg-rose-600/30 text-rose-100" : "border-amber-300/60 bg-amber-500/20 text-amber-100")}>
              {hud.bossHint}
            </div>
          )}
          {hud.boss && (
            <div className="h-2 w-56 overflow-hidden rounded-full border border-rose-400/50 bg-slate-950/70">
              <div className="h-full bg-gradient-to-r from-rose-500 to-orange-400 transition-all" style={{ width: `${hud.bossHp * 100}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          {hud.objective && (
            <div className={cn("w-[150px] max-w-[38vw] rounded-md border px-2 py-1.5 text-[0.68rem] backdrop-blur-md transition",
              hud.objective.done ? "border-emerald-300/50 bg-emerald-500/15" : "border-cyan-300/30 bg-slate-950/60")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-cyan-300">◈ Objective</span>
                <span className={cn("text-[10px] font-black tabular-nums", hud.objective.done ? "text-emerald-300" : "text-slate-400")}>
                  {hud.objective.done ? "DONE" : `${Math.floor(hud.objective.progress)}/${hud.objective.target}`}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] font-bold text-white">{hud.objective.label}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className={cn("h-full transition-all", hud.objective.done ? "bg-emerald-400" : "bg-cyan-400")}
                  style={{ width: `${Math.min(100, (hud.objective.progress / hud.objective.target) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-300 backdrop-blur-md">
            {hud.environment} · {weatherLabel(hud.weather)}
          </div>
        </div>
        <div className="flex items-end gap-2">
          {!hud.dashReady && (
            <div className="flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-white/15 bg-slate-950/60 backdrop-blur-md">
              <Zap size={18} className="text-slate-500" />
              <span className="text-[7px] font-bold tracking-wider text-slate-500">DASH</span>
            </div>
          )}
          {hud.shieldCharges > 0 && <PowerBadge icon="🛡️" label={`×${hud.shieldCharges}`} pct={1} />}
          {hud.powerups.map((p) => (
            <PowerBadge key={p.type} icon={POWER_ICON[p.type]} label={POWER_LABEL[p.type]} pct={p.total ? p.remaining / p.total : 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HudChip({ icon, value, color }: { icon: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-950/60 px-3 py-1.5 backdrop-blur-md">
      <span className={cn("text-base", color)}>{icon}</span>
      <span className="font-display text-sm font-black tabular-nums sm:text-base">{value}</span>
    </div>
  );
}

// NULL threat meter — 5 escalating bars, turns red at high threat.
function ThreatMeter({ level }: { level: number }) {
  const hot = level >= 4;
  return (
    <div className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 backdrop-blur-md",
      hot ? "border-rose-400/60 bg-rose-600/20" : "border-white/15 bg-slate-950/60")}>
      <span className={cn("text-[9px] font-black uppercase tracking-widest", hot ? "text-rose-300" : "text-slate-400")}>NULL</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn("h-3 w-1 rounded-sm transition-colors",
            i <= level ? (level >= 4 ? "bg-rose-400" : level >= 3 ? "bg-orange-400" : "bg-cyan-400") : "bg-white/15")}
            style={i <= level ? { boxShadow: `0 0 5px ${level >= 4 ? "#fb7185" : level >= 3 ? "#fb923c" : "#22d3ee"}` } : undefined} />
        ))}
      </div>
    </div>
  );
}
function PowerBadge({ icon, label, pct }: { icon: string; label: string; pct: number }) {
  return (
    <div className="relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border border-fuchsia-300/40 bg-slate-950/70 backdrop-blur-md">
      <div className="absolute bottom-0 left-0 w-full bg-fuchsia-500/30" style={{ height: `${Math.max(0, Math.min(1, pct)) * 100}%` }} />
      <span className="relative text-xl">{icon}</span>
      <span className="relative text-[7px] font-bold tracking-wider text-fuchsia-100">{label}</span>
    </div>
  );
}
function weatherLabel(w: string) {
  return ({ clear: "Night", rain: "Rain", storm: "Storm", fog: "Fog", snow: "Snow", heat: "Heatwave", sunrise: "Sunrise" } as Record<string, string>)[w] ?? w;
}

function TouchControls({ jump, slideS, slideE, dashS, dashE, settings }: {
  jump: () => void; slideS: () => void; slideE: () => void; dashS: () => void; dashE: () => void; settings: Settings;
}) {
  // Swipe mode hides on-screen buttons; canvas gestures handle input instead.
  if (settings.swipeControls) return null;
  const sc = settings.padScale;
  const op = settings.padOpacity;
  const big = Math.round(80 * sc);
  const small = Math.round(64 * sc);
  const btnBase = "pointer-events-auto flex select-none items-center justify-center rounded-full border backdrop-blur-md active:scale-90 transition-transform";
  const slideBtn = (
    <button key="slide" aria-label="Slide" style={{ width: small, height: small, opacity: op }}
      className={cn(btnBase, "border-cyan-300/40 bg-slate-950/50 text-2xl")}
      onPointerDown={(e) => { e.preventDefault(); slideS(); }} onPointerUp={slideE} onPointerLeave={slideE} onPointerCancel={slideE}>⬇</button>
  );
  const jumpBtn = (
    <button key="jump" aria-label="Jump" style={{ width: big, height: big, opacity: op }}
      className={cn(btnBase, "border-orange-300/50 bg-orange-500/20 text-3xl")}
      onPointerDown={(e) => { e.preventDefault(); jump(); }}>⬆</button>
  );
  const dashBtn = (
    <button key="dash" aria-label="Dash" style={{ width: small, height: small, opacity: op }}
      className={cn(btnBase, "border-fuchsia-300/40 bg-slate-950/50 text-2xl")}
      onPointerDown={(e) => { e.preventDefault(); dashS(); }} onPointerUp={dashE} onPointerLeave={dashE} onPointerCancel={dashE}>»</button>
  );
  // Left-handed puts the action cluster on the left, mirrored.
  const cluster = settings.leftHanded ? [dashBtn, jumpBtn, slideBtn] : [slideBtn, jumpBtn, dashBtn];
  return (
    <div className={cn("safe-pad pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-4 p-4 sm:hidden",
      settings.leftHanded ? "justify-start" : "justify-end")}>
      {cluster}
    </div>
  );
}

// ===========================================================================
// MENU — command console, not a centered hero
// ===========================================================================
// ===========================================================================
// MISSION BRIEFING — cinematic pre-run screen with 3·2·1·RUN countdown
// ===========================================================================
const SECTORS = ["Corporate District", "Cyber Market", "Industrial Zone", "Underground Metro", "Sky Bridge", "Rain District", "Research Labs", "Omega HQ", "Abandoned Sector", "Power Plant"];
function Briefing({ char, mode, best, onLaunch }: {
  char: CharacterDef; mode: GameMode; best: number; onLaunch: () => void;
}) {
  const [phase, setPhase] = useState<"brief" | 3 | 2 | 1 | "go">("brief");
  const sector = useMemo(() => SECTORS[Math.floor(Math.random() * SECTORS.length)], []);
  const threat = mode === "hardcore" ? "EXTREME" : mode === "bossrush" ? "CRITICAL" : "HIGH";

  useEffect(() => {
    let alive = true;
    const seq: ("brief" | 3 | 2 | 1 | "go")[] = ["brief", 3, 2, 1, "go"];
    const times = [1100, 650, 650, 650, 450];
    let i = 0;
    const tick = () => {
      if (!alive) return;
      setPhase(seq[i]);
      if (seq[i] === "go") { audio.perfect(); setTimeout(() => alive && onLaunch(), 450); return; }
      if (typeof seq[i] === "number") audio.click();
      const wait = times[i];
      i++;
      setTimeout(tick, wait);
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-[#070312]">
      <div className="holo-grid absolute inset-0 opacity-20" />
      <div className="scanlines absolute inset-0 opacity-30" />
      {phase === "brief" && (
        <div className="briefing-in relative w-[min(94vw,520px)]">
          <Panel className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-xs font-black tracking-[0.4em] text-cyan-300">◤ MISSION BRIEF</span>
              <span className="font-display text-xs font-black tracking-widest text-rose-400">CLASSIFIED</span>
            </div>
            <h2 className="font-display mb-1 text-4xl font-black tracking-tight text-white glow-cyan">ESCAPE</h2>
            <div className="font-display mb-4 text-lg font-black tracking-[0.3em]" style={{ color: char.colors.primary }}>{sector.toUpperCase()}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <BriefRow k="OPERATIVE" v={char.name} color={char.colors.primary} />
              <BriefRow k="ROLE" v={char.role} />
              <BriefRow k="OBJECTIVE" v="Reach Safe Zone" />
              <BriefRow k="THREAT" v={threat} color="#f87171" />
              <BriefRow k="NULL DETECT" v="ACTIVE" color="#f87171" />
              <BriefRow k="BEST" v={`${best}M`} color="#22d3ee" />
            </div>
            <div className="mt-4 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] italic leading-snug text-rose-200">
              ◤ {char.name}: "{getPersonality(char.id).voice}" — the city is already awake.
            </div>
          </Panel>
        </div>
      )}
      {phase !== "brief" && (
        <div key={String(phase)} className="count-pop pointer-events-none text-center">
          <div className="font-display font-black leading-none"
            style={{
              fontSize: phase === "go" ? "clamp(60px,18vw,180px)" : "clamp(80px,22vw,240px)",
              color: phase === "go" ? char.colors.primary : "#ffffff",
              textShadow: `0 0 40px ${phase === "go" ? char.colors.glow : "rgba(34,211,238,0.7)"}`,
            }}>
            {phase === "go" ? "RUN" : phase}
          </div>
        </div>
      )}
    </div>
  );
}
function BriefRow({ k, v, color = "#e2e8f0" }: { k: string; v: string; color?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{k}</div>
      <div className="font-display text-sm font-black tracking-wide" style={{ color }}>{v}</div>
    </div>
  );
}

// Angular circuit-trace rule that flanks the "BY HOST" credit line.
function CircuitRule({ side }: { side: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 120 16"
      className="h-3 w-20 shrink-0 sm:w-28"
      style={{ transform: side === "right" ? "scaleX(-1)" : undefined }}
      aria-hidden
    >
      <g fill="none" stroke="#67e8f9" strokeWidth="1.6" strokeLinecap="square" opacity="0.9">
        {/* long trace with a step-down notch */}
        <path d="M0 8 H62 l6 -5 H92" />
        {/* short lower trace */}
        <path d="M18 13 H54 l5 -4" opacity="0.55" />
        {/* arrow head */}
        <path d="M100 3 l8 5 -8 5" />
      </g>
      {/* node dots */}
      <circle cx="96" cy="8" r="1.6" fill="#a5f3fc" />
      <circle cx="4" cy="8" r="1.6" fill="#22d3ee" opacity="0.7" />
    </svg>
  );
}

function Menu({ save, lvl, onStart, nav, onDaily, canDaily }: {
  save: SaveData; lvl: { level: number; into: number; need: number };
  onStart: (m: GameMode) => void; nav: (s: Screen) => void; onDaily: () => void; canDaily: boolean;
}) {
  const [mode, setMode] = useState<GameMode>("classic");
  const char = getCharacter(save.equippedChar);
  return (
    <Overlay dim={false}>
      <div className="grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_340px]">
        {/* left: identity + play */}
        <div className="flex flex-col justify-between gap-4">
          <div className="relative">
            {/* ── title lockup ─────────────────────────────────────────── */}
            <div className="relative inline-block select-none">
              {/* OMEGA */}
              <div className="relative">
                <h1 className="title-omega font-display text-6xl font-black leading-[0.86] tracking-tight sm:text-8xl">
                  <span className="tracking-[-0.02em]">Ω</span>MEGA
                </h1>
                {/* glitch ghost */}
                <h1 aria-hidden className="title-ghost pointer-events-none absolute inset-0 font-display text-6xl font-black leading-[0.86] tracking-tight text-fuchsia-400/70 sm:text-8xl">
                  <span className="tracking-[-0.02em]">Ω</span>MEGA
                </h1>
                <span className="title-slice" style={{ top: "38%" }} />
                <span className="title-slice" style={{ top: "72%", opacity: 0.35 }} />
              </div>

              {/* ESCAPE */}
              <div className="relative -mt-1 sm:-mt-2">
                <h2 className="title-escape font-display text-5xl font-black italic leading-[0.9] tracking-[0.06em] sm:text-7xl"
                  style={{ transform: "skewX(-8deg)" }}>
                  ESCAPE
                </h2>
                <span className="title-slice" style={{ top: "46%", opacity: 0.4 }} />
              </div>

              {/* BY HOST — circuit-line credit bar */}
              <div className="mt-2 flex items-center justify-center gap-2 sm:gap-3">
                <CircuitRule side="left" />
                <span className="title-credit font-display whitespace-nowrap text-xs font-black tracking-[0.42em] text-cyan-200 sm:text-sm"
                  style={{ textShadow: "0 0 14px rgba(103,232,249,0.85)" }}>
                  BY HOST
                </span>
                <CircuitRule side="right" />
              </div>
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Year 2149. Subject <span className="font-bold text-cyan-300">X-01</span> has breached containment.
              Run the districts. Hack the Guardians. The Network is watching.
            </p>
            {canDaily && (
              <button onClick={onDaily}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-500/15 px-4 py-2 font-display text-sm font-black tracking-widest text-amber-200 transition hover:bg-amber-500/25 active:scale-95">
                <Gift size={16} className="animate-bounce" /> CLAIM DAILY REWARD
              </button>
            )}
          </div>

          <Panel className="max-w-xl">
            <div className="mb-3 flex items-center gap-2">
              <Gauge size={16} className="text-cyan-300" />
              <span className="font-display text-xs font-black uppercase tracking-widest text-slate-300">Deploy Mode</span>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={cn("group flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all active:scale-95",
                    mode === m.id ? "border-cyan-300/70 bg-cyan-500/15 shadow-[0_0_18px_-6px_rgba(34,211,238,0.9)]" : "border-white/10 bg-white/5 hover:border-white/30")}>
                  <span className="text-xl">{m.icon}</span>
                  <span className="font-display text-[11px] font-black tracking-wide">{m.name}</span>
                </button>
              ))}
            </div>
            <NeonBtn variant="accent" className="w-full py-3.5 text-base" onClick={() => onStart(mode)}>
              <Play size={20} /> INITIATE ESCAPE
            </NeonBtn>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
              <b className="text-slate-300">Tap/Space</b> jump · <b className="text-slate-300">×2</b> double/triple · <b className="text-slate-300">↓/S</b> slide · <b className="text-slate-300">Hold/Shift</b> dash · walls: jump on contact
            </p>
          </Panel>
        </div>

        {/* right: profile + nav rail */}
        <div className="flex flex-col gap-3">
          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-xs font-black uppercase tracking-widest text-slate-400">Subject File</span>
              <span className="font-display text-xs font-black text-cyan-300">LV {lvl.level}</span>
            </div>
            <div className="mb-1 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border" style={{ borderColor: char.colors.primary, boxShadow: `0 0 16px -4px ${char.colors.glow}` }}>
                <span className="font-display text-lg font-black" style={{ color: char.colors.primary }}>{char.name.slice(0, 2)}</span>
              </div>
              <div className="min-w-0">
                <div className="font-display text-lg font-black tracking-wide" style={{ color: char.colors.primary }}>{char.name}</div>
                <div className="truncate text-xs text-slate-400">{char.role} · {char.abilityName}</div>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-500" style={{ width: `${(lvl.into / lvl.need) * 100}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Best" value={`${save.best}M`} color="text-cyan-300" />
              <MiniStat label="Coins" value={fmt(save.totalCoins)} color="text-amber-300" />
              <MiniStat label="Runs" value={String(save.runs)} color="text-slate-300" />
            </div>
            <div className="mt-2 flex justify-center gap-3 text-[10px] font-bold text-slate-500">
              <span>◈ {save.totalCrystals} crystals</span>
              <span>· {fmt(Math.floor(save.stats.distanceTotal))}M total</span>
              <span>· {save.stats.bosses} bosses</span>
            </div>
          </Panel>

          <nav className="grid grid-cols-2 gap-2">
            <NavCard icon={<Users size={18} />} label="Characters" onClick={() => nav("characters")} />
            <NavCard icon={<ShoppingBag size={18} />} label="Shop" onClick={() => nav("shop")} />
            <NavCard icon={<Target size={18} />} label="Missions" onClick={() => nav("missions")} badge={claimableCount(save)} />
            <NavCard icon={<Trophy size={18} />} label="Records" onClick={() => nav("scores")} />
            <NavCard icon={<SettingsIcon size={18} />} label="Settings" onClick={() => nav("settings")} />
            <NavCard icon={<Trophy size={18} />} label="Feats" onClick={() => nav("achievements")} badge={save.achievements.length} />
          </nav>
        </div>
      </div>
    </Overlay>
  );
}

function claimableCount(save: SaveData) {
  return [...getDailyMissions(), ...getWeeklyMissions()].filter(
    (m) => !save.missionsClaimed.includes(m.id) && (save.missionProgress[m.id] ?? 0) >= m.target,
  ).length;
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-1 py-1.5">
      <div className={cn("font-display text-sm font-black tabular-nums", color)}>{value}</div>
      <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}
function NavCard({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick}
      className="group relative flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left transition-all hover:border-cyan-300/50 hover:bg-cyan-500/10 active:scale-95">
      <span className="text-cyan-300 transition group-hover:scale-110">{icon}</span>
      <span className="font-display text-xs font-black uppercase tracking-widest">{label}</span>
      {badge ? <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white shadow-[0_0_10px_rgba(249,115,22,0.8)]">{badge}</span> : null}
    </button>
  );
}

// ===========================================================================
// CHARACTER SELECT
// ===========================================================================
function CharacterSelect({ save, persist, onAction, onBack }: {
  save: SaveData; persist: (s: SaveData) => void; onAction: (c: CharacterDef) => void; onBack: () => void;
}) {
  const [selId, setSelId] = useState(save.equippedChar);
  const c = getCharacter(selId);
  const skinId = save.equippedSkins[c.id] ?? `${c.id}_default`;
  const skin = SKINS.find((s) => s.id === skinId) ?? SKINS.find((s) => s.charId === c.id)!;
  const colors = skin.colors;
  const unlocked = save.unlockedChars.includes(c.id);
  const condMet = c.unlockCheck({ best: save.best, totalCoins: save.totalCoins, bosses: save.stats.bosses, runs: save.runs, jumps: save.stats.jumps });
  const charSkins = SKINS.filter((s) => s.charId === c.id);

  return (
    <Overlay>
      <div className="w-full max-w-5xl">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 transition hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-cyan-300 glow-cyan">CHARACTER SELECT</h2>
          <div className="w-16" />
        </div>

        <Panel className="grid gap-5 p-5 md:grid-cols-[280px_1fr_240px]">
          {/* bio */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-display text-3xl font-black tracking-wide" style={{ color: colors.primary, textShadow: `0 0 16px ${colors.glow}` }}>{c.name}</span>
              <span className="rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest" style={{ borderColor: RARITY_COLOR[c.rarity], color: RARITY_COLOR[c.rarity] }}>{c.rarity}</span>
            </div>
            <div className="text-sm text-slate-400">{c.role}</div>
            <div className="space-y-1 text-xs text-slate-400">
              <Row k="Origin" v={c.origin} /><Row k="Faction" v={c.faction} /><Row k="Age" v={String(c.age)} />
              <Row k="Difficulty" v={c.difficulty} />
            </div>
            <p className="text-xs italic leading-relaxed text-slate-500">"{c.bio}"</p>
            <button
              onClick={() => { audio.nullVoice(); }}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left transition hover:border-cyan-300/40 active:scale-95">
              <span className="text-cyan-300">🔊</span>
              <span className="text-[11px] italic" style={{ color: c.colors.primary }}>"{getPersonality(c.id).voice}"</span>
            </button>
            <div className="mt-1 space-y-1.5">
              <AbilityCard title={c.abilityName} desc={c.abilityDesc} color={colors.primary} tag="ABILITY" />
              <AbilityCard title={c.passiveName} desc={c.passiveDesc} color="#94a3b8" tag="PASSIVE" />
            </div>
          </div>

          {/* preview holo */}
          <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-transparent to-black/40 p-4">
            <div className="holo-grid absolute inset-0 opacity-40" />
            <CharFigure primary={colors.primary} secondary={colors.secondary} glow={colors.glow} accent={c.colors.accent} silhouette={c.silhouette} build={c.build} hood={skin.hood ?? c.hood} big />
            <div className="absolute bottom-2 left-0 right-0 text-center">
              <div className="font-display text-xs font-black tracking-[0.4em]" style={{ color: colors.primary }}>{skin.name.toUpperCase()}</div>
            </div>
            <div className="absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2" style={{ borderColor: colors.primary }} />
            <div className="absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2" style={{ borderColor: colors.primary }} />
            <div className="absolute bottom-3 left-3 h-6 w-6 border-b-2 border-l-2" style={{ borderColor: colors.primary }} />
            <div className="absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2" style={{ borderColor: colors.primary }} />
          </div>

          {/* stats + skins */}
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <StatBar label="Speed" value={c.stats.speed} color={colors.primary} />
              <StatBar label="Power" value={c.stats.power} color="#f97316" />
              <StatBar label="Agility" value={c.stats.agility} color="#a855f7" />
              <StatBar label="Defense" value={c.stats.defense} color="#4ade80" />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Skins</div>
              <div className="grid grid-cols-2 gap-1.5">
                {charSkins.map((s) => {
                  const owned = save.unlockedSkins.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => { audio.click(); persist({ ...save, equippedSkins: { ...save.equippedSkins, [c.id]: s.id } }); }}
                      disabled={!owned}
                      className={cn("flex flex-col items-center rounded-md border p-1.5 transition active:scale-95",
                        skinId === s.id ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5",
                        !owned && "opacity-40")}>
                      <div className="h-8 w-8 rounded-full" style={{ background: `linear-gradient(135deg, ${s.colors.primary}, ${s.colors.secondary})`, boxShadow: `0 0 10px ${s.colors.glow}` }} />
                      <span className="mt-1 text-[9px] font-bold" style={{ color: RARITY_COLOR[s.rarity] }}>{owned ? s.name : `${s.price}⬡`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {!unlocked && (
              <div className={cn("rounded-md border px-2 py-1.5 text-[10px] font-bold", condMet ? "border-amber-300/40 bg-amber-500/10 text-amber-200" : "border-rose-400/40 bg-rose-500/10 text-rose-200")}>
                <Lock size={10} className="mr-1 inline" /> {c.unlockDesc}
              </div>
            )}
            <NeonBtn variant={save.equippedChar === c.id ? "ghost" : "accent"} className="w-full"
              onClick={() => onAction(c)}>
              {save.equippedChar === c.id ? <><Check size={16} /> Equipped</>
                : unlocked ? "Equip"
                  : condMet ? `Unlock · ${fmt(c.price)}⬡`
                    : <><Lock size={14} /> Locked</>}
            </NeonBtn>
          </div>
        </Panel>

        {/* carousel */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {CHARACTERS.map((ch) => {
            const owned = save.unlockedChars.includes(ch.id);
            const eq = save.equippedChar === ch.id;
            return (
              <button key={ch.id} onClick={() => { audio.hover(); setSelId(ch.id); }}
                className={cn("relative flex w-24 shrink-0 flex-col items-center rounded-lg border p-2 transition-all active:scale-95",
                  selId === ch.id ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:border-white/30",
                  !owned && "opacity-70")}>
                <CharFigure primary={ch.colors.primary} secondary={ch.colors.secondary} glow={ch.colors.glow} accent={ch.colors.accent} silhouette={ch.silhouette} build={ch.build} hood={ch.hood} small />
                <span className="font-display mt-1 text-[11px] font-black tracking-widest" style={{ color: ch.colors.primary }}>{ch.name}</span>
                <span className="text-[8px] uppercase tracking-wider text-slate-500">{ch.role}</span>
                {eq && <span className="absolute -top-1.5 right-1 rounded bg-cyan-400 px-1 text-[8px] font-black text-black">ACTIVE</span>}
                {!owned && <Lock size={10} className="absolute right-1 top-1 text-slate-400" />}
              </button>
            );
          })}
        </div>
      </div>
    </Overlay>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="uppercase tracking-widest text-slate-500">{k}</span><span className="font-semibold text-slate-300">{v}</span></div>;
}
function AbilityCard({ title, desc, color, tag }: { title: string; desc: string; color: string; tag: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-xs font-black tracking-wide" style={{ color }}>{title}</span>
        <span className="text-[8px] font-black tracking-widest text-slate-500">{tag}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{desc}</p>
    </div>
  );
}

// CSS-drawn character hologram used in menus/carousels — unique per silhouette.
function CharFigure({ primary, secondary, glow, accent, build, hood, silhouette = "runner", big, small }: {
  primary: string; secondary: string; glow: string; accent?: string; build: number;
  hood?: boolean; silhouette?: string; big?: boolean; small?: boolean;
}) {
  const w = small ? 26 : big ? 64 : 40;
  const h = (small ? 44 : big ? 120 : 70) * (0.9 + build * 0.12);
  const ac = accent ?? primary;
  const isHood = hood || silhouette === "shadow";
  return (
    <div className="relative float-anim" style={{ width: w * build * 1.4, height: h }}>
      {/* cape / cloak behind */}
      {silhouette === "runner" && (
        <div className="absolute" style={{ top: h * 0.28, left: "8%", width: w * 0.5, height: h * 0.3, background: ac, opacity: 0.85, transform: "skewY(-20deg)", borderRadius: 4, boxShadow: `0 0 10px ${ac}` }} />
      )}
      {silhouette === "shadow" && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: w * 0.4, width: w * 0.95, height: h * 0.55, background: secondary, clipPath: "polygon(20% 0, 80% 0, 100% 100%, 70% 80%, 50% 100%, 30% 80%, 0 100%)", boxShadow: `0 0 12px ${glow}` }} />
      )}
      {silhouette === "scout" && (
        <div className="absolute" style={{ top: h * 0.3, left: "6%", width: w * 0.55, height: h * 0.28, background: ac, opacity: 0.75, clipPath: "polygon(100% 0, 0 60%, 60% 100%)", boxShadow: `0 0 8px ${ac}` }} />
      )}

      {/* head */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 0, width: w * 0.42, height: w * 0.42, background: secondary, borderRadius: 4, boxShadow: `0 0 ${small ? 8 : 18}px ${glow}` }}>
        {isHood && <div className="absolute left-1/2 -translate-x-1/2" style={{ top: -w * 0.14, width: w * 0.6, height: w * 0.3, background: secondary, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />}
        {silhouette === "rebel" && (
          <div className="absolute left-1/2 -translate-x-1/2 flex" style={{ top: -w * 0.28, gap: 1 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} style={{ width: 3, height: w * (0.2 + (i % 2) * 0.12), background: primary, clipPath: "polygon(50% 0, 100% 100%, 0 100%)", boxShadow: `0 0 6px ${glow}` }} />)}
          </div>
        )}
        {silhouette === "scout" && [-1, 1].map((sd) => (
          <div key={sd} className="absolute" style={{ top: -w * 0.4, left: sd < 0 ? "10%" : "70%", width: 4, height: w * 0.42, background: ac, borderRadius: 3, transform: `rotate(${sd * 15}deg)`, boxShadow: `0 0 6px ${ac}` }} />
        ))}
        {silhouette === "hacker" && (
          <div className="absolute" style={{ top: -w * 0.2, right: -2, width: 3, height: w * 0.22, background: ac, boxShadow: `0 0 6px ${ac}` }} />
        )}
        {/* visor / eyes */}
        <div className="absolute left-1/2 top-1/2 h-1 -translate-x-1/2 -translate-y-1/2 rounded" style={{ width: "70%", background: primary, boxShadow: `0 0 6px ${primary}` }} />
      </div>

      {/* torso */}
      <div className="absolute left-1/2 -translate-x-1/2 rounded-md" style={{ top: w * 0.46, width: w * 0.72 * (silhouette === "tank" ? 1.25 : 1), height: h * 0.42, background: `linear-gradient(180deg, ${primary} 0%, ${secondary} 45%)`, border: `1.5px solid ${primary}`, boxShadow: `0 0 ${small ? 10 : 22}px -2px ${glow}` }}>
        <div className="absolute left-1/2 top-1/3 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ background: glow, boxShadow: `0 0 8px ${glow}` }} />
        {silhouette === "tank" && [-1, 1].map((sd) => (
          <div key={sd} className="absolute rounded" style={{ top: -3, [sd < 0 ? "left" : "right"]: -w * 0.22, width: w * 0.26, height: h * 0.16, background: secondary, border: `1.5px solid ${ac}` }} />
        ))}
        {silhouette === "rebel" && (
          <div className="absolute rounded-full" style={{ bottom: 2, right: -w * 0.12, width: w * 0.22, height: w * 0.22, background: ac, boxShadow: `0 0 10px ${glow}` }} />
        )}
      </div>

      {/* companion drone */}
      {silhouette === "hacker" && (
        <div className="absolute rounded-full float-anim" style={{ top: w * 0.5, left: -w * 0.35, width: w * 0.3, height: w * 0.3, background: secondary, border: `1.5px solid ${ac}`, boxShadow: `0 0 8px ${ac}` }} />
      )}

      {/* legs */}
      <div className="absolute left-1/2 flex -translate-x-1/2 gap-1" style={{ top: w * 0.46 + h * 0.42, height: h * 0.32 }}>
        <div className="rounded-b" style={{ width: silhouette === "tank" ? 4 : 2.5, background: "#e0d0ff", height: "100%" }} />
        <div className="rounded-b" style={{ width: silhouette === "tank" ? 4 : 2.5, background: "#e0d0ff", height: "88%" }} />
      </div>

      {big && <div className="absolute -bottom-3 left-1/2 h-2 w-[130%] -translate-x-1/2 rounded-full opacity-60 blur-[2px]" style={{ background: glow }} />}
    </div>
  );
}

// ===========================================================================
// SHOP
// ===========================================================================
function Shop({ save, onSkin, onItem, onBack }: {
  save: SaveData; onSkin: (s: SkinDef) => void; onItem: (k: "trail" | "board", id: string, price: number) => void; onBack: () => void;
}) {
  const [tab, setTab] = useState<"skins" | "trails" | "boards">("skins");
  return (
    <Overlay>
      <div className="w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-amber-300" style={{ textShadow: "0 0 18px rgba(251,191,36,0.6)" }}>BLACK MARKET</h2>
          <div className="rounded-md border border-amber-300/40 bg-amber-500/10 px-3 py-1 font-display text-sm font-black text-amber-300">⬡ {fmt(save.totalCoins)}</div>
        </div>
        <div className="mb-3 flex gap-2">
          {(["skins", "trails", "boards"] as const).map((t) => (
            <button key={t} onClick={() => { audio.click(); setTab(t); }}
              className={cn("font-display rounded-md border px-4 py-1.5 text-xs font-black uppercase tracking-widest transition",
                tab === t ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400")}>{t}</button>
          ))}
        </div>
        <Panel className="max-h-[62vh] overflow-y-auto p-4">
          {tab === "skins" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SKINS.filter((s) => s.price > 0 || save.unlockedChars.includes(s.charId)).map((s) => {
                const owned = save.unlockedSkins.includes(s.id);
                const equipped = save.equippedSkins[s.charId] === s.id;
                return (
                  <button key={s.id} onClick={() => onSkin(s)}
                    className={cn("flex flex-col items-center rounded-lg border p-3 transition active:scale-95",
                      equipped ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:border-white/30")}>
                    <div className="h-12 w-12 rounded-full" style={{ background: `linear-gradient(135deg, ${s.colors.primary}, ${s.colors.secondary})`, boxShadow: `0 0 14px ${s.colors.glow}` }} />
                    <span className="mt-2 text-xs font-black">{s.name}</span>
                    <span className="text-[9px] font-bold" style={{ color: RARITY_COLOR[s.rarity] }}>{s.rarity} · {getCharacter(s.charId).name}</span>
                    <span className="mt-1 text-[10px] font-bold text-amber-300">{owned ? (equipped ? "EQUIPPED" : "TAP TO EQUIP") : `${fmt(s.price)}⬡`}</span>
                  </button>
                );
              })}
            </div>
          )}
          {tab === "trails" && (
            <div className="grid grid-cols-3 gap-2">
              {TRAILS.map((t) => {
                const owned = save.unlockedTrails.includes(t.id);
                const eq = save.equippedTrail === t.id;
                return (
                  <button key={t.id} onClick={() => onItem("trail", t.id, t.price)}
                    className={cn("flex flex-col items-center rounded-lg border p-3 transition active:scale-95", eq ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5")}>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/40">
                      <div className="absolute inset-y-0 right-0 w-2/3" style={{ background: `linear-gradient(90deg, transparent, ${t.color})`, boxShadow: `0 0 10px ${t.color}` }} />
                    </div>
                    <span className="mt-2 text-xs font-black">{t.name}</span>
                    <span className="text-[10px] font-bold text-amber-300">{owned ? (eq ? "EQUIPPED" : "EQUIP") : `${t.price}⬡`}</span>
                  </button>
                );
              })}
            </div>
          )}
          {tab === "boards" && (
            <div className="grid grid-cols-3 gap-2">
              {BOARDS.map((b) => {
                const owned = save.unlockedBoards.includes(b.id);
                const eq = save.equippedBoard === b.id;
                return (
                  <button key={b.id} onClick={() => onItem("board", b.id, b.price)}
                    className={cn("flex flex-col items-center rounded-lg border p-3 transition active:scale-95", eq ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5")}>
                    <div className="h-3 w-full rounded-full" style={{ background: b.id === "none" ? "#334155" : b.color, boxShadow: b.id === "none" ? "none" : `0 0 14px ${b.color}` }} />
                    <span className="mt-2 text-xs font-black">{b.name}</span>
                    <span className="text-[10px] font-bold text-amber-300">{owned ? (eq ? "EQUIPPED" : "EQUIP") : `${b.price}⬡`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <p className="mt-2 text-center text-[10px] text-slate-500">Cosmetics only. Skill wins runs.</p>
      </div>
    </Overlay>
  );
}

// ===========================================================================
// MISSIONS / ACHIEVEMENTS / SCORES / SETTINGS / GAMEOVER
// ===========================================================================
function Missions({ save, onClaim, onBack }: { save: SaveData; onClaim: (id: string, reward: number) => void; onBack: () => void }) {
  const dailies = getDailyMissions();
  const weeklies = getWeeklyMissions();
  const render = (title: string, list: typeof dailies) => (
    <div>
      <h3 className="font-display mb-2 text-xs font-black uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="flex flex-col gap-2">
        {list.map((m) => {
          const prog = Math.min(m.target, save.missionProgress[m.id] ?? 0);
          const done = prog >= m.target;
          const claimed = save.missionsClaimed.includes(m.id);
          return (
            <div key={m.id} className={cn("rounded-lg border p-3", claimed ? "border-white/5 bg-white/[0.02] opacity-60" : done ? "border-emerald-300/40 bg-emerald-500/10" : "border-white/10 bg-white/5")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{m.desc}</span>
                {claimed ? <Check size={16} className="text-emerald-400" /> : done ? (
                  <button onClick={() => onClaim(m.id, m.reward)} className="rounded-md border border-emerald-300/60 bg-emerald-500/20 px-3 py-1 font-display text-[10px] font-black tracking-widest text-emerald-200 active:scale-95">
                    CLAIM {m.reward}⬡
                  </button>
                ) : <span className="text-xs font-black text-amber-300">{m.reward}⬡</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={cn("h-full", done ? "bg-emerald-400" : "bg-cyan-400")} style={{ width: `${(prog / m.target) * 100}%` }} />
              </div>
              <div className="mt-0.5 text-right text-[10px] tabular-nums text-slate-500">{prog}/{m.target}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <Overlay>
      <div className="w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-cyan-300 glow-cyan">MISSIONS</h2>
          <div className="w-14" />
        </div>
        <Panel className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto p-5">
          {render("Daily Contracts", dailies)}
          {render("Weekly Operations", weeklies)}
        </Panel>
      </div>
    </Overlay>
  );
}

function Achievements({ save, onBack }: { save: SaveData; onBack: () => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-amber-300">FEATS</h2>
          <div className="text-xs font-black text-slate-400">{save.achievements.length}/{ACHIEVEMENTS.length}</div>
        </div>
        <Panel className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-5">
          {ACHIEVEMENTS.map((a) => {
            const got = save.achievements.includes(a.id);
            return (
              <div key={a.id} className={cn("flex items-center gap-3 rounded-lg border p-3", got ? "border-amber-300/40 bg-amber-500/10" : "border-white/10 bg-white/5 opacity-70")}>
                <span className={cn("text-2xl", !got && "grayscale")}>{a.icon}</span>
                <div className="flex-1">
                  <div className="font-display text-sm font-black tracking-wide">{a.name}</div>
                  <div className="text-xs text-slate-400">{a.desc}</div>
                </div>
                {got && <Check size={18} className="text-amber-300" />}
              </div>
            );
          })}
        </Panel>
      </div>
    </Overlay>
  );
}

function Scores({ save, onBack }: { save: SaveData; onBack: () => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-cyan-300 glow-cyan">ESCAPE RECORDS</h2>
          <div className="w-14" />
        </div>
        <Panel className="p-5">
          {save.scores.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No runs yet. The Network awaits.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {save.scores.map((s, i) => (
                <li key={i} className={cn("flex items-center gap-3 rounded-md border px-3 py-2", i === 0 ? "border-amber-300/50 bg-amber-500/10" : "border-white/10 bg-white/5")}>
                  <span className={cn("w-6 text-center font-display text-lg font-black", i === 0 ? "text-amber-300" : "text-slate-500")}>{i + 1}</span>
                  <span className="flex-1 font-display text-lg font-black tabular-nums text-cyan-100">{s.distance}M</span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{s.mode}</span>
                  <span className="text-sm font-bold text-amber-300">⬡{s.coins}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </Overlay>
  );
}

function SettingsScreen({ settings, onToggle, onScale, onGraphics, onVolume, onNumber, onBack }: {
  settings: Settings; onToggle: (k: keyof Settings) => void; onScale: (v: number) => void;
  onGraphics: (g: "low" | "medium" | "high" | "ultra") => void;
  onVolume: (k: "musicVol" | "sfxVol", v: number) => void;
  onNumber: (k: keyof Settings, v: number) => void;
  onBack: () => void;
}) {
  const items: { key: keyof Settings; label: string; icon: string; hint: string }[] = [
    { key: "music", label: "Music", icon: "🎵", hint: "Adaptive synthwave score" },
    { key: "sfx", label: "Sound FX", icon: "🔊", hint: "Actions, impacts, city life" },
    { key: "shake", label: "Screen Shake", icon: "📳", hint: "Impact camera feedback" },
    { key: "reducedMotion", label: "Reduced Motion", icon: "🌀", hint: "Calmer UI animations" },
    { key: "colorblind", label: "Colorblind Mode", icon: "👁", hint: "Hazards shift to orange + patterns" },
    { key: "vibrate", label: "Vibration", icon: "📳", hint: "Haptics on mobile" },
    { key: "leftHanded", label: "Left-Handed Mode", icon: "🤚", hint: "Mirror mobile controls" },
    { key: "swipeControls", label: "Swipe Controls", icon: "👆", hint: "Gestures instead of buttons" },
  ];
  const presets: { id: "low" | "medium" | "high" | "ultra"; label: string; hint: string }[] = [
    { id: "low", label: "LOW", hint: "Best performance" },
    { id: "medium", label: "MED", hint: "Balanced" },
    { id: "high", label: "HIGH", hint: "Full effects" },
    { id: "ultra", label: "ULTRA", hint: "Max quality" },
  ];
  return (
    <Overlay>
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-cyan-300"><ChevronLeft size={18} /> Back</button>
          <h2 className="font-display text-2xl font-black tracking-[0.3em] text-cyan-300 glow-cyan">SETTINGS</h2>
          <div className="w-14" />
        </div>
        <Panel className="flex flex-col gap-2 p-5">
          {items.map((it) => (
            <button key={it.key} onClick={() => onToggle(it.key)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 transition hover:border-white/25 active:scale-[0.98]">
              <span className="text-left">
                <span className="block text-sm font-black tracking-wide">{it.icon} {it.label}</span>
                <span className="block text-[10px] text-slate-500">{it.hint}</span>
              </span>
              <Toggle on={Boolean(settings[it.key])} />
            </button>
          ))}
          {settings.music && (
            <Slider label="🎵 Music Volume" value={settings.musicVol} onChange={(v) => onVolume("musicVol", v)} />
          )}
          {settings.sfx && (
            <Slider label="🔊 SFX Volume" value={settings.sfxVol} onChange={(v) => onVolume("sfxVol", v)} />
          )}
          <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
            <div className="mb-1.5 text-sm font-black tracking-wide">🎮 Graphics Quality</div>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button key={p.id} onClick={() => onGraphics(p.id)}
                  className={cn("rounded-md border py-1.5 text-center transition active:scale-95",
                    settings.graphics === p.id ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400")}>
                  <span className="block text-[11px] font-black">{p.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-1 text-center text-[10px] text-slate-500">
              {presets.find((p) => p.id === settings.graphics)?.hint} · auto-drops if FPS is low
            </div>
          </div>
          <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
            <div className="mb-1.5 text-sm font-black tracking-wide">🔍 UI Scale</div>
            <div className="flex gap-2">
              {[0.85, 1, 1.15].map((v) => (
                <button key={v} onClick={() => onScale(v)}
                  className={cn("flex-1 rounded-md border py-1 text-xs font-black", settings.uiScale === v ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400")}>
                  {v === 0.85 ? "S" : v === 1 ? "M" : "L"}
                </button>
              ))}
            </div>
          </div>
          {/* Mobile controls — only relevant on touch devices */}
          <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
            <div className="mb-2 text-sm font-black tracking-wide">📱 Touch Controls</div>
            <Slider label="Button Size" value={(settings.padScale - 0.8) / 0.6} onChange={(v) => onNumber("padScale", 0.8 + v * 0.6)} inline />
            <Slider label="Button Opacity" value={settings.padOpacity} onChange={(v) => onNumber("padOpacity", Math.max(0.3, v))} inline />
          </div>
          <p className="mt-1 text-center text-[10px] leading-relaxed text-slate-500">
            Cloud Save, Leaderboards and IAP adapters are architecture-ready. Progress persists locally.
          </p>
        </Panel>
      </div>
    </Overlay>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cn("relative block h-6 rounded-full border transition-colors", on ? "border-cyan-300/60 bg-cyan-500/40" : "border-white/20 bg-white/10")} style={{ width: 46 }}>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </span>
  );
}

// Neon range slider for volumes and mobile pad tuning.
function Slider({ label, value, onChange, inline }: { label: string; value: number; onChange: (v: number) => void; inline?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-white/5 px-4 py-2.5", inline && "mb-2 border-0 bg-transparent px-0 py-1")}>
      <div className="mb-1.5 flex items-center justify-between text-sm font-black tracking-wide">
        <span>{label}</span>
        <span className="text-xs tabular-nums text-cyan-300">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range" min={0} max={1} step={0.05} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="omega-range w-full"
        aria-label={label}
      />
    </div>
  );
}

function GameOver({ result, best, isBest, leveledUp, newAch, reviveUsed, onRevive, onRetry, onHome }: {
  result: RunResult; best: number; isBest: boolean; leveledUp: number | null; newAch: string[];
  reviveUsed: boolean; onRevive: () => void; onRetry: () => void; onHome: () => void;
}) {
  const share = () => {
    audio.click();
    const text = `I escaped ${result.distance}M in OMEGA ESCAPE with ${result.coins} coins and ${result.stats.perfectDodges} perfect dodges. Beat me.`;
    if (navigator.share) navigator.share({ title: "OMEGA ESCAPE", text }).catch(() => {});
    else navigator.clipboard?.writeText(text).catch(() => {});
  };
  return (
    <Overlay>
      <Panel className="w-[min(94vw,480px)] text-center">
        <h2 className="font-display text-4xl font-black tracking-widest text-rose-400" style={{ textShadow: "0 0 18px rgba(244,63,94,0.7)" }}>
          {result.mode === "timeattack" ? "TIME EXPIRED" : "SYSTEM DOWN"}
        </h2>
        {isBest && <p className="mt-1 animate-pulse font-display text-sm font-black uppercase tracking-widest text-amber-300">🏆 New Best Distance</p>}
        {leveledUp && <p className="font-display text-sm font-black uppercase tracking-widest text-cyan-300">⬆ Level {leveledUp} reached</p>}
        {newAch.length > 0 && (
          <p className="text-xs font-bold text-fuchsia-300">
            {newAch.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name).filter(Boolean).join(" · ")} unlocked
          </p>
        )}
        <div className="my-5">
          <div className="font-display text-6xl font-black tabular-nums text-cyan-200 glow-cyan">
            {result.distance}<span className="text-2xl text-slate-400">M</span>
          </div>
          <div className="text-xs uppercase tracking-widest text-slate-400">Best {Math.max(best, result.distance)}M</div>
        </div>
        {/* objective result */}
        {result.objectiveLabel && (
          <div className={cn("mb-3 rounded-md border px-3 py-2 text-center text-sm font-bold",
            result.objectiveDone ? "border-emerald-300/50 bg-emerald-500/10 text-emerald-200" : "border-slate-500/30 bg-slate-800/30 text-slate-400")}>
            {result.objectiveDone ? "✓ " : "✗ "}{result.objectiveLabel}
          </div>
        )}
        <div className="mb-5 grid grid-cols-4 gap-2">
          <MiniStat label="Coins" value={fmt(result.coins)} color="text-amber-300" />
          <MiniStat label="Combo" value={String(result.maxCombo)} color="text-orange-300" />
          <MiniStat label="Perfect" value={String(result.stats.perfectDodges)} color="text-emerald-300" />
          <MiniStat label="XP" value={`+${result.xp}`} color="text-cyan-300" />
        </div>
        <div className="mb-5 flex items-center justify-center gap-3 text-xs">
          <span className="font-bold text-slate-400">◈ {result.crystals} crystals</span>
          <span className="text-slate-600">·</span>
          <span className="font-bold text-slate-400">NULL Threat Lv.{result.threat}</span>
          <span className="text-slate-600">·</span>
          <span className="font-bold text-slate-400">{result.stats.jumps} jumps</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {!reviveUsed && result.mode !== "training" && (
            <NeonBtn variant="accent" onClick={onRevive}><Heart size={16} /> Revive & Continue</NeonBtn>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NeonBtn onClick={onRetry}><RotateCcw size={16} /> Retry</NeonBtn>
            <NeonBtn variant="ghost" onClick={share}><Share2 size={16} /> Share</NeonBtn>
          </div>
          <NeonBtn variant="ghost" onClick={onHome}><Home size={16} /> Main Menu</NeonBtn>
        </div>
      </Panel>
    </Overlay>
  );
}

function fmt(n: number) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
