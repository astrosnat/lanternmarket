// All sound is synthesised: no assets, works offline.
// Everything is in D major pentatonic so chirp-spam always sounds musical.

const ROOT = 62; // D4
const PENTA = [0, 2, 4, 7, 9];
const SCALE = [];
for (let o = -1; o < 3; o++) for (const p of PENTA) SCALE.push(ROOT + o * 12 + p);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const BEAT = 0.5;
// D, Bm, G, A
const CHORDS = [[50, 54, 57], [47, 50, 54], [43, 47, 50], [45, 49, 52]];

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

    this.layers = new Set();
    this.beat = 0;
    this.nextBeat = ctx.currentTime + 0.3;
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

  bell(m, t, gain = 0.08, dur = 1.6) {
    const f = mtof(m);
    this.tone({ freq: f, t, dur, gain });
    this.tone({ freq: f * 2.76, t, dur: dur * 0.4, gain: gain * 0.25 });
    this.tone({ freq: f * 5.4, t, dur: dur * 0.15, gain: gain * 0.1 });
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

  addLayer(id) {
    if (!this.ctx) return;
    this.layers.add(id);
    // The world opens up: the drone brightens a little with each district.
    this.ambFilter.frequency.setTargetAtTime(260 + this.layers.size * 220, this.ctx.currentTime, 2);
  }

  update() {
    if (!this.ctx || this.layers.size === 0) return;
    while (this.nextBeat < this.ctx.currentTime + 0.2) {
      this.scheduleBeat(this.nextBeat, this.beat++);
      this.nextBeat += BEAT;
    }
  }

  scheduleBeat(t, beat) {
    const bar = Math.floor(beat / 8);
    const chord = CHORDS[bar % CHORDS.length];
    // Layer 0 — Piazza: accordion-ish pad + plucked melody.
    if (this.layers.has(0)) {
      if (beat % 8 === 0) this.pad(chord, t, BEAT * 8);
      if (Math.random() < 0.45) {
        this.tone({ freq: mtof(pick(SCALE.slice(5, 14))), type: 'triangle', t, dur: 0.45, gain: 0.04 });
      }
    }
    // Layer 1 — St Paul's: slow bells.
    if (this.layers.has(1) && (beat % 4 === 0 || Math.random() < 0.12)) {
      this.bell(pick(SCALE.slice(10, 17)), t, 0.035, 2.4);
    }
  }

  pad(chord, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.5);
    g.gain.setValueAtTime(0.022, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
    // Bellows tremolo.
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.2;
    const tg = ctx.createGain();
    tg.gain.value = 0.006;
    trem.connect(tg).connect(g.gain);
    f.connect(g).connect(this.bus);
    for (const m of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m + 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
    trem.start(t);
    trem.stop(t + dur + 0.3);
  }
}
