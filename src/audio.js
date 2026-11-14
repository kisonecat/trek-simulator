// Synthesized bridge sounds (no audio files needed) and the computer's voice.

let ctx = null;
let master = null;
let hum = null;
let enabled = true;
let voiceOn = true;
let klaxonTimer = null;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02; // brown-ish noise
    d[i] = last * 3.5;
  }
  return b;
}
function whiteBuffer(seconds = 1) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function tone(type, f0, f1, dur, vol = 0.2, when = 0) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function noise(dur, vol, filterType, f0, f1, when = 0, white = false) {
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = white ? whiteBuffer(dur + 0.1) : noiseBuffer(dur + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.1);
}

const LCARS_TONES = [880, 1046, 1174, 1318, 784, 987];

const SOUNDS = {
  beep() {
    const f = LCARS_TONES[(Math.random() * LCARS_TONES.length) | 0];
    tone('sine', f, f, 0.09, 0.12);
    tone('sine', f * 1.5, f * 1.5, 0.07, 0.06, 0.05);
  },
  deny() {
    tone('square', 220, 200, 0.15, 0.06);
    tone('square', 180, 160, 0.2, 0.06, 0.15);
  },
  warning() {
    tone('sine', 1200, 1200, 0.12, 0.12);
    tone('sine', 900, 900, 0.18, 0.12, 0.14);
  },
  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => tone('sine', f, f, 0.5, 0.1, i * 0.09));
  },
  phaser() {
    const o = tone('sawtooth', 1400, 900, 0.9, 0.08);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 38;
    lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    lfo.start();
    lfo.stop(ctx.currentTime + 1);
    tone('sine', 2200, 1800, 0.9, 0.05);
  },
  torpedo() {
    tone('sine', 900, 120, 0.7, 0.2);
    noise(0.6, 0.25, 'bandpass', 3000, 400);
  },
  explosion() {
    noise(1.2, 0.6, 'lowpass', 1500, 60);
    tone('sine', 90, 30, 0.8, 0.3);
  },
  bigExplosion() {
    noise(2.5, 0.9, 'lowpass', 2500, 40);
    tone('sine', 70, 20, 2, 0.5);
  },
  hit() {
    noise(0.5, 0.5, 'lowpass', 800, 80);
    tone('sine', 120, 50, 0.4, 0.3);
  },
  warp() {
    tone('sine', 60, 600, 1.2, 0.18);
    tone('triangle', 120, 1600, 1.0, 0.08, 0.1);
    noise(1.4, 0.35, 'bandpass', 200, 4000);
    noise(0.8, 0.6, 'lowpass', 600, 50, 1.0);
  },
  warpout() {
    tone('sine', 800, 80, 0.8, 0.15);
    noise(0.7, 0.3, 'bandpass', 3000, 200);
  },
  shieldsUp() {
    tone('sine', 300, 900, 0.5, 0.12);
    tone('sine', 450, 1350, 0.5, 0.06, 0.05);
  },
  shieldsDown() {
    tone('sine', 900, 300, 0.5, 0.1);
  },
  powerUp() {
    tone('sawtooth', 50, 220, 1.5, 0.06);
    tone('sine', 100, 440, 1.5, 0.1);
  },
  powerDown() {
    tone('sawtooth', 220, 40, 1.5, 0.06);
    tone('sine', 440, 80, 1.5, 0.1);
  },
  eject() {
    noise(1.0, 0.5, 'bandpass', 500, 3000, 0, true);
    tone('square', 300, 80, 0.8, 0.08);
  },
  klaxon() {
    tone('sawtooth', 500, 900, 0.7, 0.07);
  },
};

export const audio = {
  unlock() {
    if (enabled) ensure();
  },
  play(name) {
    if (!enabled) return;
    try {
      ensure();
      SOUNDS[name]?.();
    } catch {
      /* audio is optional */
    }
  },
  setEnabled(v) {
    enabled = v;
    if (!v && hum) {
      hum.g.gain.value = 0;
    }
    if (v) ensure();
  },
  get enabled() {
    return enabled;
  },
  setVoice(v) {
    voiceOn = v;
    if (!v) window.speechSynthesis?.cancel();
  },
  get voice() {
    return voiceOn;
  },
  redAlert(on) {
    clearInterval(klaxonTimer);
    klaxonTimer = null;
    if (on) {
      audio.play('klaxon');
      let n = 0;
      klaxonTimer = setInterval(() => {
        audio.play('klaxon');
        if (++n > 4) {
          clearInterval(klaxonTimer);
        }
      }, 1300);
    }
  },
  // engine hum follows reactor output and warp
  updateHum(level, warp) {
    if (!enabled || !ctx) return;
    if (!hum) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(4);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 120;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start();
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 55;
      const og = ctx.createGain();
      og.gain.value = 0;
      o.connect(og).connect(master);
      o.start();
      hum = { f, g, o, og };
    }
    const t = ctx.currentTime;
    hum.g.gain.setTargetAtTime(0.05 + level * 0.07 + warp * 0.1, t, 0.3);
    hum.f.frequency.setTargetAtTime(90 + level * 80 + warp * 250, t, 0.3);
    hum.o.frequency.setTargetAtTime(45 + level * 20 + warp * 30, t, 0.3);
    hum.og.gain.setTargetAtTime(0.015 + level * 0.02, t, 0.3);
  },
};

let lastSpoken = '';
let lastSpokenAt = 0;
let voice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  voice =
    vs.find((v) => /en/i.test(v.lang) && /female|samantha|victoria|zira|google uk english female|karen|moira|serena/i.test(v.name)) ||
    vs.find((v) => /en-US/i.test(v.lang)) ||
    vs.find((v) => /en/i.test(v.lang)) ||
    null;
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

export function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  const now = performance.now();
  if (text === lastSpoken && now - lastSpokenAt < 6000) return;
  lastSpoken = text;
  lastSpokenAt = now;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.pitch = 1.05;
  u.volume = 0.9;
  if (window.speechSynthesis.speaking && window.speechSynthesis.pending) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
