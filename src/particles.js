import * as THREE from 'three';
import { haloTexture } from './materials.js';

// Particles everywhere once awake: dust motes, petals, lantern sparks.
// Asleep, only a few grey motes drift about.

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const MOTE_ASLEEP = new THREE.Color('#c3cad6');
const DUST_ASLEEP = new THREE.Color('#b9bdc5');
const DUST_AWAKE = new THREE.Color('#e4d5ba');
const FRAG_SPARK = new THREE.Color('#fff1b8');
const CHIRP_SPARK = new THREE.Color('#ffe6b0');

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAlpha > 0.0 ? aSize * projectionMatrix[1][1] * uScale / -mv.z : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

/** A fixed pool of soft round particles; new ones overwrite the oldest. */
class Pool {
  constructor(scene, max, additive) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.peak = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.wobble = new Float32Array(max);
    this.seed = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: haloTexture() }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(p, v, color, { life = 1, size = 0.1, grow = 1, alpha = 1, drag = 0, grav = 0, fadeIn = 0.1, wobble = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    const o = i * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    this.col[o] = color.r; this.col[o + 1] = color.g; this.col[o + 2] = color.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.peak[i] = alpha;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.fadeIn[i] = fadeIn;
    this.wobble[i] = wobble;
    this.seed[i] = Math.random() * 100;
  }

  update(dt, time) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const u = Math.min(1, this.age[i] / this.life[i]);
      const o = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k + this.grav[i] * dt;
      this.vel[o + 2] *= k;
      const w = this.wobble[i];
      const s = this.seed[i];
      this.pos[o] += (this.vel[o] + (w ? Math.sin(time * 1.3 + s) * w : 0)) * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += (this.vel[o + 2] + (w ? Math.cos(time * 1.1 + s * 1.7) * w : 0)) * dt;
      const fin = this.fadeIn[i] > 0 ? Math.min(1, this.age[i] / this.fadeIn[i]) : 1;
      const fout = Math.min(1, (1 - u) / 0.35);
      this.alpha[i] = this.peak[i] * fin * fout;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * u);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

/** Petals tumbling down in woken districts. */
class Petals {
  constructor(scene, count) {
    this.n = count;
    const geo = new THREE.PlaneGeometry(0.16, 0.1);
    geo.translate(0.03, 0, 0);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
      count,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = Array.from({ length: count }, () => new THREE.Vector3());
    this.fall = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.spin = new Float32Array(count);
    this.vis = new Float32Array(count); // 0..1, fades in/out with the wake
    this.alive = new Uint8Array(count);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, WHITE);
    scene.add(this.mesh);
  }

  update(dt, time, player, ctx) {
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (!this.alive[i]) {
        // Try a fresh spot above and around the player; only awake places shed petals.
        _v.set(player.x + (Math.random() - 0.5) * 32, player.y + 3 + Math.random() * 7, player.z + (Math.random() - 0.5) * 32);
        const d = ctx.districtAt(_v.x, _v.z);
        if (d < 0 || ctx.wakeAt(_v.x, _v.z) < 0.6 || Math.random() > 0.08) {
          this.vis[i] = 0;
        } else {
          p.copy(_v);
          this.alive[i] = 1;
          this.vis[i] = 0;
          this.fall[i] = 0.35 + Math.random() * 0.35;
          this.phase[i] = Math.random() * 100;
          this.spin[i] = 1.5 + Math.random() * 2.5;
          const pal = ctx.petalColors(d);
          this.mesh.setColorAt(i, _c.set(pal[(Math.random() * pal.length) | 0]));
          this.mesh.instanceColor.needsUpdate = true;
        }
      } else {
        const ph = this.phase[i] + time;
        p.x += Math.sin(ph * 1.1) * 0.5 * dt + 0.15 * dt;
        p.z += Math.cos(ph * 0.8) * 0.4 * dt;
        p.y -= this.fall[i] * (0.7 + 0.3 * Math.sin(ph * 2.3)) * dt;
        const far = Math.abs(p.x - player.x) > 18 || Math.abs(p.z - player.z) > 18;
        const done = p.y < 0.04 || p.y < player.y - 6 || far;
        const target = done ? 0 : ctx.wakeAt(p.x, p.z);
        this.vis[i] += (target - this.vis[i]) * (1 - Math.exp(-dt * 3));
        if (done && this.vis[i] < 0.05) this.alive[i] = 0;
      }
      const sc = this.vis[i];
      this.e.set(time * this.spin[i] + this.phase[i], this.phase[i], Math.sin(time * 1.7 + this.phase[i]) * 0.9);
      this.q.setFromEuler(this.e);
      this.s.setScalar(sc);
      this.m.compose(p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene) {
    this.glow = new Pool(scene, 1400, true); // motes, sparks
    this.dust = new Pool(scene, 260, false); // footstep and landing puffs
    this.petals = new Petals(scene, 140);
    this.moteAcc = 0;
    this.sparkAcc = new Map();
    this.fragAcc = 0;
  }

  /** Drawing-buffer height / 2, so particle sizes are in metres. */
  setScale(s) {
    this.glow.material.uniforms.uScale.value = s;
    this.dust.material.uniforms.uScale.value = s;
  }

  /**
   * ctx: { player, districtAt(x, z), wakeAt(x, z), hueOf(d), petalColors(d),
   *        lanterns: [{ coreAt, hue, glow, lit }], carried: [Vector3] }
   */
  update(dt, time, ctx) {
    const pl = ctx.player;

    // Dust motes drifting in the light around the player.
    this.moteAcc += dt * 70;
    while (this.moteAcc >= 1) {
      this.moteAcc--;
      _v.set(pl.x + (Math.random() - 0.5) * 28, pl.y - 1 + Math.random() * 9, pl.z + (Math.random() - 0.5) * 28);
      if (_v.y < 0.1) _v.y = 0.1 + Math.random() * 2;
      const d = ctx.districtAt(_v.x, _v.z);
      const awake = d >= 0 ? ctx.wakeAt(_v.x, _v.z) : 0;
      _c.copy(MOTE_ASLEEP);
      if (awake > 0) _c.lerp(_h.copy(WHITE).lerp(ctx.hueOf(d), 0.55), awake);
      const vel = _w.set((Math.random() - 0.5) * 0.15, 0.04 + Math.random() * 0.1, (Math.random() - 0.5) * 0.15);
      this.glow.emit(_v, vel, _c, {
        life: 5 + Math.random() * 4,
        size: 0.05 + awake * 0.05 + Math.random() * 0.03,
        alpha: 0.14 + awake * 0.4,
        fadeIn: 1.5,
        wobble: 0.12,
      });
    }

    // Sparks rising off lanterns: a trickle while filling, a fountain once lit.
    for (const L of ctx.lanterns) {
      if (L.glow < 0.02 || L.coreAt.distanceToSquared(pl) > 70 * 70) continue;
      const rate = L.lit ? 24 : L.glow * 6;
      const acc = (this.sparkAcc.get(L) ?? 0) + dt * rate;
      let n = Math.floor(acc);
      this.sparkAcc.set(L, acc - n);
      while (n-- > 0) {
        _v.copy(L.coreAt);
        _v.x += (Math.random() - 0.5) * 0.5;
        _v.y += (Math.random() - 0.5) * 0.4;
        _v.z += (Math.random() - 0.5) * 0.5;
        const vel = _w.set((Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.5);
        _c.copy(L.hue).lerp(WHITE, Math.random() * 0.5);
        this.glow.emit(_v, vel, _c, {
          life: 1.8 + Math.random() * 1.8,
          size: 0.12 + Math.random() * 0.1,
          grow: 0.3,
          alpha: 0.9,
          drag: 0.5,
          fadeIn: 0.05,
          wobble: 0.35,
        });
      }
    }

    // Carried fragments leave a little glittering wake.
    this.fragAcc += dt * 9 * ctx.carried.length;
    while (this.fragAcc >= 1 && ctx.carried.length) {
      this.fragAcc--;
      const f = ctx.carried[(Math.random() * ctx.carried.length) | 0];
      const vel = _w.set((Math.random() - 0.5) * 0.3, -0.1 - Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
      this.glow.emit(f, vel, FRAG_SPARK, { life: 0.7 + Math.random() * 0.5, size: 0.06, grow: 0.2, alpha: 0.8, fadeIn: 0.02 });
    }

    this.glow.update(dt, time);
    this.dust.update(dt, time);
    this.petals.update(dt, time, pl, ctx);
  }

  /** Soft dust puff at the feet; strength 0..1. */
  puff(pos, strength, awake) {
    const n = Math.round(3 + strength * 14);
    _c.copy(DUST_ASLEEP).lerp(DUST_AWAKE, awake);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (0.5 + Math.random() * 0.8) * (0.6 + strength * 1.6);
      _v.set(pos.x + Math.cos(a) * 0.15, pos.y + 0.04, pos.z + Math.sin(a) * 0.15);
      const vel = _w.set(Math.cos(a) * sp, 0.25 + Math.random() * 0.4, Math.sin(a) * sp);
      this.dust.emit(_v, vel, _c, {
        life: 0.5 + Math.random() * 0.4 + strength * 0.4,
        size: 0.14 + strength * 0.14,
        grow: 2.2,
        alpha: 0.32 + strength * 0.2,
        drag: 4,
        grav: -0.2,
        fadeIn: 0.03,
      });
    }
  }

  /** A ring of sparkles thrown out by a chirp. */
  chirp(pos, power) {
    const n = Math.round(10 + power * 30);
    for (let i = 0; i < n; i++) {
      const vel = _w.randomDirection().multiplyScalar(1.5 + power * 3);
      vel.y = Math.abs(vel.y) * 0.6 + 0.4;
      _c.copy(CHIRP_SPARK).lerp(WHITE, Math.random() * 0.5);
      this.glow.emit(pos, vel, _c, { life: 0.8 + Math.random() * 0.6, size: 0.07, grow: 0.3, alpha: 0.9, drag: 2.5, grav: -0.4, fadeIn: 0.02 });
    }
  }
}
