// All sound is synthesised: no assets, works offline.
// Everything is in D major pentatonic so chirp-spam always sounds musical.

const ROOT = 62; // D4
const PENTA = [0, 2, 4, 7, 9];
const SCALE = [];
for (let o = -1; o < 3; o++) for (const p of PENTA) SCALE.push(ROOT + o * 12 + p);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const STEP = 0.3; // one eighth note at 100 bpm
const BAR = 8;
// D, Bm, G, A — one chord per bar.
const CHORDS = [[50, 54, 57], [47, 50, 54], [43, 47, 50], [45, 49, 52]];

// Piazza accordion tunes, one array per bar: [step, SCALE index, length in steps].
// SCALE index 5 = D4, 8 = A4, 10 = D5, 13 = A5.
const TUNE_A = [
  [[0, 10, 3], [3, 9, 1], [4, 8, 2], [6, 10, 2]],
  [[0, 9, 2], [2, 8, 1], [3, 7, 1], [4, 7, 4]],
  [[0, 6, 2], [2, 7, 1], [3, 9, 1], [4, 11, 2], [6, 10, 2]],
  [[0, 9, 3], [3, 8, 1], [4, 8, 4]],
];
const TUNE_B = [
  [[0, 12, 2], [2, 11, 1], [3, 10, 1], [4, 11, 2], [6, 12, 2]],
  [[0, 13, 2], [2, 12, 2], [4, 10, 4]],
  [[0, 9, 2], [2, 10, 1], [3, 11, 1], [4, 10, 2], [6, 9, 2]],
  [[0, 11, 3], [3, 12, 1], [4, 11, 4]],
];
// 16-bar loop; the accordion sits out the last phrase so the band can breathe.
const FORM = [TUNE_A, TUNE_B, TUNE_A, null];

export class AudioSys {
  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(verb);

    this.layers = new Map(); // district id → gain node
    this.step = 0;
    this.nextStep = 0;
    this.startAmbience();
  }

  suspend() {
    this.ctx?.suspend();
  }

  impulse(sec, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(sec * rate);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this._noise;
  }

  tone({ freq, type = 'sine', t, dur, gain = 0.15, attack = 0.008, dest = this.bus, from }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    if (from) {
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + Math.min(0.05, dur * 0.4));
    } else {
      o.frequency.setValueAtTime(freq, t);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  bell(m, t, gain = 0.08, dur = 1.6, dest = this.bus) {
    const f = mtof(m);
    this.tone({ freq: f, t, dur, gain, dest });
    this.tone({ freq: f * 2.76, t, dur: dur * 0.4, gain: gain * 0.25, dest });
    this.tone({ freq: f * 5.4, t, dur: dur * 0.15, gain: gain * 0.1, dest });
  }

  noise(t, dur, gain, freq, type = 'lowpass') {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ voice

  chirp(hold) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const high = SCALE.filter((m) => m >= ROOT + 12 && m <= ROOT + 24);
    if (hold < 0.22) {
      const f = mtof(pick(high));
      this.tone({ freq: f, from: f * 0.8, type: 'triangle', t, dur: 0.16, gain: 0.16 });
      this.tone({ freq: f * 2, t, dur: 0.08, gain: 0.03 });
      return;
    }
    // Long warble: a few notes tumbling down the scale with vibrato.
    const h = Math.min(hold, 1.2);
    const dur = 0.3 + h * 0.7;
    const count = 3 + Math.round(h * 3);
    let i = SCALE.indexOf(pick(high.slice(-4)));
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const step = dur / count;
    for (let k = 0; k < count; k++) {
      const f = mtof(SCALE[Math.max(0, i)]);
      if (k === 0) o.frequency.setValueAtTime(f, t);
      else o.frequency.setTargetAtTime(f, t + k * step, 0.02);
      i -= 1 + (Math.random() < 0.3 ? 1 : 0);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.03);
    g.gain.setValueAtTime(0.13, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  hiccup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 1300, from: 700, type: 'square', t, dur: 0.07, gain: 0.05 });
  }

  jump() {
    if (!this.ctx) return;
    this.noise(this.ctx.currentTime, 0.12, 0.05, 1800, 'bandpass');
  }

  land(impact) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.1 + impact * 0.15, 0.08 + impact * 0.25, 300 + impact * 500);
    if (impact > 0.6) this.tone({ freq: 90, from: 160, t, dur: 0.18, gain: 0.12 });
  }

  trip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 110, from: 220, t: t + 0.25, dur: 0.18, gain: 0.12 });
    this.tone({ freq: mtof(ROOT + 19), from: mtof(ROOT + 24), type: 'triangle', t: t + 0.9, dur: 0.25, gain: 0.06 });
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bell(ROOT + 24, t, 0.06, 0.8);
    this.bell(ROOT + 28, t + 0.09, 0.06, 0.9);
  }

  deposit(i) {
    if (!this.ctx) return;
    this.bell(SCALE[10 + (i % 8)], this.ctx.currentTime, 0.09, 1.8);
  }

  refill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 2, 4].forEach((k, j) => this.bell(SCALE[12 + k], t + j * 0.06, 0.04, 0.7));
  }

  /** The scarf catching the air by itself: a soft whoosh and a rising chime. */
  unfurl() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.5, 0.04, 900, 'bandpass');
    [0, 2, 4].forEach((k, j) => this.bell(SCALE[13 + k], t + 0.08 + j * 0.09, 0.035, 1.0));
  }

  lanternLit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 10; k++) this.bell(SCALE[5 + k], t + k * 0.13, 0.07, 2.2);
    const o = this.tone({ freq: mtof(ROOT - 24), t, dur: 4, gain: 0.12, attack: 1.2 });
    o.detune.value = -4;
  }

  // ------------------------------------------------------------ ambience & score

  startAmbience() {
    const ctx = this.ctx;
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 260;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    this.ambFilter.connect(this.ambGain).connect(this.master);
    for (const m of [38, 45, 50]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = (Math.random() - 0.5) * 10;
      o.connect(this.ambFilter);
      o.start();
    }
    // Muffled city hum.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /** One instrument layer per woken district; each fades in over a few bars. */
  addLayer(id) {
    if (!this.ctx || this.layers.has(id)) return;
    const now = this.ctx.currentTime;
    if (this.layers.size === 0) {
      // Start the band on a fresh downbeat rather than catching up on missed steps.
      this.step = 0;
      this.nextStep = now + 0.1;
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1, now + 7);
    g.connect(this.bus);
    this.layers.set(id, g);
    // The world opens up: the drone brightens a little with each district.
    this.ambFilter.frequency.setTargetAtTime(260 + this.layers.size * 220, now, 2);
  }

  update() {
    if (!this.ctx || this.layers.size === 0) return;
    const now = this.ctx.currentTime;
    // After a long stall (tab hidden), skip ahead instead of playing a pile-up.
    if (this.nextStep < now - 0.5) this.nextStep = now + 0.05;
    while (this.nextStep < now + 0.2) {
      this.scheduleStep(this.nextStep, this.step++);
      this.nextStep += STEP;
    }
  }

  scheduleStep(t, step) {
    const bar = Math.floor(step / BAR);
    const s = step % BAR;
    const chord = CHORDS[bar % CHORDS.length];

    // Layer 0 — Piazza busker: accordion tune over an oom-pah bass.
    const piazza = this.layers.get(0);
    if (piazza) {
      if (s === 0) this.pluck(chord[0] - 12, t, piazza);
      if (s === 4) this.pluck(chord[0] - 5, t, piazza);
      if (s === 2 || s === 6) {
        for (const m of chord) this.reed(m + 12, t, STEP * 0.7, 0.012, piazza);
      }
      const tune = FORM[Math.floor(bar / 4) % FORM.length];
      if (tune) {
        for (const [at, idx, len] of tune[bar % 4]) {
          if (at === s) this.reed(SCALE[idx], t, len * STEP * 0.95, 0.04, piazza, true);
        }
      }
    }

    // Layer 1 — St Paul's: a slow carillon over a soft choir.
    const church = this.layers.get(1);
    if (church) {
      if (bar % 2 === 0 && s === 0) this.choir(chord, t, STEP * BAR * 2, church);
      const tones = chord.map((m) => m + 24);
      if (s === 0) this.bell(tones[bar % 3], t, 0.04, 2.6, church);
      if (s === 3) this.bell(tones[(bar + 1) % 3], t, 0.025, 2.2, church);
      if (s === 6 && bar % 4 === 3) this.bell(chord[0] + 12, t, 0.05, 3.5, church);
    }
  }

  /** Accordion reed: detuned saw + square through a soft filter, with bellows tremolo. */
  reed(m, t, dur, gain, dest, lead = false) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lead ? 2600 : 1600;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.035);
    g.gain.setValueAtTime(gain, t + Math.max(0.04, dur - 0.07));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    f.connect(g).connect(dest);
    const end = t + dur + 0.1;
    for (const [type, det, lvl] of [['sawtooth', -6, 1], ['square', 6, 0.45]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(f);
      o.start(t);
      o.stop(end);
    }
    if (lead) {
      const trem = ctx.createOscillator();
      trem.frequency.value = 5.5;
      const tg = ctx.createGain();
      tg.gain.value = gain * 0.18;
      trem.connect(tg).connect(g.gain);
      trem.start(t);
      trem.stop(end);
    }
  }

  /** Plucked bass for the oom-pah. */
  pluck(m, t, dest) {
    this.tone({ freq: mtof(m), type: 'triangle', t, dur: 0.38, gain: 0.11, attack: 0.004, dest });
    this.tone({ freq: mtof(m + 12), type: 'sine', t, dur: 0.12, gain: 0.03, attack: 0.002, dest });
  }

  /** Soft "ooh" choir: saws through two vowel formants, slow swell. */
  choir(chord, t, dur, dest) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 1.4);
    g.gain.setValueAtTime(1, t + dur - 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    g.connect(dest);
    const end = t + dur + 0.5;
    for (const [freq, q, lvl] of [[420, 5, 0.09], [820, 7, 0.05]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = lvl;
      bp.connect(bg).connect(g);
      for (const m of chord) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m + 12);
        o.detune.value = (Math.random() - 0.5) * 12;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.2 + Math.random() * 0.8;
        const vg = ctx.createGain();
        vg.gain.value = 5;
        vib.connect(vg).connect(o.detune);
        o.connect(bp);
        o.start(t);
        vib.start(t);
        o.stop(end);
        vib.stop(end);
      }
    }
  }
}
