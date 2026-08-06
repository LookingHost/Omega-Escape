// ---------------------------------------------------------------------------
// AudioEngine — procedural cyberpunk sound via WebAudio (no asset files).
// Layers: master → music / sfx / ambient buses. Adaptive music intensity.
// ---------------------------------------------------------------------------

type Wave = OscillatorType;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private musicTimer: number | null = null;
  private musicStep = 0;
  private intensity = 0; // 0..2 — rises with speed / boss

  musicEnabled = true;
  sfxEnabled = true;

  private ensure() {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.26;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.6;
    this.sfxGain.connect(this.master);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.3;
    this.ambientGain.connect(this.master);
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(
    freq: number,
    dur: number,
    type: Wave,
    gain: number,
    dest: GainNode,
    slideTo?: number,
    delay = 0,
  ) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, gain: number, dest: GainNode, hp = 800, lp = 0) {
    if (!this.ctx) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    let node: AudioNode = src;
    if (hp > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      node.connect(f);
      node = f;
    }
    if (lp > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    node.connect(g);
    g.connect(dest);
    src.start();
  }

  // -- SFX ----------------------------------------------------------------
  jump() { if (this.ok()) this.tone(420, 0.16, "square", 0.22, this.sfxGain!, 700); }
  doubleJump() { if (this.ok()) this.tone(620, 0.16, "square", 0.2, this.sfxGain!, 980); }
  wallJump() { if (this.ok()) { this.tone(300, 0.14, "square", 0.22, this.sfxGain!, 560); this.noise(0.1, 0.12, this.sfxGain!, 900); } }
  dash() { if (this.ok()) { this.tone(900, 0.2, "sawtooth", 0.18, this.sfxGain!, 200); this.noise(0.16, 0.14, this.sfxGain!, 1200); } }
  slide() { if (this.ok()) this.noise(0.24, 0.16, this.sfxGain!, 500); }
  land() { if (this.ok()) this.noise(0.09, 0.1, this.sfxGain!, 200, 900); }
  coin() { if (this.ok()) this.tone(1180, 0.07, "triangle", 0.2, this.sfxGain!, 1560); }
  crystal() { if (this.ok()) { this.tone(880, 0.1, "triangle", 0.24, this.sfxGain!, 1320); this.tone(1320, 0.16, "triangle", 0.2, this.sfxGain!, 1760, 0.07); } }
  powerup() { if (this.ok()) { this.tone(520, 0.1, "square", 0.2, this.sfxGain!, 780); this.tone(780, 0.14, "square", 0.18, this.sfxGain!, 1040, 0.09); } }
  perfect() { if (this.ok()) { this.tone(1400, 0.12, "sine", 0.2, this.sfxGain!, 2100); this.tone(2100, 0.18, "sine", 0.14, this.sfxGain!, 2800, 0.06); } }
  hit() { if (this.ok()) { this.tone(220, 0.24, "sawtooth", 0.28, this.sfxGain!, 60); this.noise(0.28, 0.28, this.sfxGain!, 300); } }
  explosion() { if (this.ok()) { this.tone(120, 0.5, "sawtooth", 0.32, this.sfxGain!, 30); this.noise(0.5, 0.38, this.sfxGain!, 200); } }
  laser() { if (this.ok()) this.tone(1800, 0.14, "sawtooth", 0.12, this.sfxGain!, 300); }
  click() { if (this.ok()) this.tone(660, 0.05, "square", 0.13, this.sfxGain!, 880); }
  hover() { if (this.ok()) this.tone(520, 0.03, "sine", 0.05, this.sfxGain!, 560); }
  buy() { if (this.ok()) { this.tone(660, 0.08, "triangle", 0.2, this.sfxGain!, 990); this.tone(990, 0.12, "triangle", 0.18, this.sfxGain!, 1320, 0.08); } }
  deny() { if (this.ok()) this.tone(200, 0.16, "square", 0.18, this.sfxGain!, 140); }
  thunder() { if (this.ok()) { this.noise(0.7, 0.32, this.sfxGain!, 120); this.tone(70, 0.6, "sawtooth", 0.28, this.sfxGain!, 40); } }
  siren() {
    if (!this.ok()) return;
    const g = this.ambientGain!;
    this.tone(720, 0.9, "sine", 0.05, g, 940);
    this.tone(940, 0.9, "sine", 0.05, g, 720, 0.9);
  }
  trainHorn() { if (this.ok()) { this.tone(180, 0.7, "sawtooth", 0.08, this.ambientGain!, 175); this.tone(226, 0.7, "sawtooth", 0.06, this.ambientGain!, 220); } }
  bossAlarm() {
    if (!this.ok()) return;
    for (let i = 0; i < 3; i++) this.tone(520, 0.18, "square", 0.16, this.sfxGain!, 392, i * 0.28);
  }
  // NULL corruption glitch — harsh digital burst
  glitch() {
    if (!this.ok()) return;
    this.noise(0.14, 0.18, this.sfxGain!, 1800);
    this.tone(80, 0.12, "sawtooth", 0.16, this.sfxGain!, 220);
    this.tone(1200, 0.06, "square", 0.1, this.sfxGain!, 300, 0.05);
  }
  // NULL "voice" — a cold descending synth phrase
  nullVoice() {
    if (!this.ok()) return;
    [330, 262, 220].forEach((f, i) => this.tone(f, 0.3, "sawtooth", 0.12, this.sfxGain!, f * 0.95, i * 0.18));
  }
  bossDown() {
    if (!this.ok()) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.2, this.sfxGain!, f, i * 0.1));
  }

  private ok() {
    return this.sfxEnabled && this.sfxGain !== null;
  }

  // -- Ambient (city hum + weather) --------------------------------------
  startAmbient(weather: string) {
    this.ensure();
    if (!this.ctx || !this.ambientGain) return;
    this.stopAmbient();
    // low city hum
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 46;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 120;
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    o.connect(f); f.connect(g); g.connect(this.ambientGain);
    o.start();
    this.ambientNodes.push(o, f, g);
    if (weather === "rain" || weather === "storm") {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const nf = this.ctx.createBiquadFilter();
      nf.type = "highpass";
      nf.frequency.value = 2400;
      const ng = this.ctx.createGain();
      ng.gain.value = weather === "storm" ? 0.09 : 0.06;
      src.connect(nf); nf.connect(ng); ng.connect(this.ambientGain);
      src.start();
      this.ambientNodes.push(src, nf, ng);
    }
  }
  stopAmbient() {
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop?.();
        n.disconnect();
      } catch { /* already stopped */ }
    }
    this.ambientNodes = [];
  }

  // -- Soundtrack ---------------------------------------------------------
  setIntensity(i: number) {
    this.intensity = Math.max(0, Math.min(2, i));
  }
  startMusic() {
    this.ensure();
    if (!this.musicEnabled || !this.ctx || this.musicTimer !== null) return;
    const bass = [55, 55, 82.4, 55, 73.4, 55, 65.4, 61.7];
    const arp = [220, 277, 330, 415, 330, 277];
    const stepMs = 205;
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => {
      if (!this.musicEnabled || !this.musicGain || !this.ctx) return;
      const s = this.musicStep;
      const b = bass[s % bass.length];
      this.tone(b, 0.2, "sawtooth", 0.16, this.musicGain, b);
      if (s % 2 === 0) this.tone(b * 2, 0.18, "triangle", 0.07, this.musicGain);
      if (this.intensity >= 1) this.tone(arp[s % arp.length], 0.13, "square", 0.05, this.musicGain);
      if (this.intensity >= 2 && s % 2 === 1) this.tone(arp[(s + 2) % arp.length] * 2, 0.1, "square", 0.03, this.musicGain);
      if (s % 4 === 0) this.noise(0.05, 0.05, this.musicGain, 4000);
      if (s % 8 === 4) this.noise(0.08, 0.09, this.musicGain, 120, 400);
      this.musicStep++;
    }, stepMs);
  }
  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
  setMusic(on: boolean) {
    this.musicEnabled = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }
  setSfx(on: boolean) {
    this.sfxEnabled = on;
  }
  // Volume sliders (0..1) scaled to sensible base gains.
  setMusicVol(v: number) {
    if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v)) * 0.34;
  }
  setSfxVol(v: number) {
    if (this.sfxGain) this.sfxGain.gain.value = Math.max(0, Math.min(1, v)) * 0.75;
  }
}

export const audio = new AudioEngine();
