import * as THREE from 'three';
import { wakeUniforms, toonMat, haloTexture } from './materials.js';
import { DISTRICT_BOUNDS } from './world.js';
import { BIG_FALL } from './wanderer.js';
import { Particles } from './particles.js';

// Core loop: chirp to find → carry fragments → light the lantern → colour floods in.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const damp = (dt, tau) => 1 - Math.exp(-dt / tau);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export const DISTRICTS = [
  {
    name: 'The Piazza & Market Building', hue: '#ffb347', fog: '#f1d1a3', maxRadius: 64, unlocks: 'stpauls',
    petals: ['#ff9fb2', '#ffc56b', '#ffe1e6', '#ff8a5c'],
  },
  {
    name: "St Paul's Church", hue: '#b9a3e3', fog: '#dcd3ea', maxRadius: 46, unlocks: null,
    petals: ['#c7b3ef', '#a9c9a0', '#f3eefc'],
  },
];

const ASLEEP_FOG = new THREE.Color('#8d96a6');
const ASLEEP_SUN = new THREE.Color('#c9d4e6');
const AWAKE_SUN = new THREE.Color('#ffe6c0');
const WAVE_TIME = 5;
const CHIRP_MAX_HOLD = 1.2;
const RIPPLE_SPEED = 18;

// ------------------------------------------------------------------ lantern

class Lantern {
  constructor(scene, physics, pos, hue) {
    this.pos = pos.clone();
    this.coreAt = V(pos.x, pos.y + 0.85, pos.z);
    this.hue = new THREE.Color(hue);
    this.fill = 0;
    this.lit = false;
    this.glow = 0;
    const metal = toonMat('#34303a');
    const g = (this.group = new THREE.Group());
    g.position.copy(pos);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), metal);
    base.position.y = 0.15;
    g.add(base);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), metal);
      post.position.set(x, 0.85, z);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.55, 4), metal);
    roof.position.y = 1.7;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), metal);
    fin.position.y = 2.02;
    g.add(fin);
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#5d6270', toneMapped: false });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 12), this.coreMat);
    this.core.position.y = 0.85;
    g.add(this.core);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: this.hue, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.halo.position.y = 0.85;
    this.halo.scale.setScalar(3);
    g.add(this.halo);
    this.light = new THREE.PointLight(this.hue, 0, 30, 1.4);
    this.light.position.y = 0.9;
    g.add(this.light);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    physics.addBox(pos.x, pos.y, pos.z, 1, 1.9, 1);
  }

  get corePos() {
    return this.coreAt.clone();
  }

  update(dt, t, needed) {
    const target = this.lit ? 1 : (this.fill / needed) * 0.6;
    this.glow += (target - this.glow) * damp(dt, 0.6);
    const flicker = this.lit ? 0.92 + 0.08 * Math.sin(t * 11) * Math.sin(t * 3.7) : 1;
    this.coreMat.color.set('#5d6270').lerp(this.hue, this.glow).multiplyScalar(1 + this.glow * 0.6 * flicker);
    this.halo.material.opacity = this.glow * 0.9 * flicker;
    this.halo.scale.setScalar(2.4 + this.glow * 2.5);
    this.light.intensity = this.glow * 40 * flicker;
  }
}

// ------------------------------------------------------------------ fragments

const FRAG_SLEEP = new THREE.Color('#8c93a0');
const FRAG_AWAKE = new THREE.Color('#fff1b8');

class Fragment {
  constructor(scene, pos, district) {
    this.home = pos.clone();
    this.pos = pos.clone();
    this.district = district;
    this.state = 'sleep'; // sleep | waking | awake | carried | returning | depositing | deposited
    this.t = Math.random() * 10;
    this.timer = 0;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.mat = new THREE.MeshBasicMaterial({ color: FRAG_SLEEP.clone(), toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), this.mat);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: '#fff2c2', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.halo);
    this.group.position.copy(pos);
    scene.add(this.group);
  }

  flyTo(target, state, duration, delay = 0) {
    this.from.copy(this.pos);
    this.to.copy(target);
    this.state = state;
    this.timer = -delay;
    this.duration = duration;
  }

  update(dt, ctx) {
    this.t += dt;
    const awakeLook = this.state !== 'sleep' && this.state !== 'waking';
    this.mat.color.lerp(awakeLook ? FRAG_AWAKE : FRAG_SLEEP, damp(dt, 0.3));
    this.mesh.rotation.y += dt * (awakeLook ? 2.4 : 0.6);
    this.mesh.rotation.x = Math.sin(this.t * 0.8) * 0.4;
    let haloTarget = awakeLook ? 0.85 : 0.08 + 0.07 * Math.max(0, Math.sin(this.t * 2.3));
    let haloScale = awakeLook ? 1.5 : 0.9;

    switch (this.state) {
      case 'waking':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'awake';
          ctx.onWake(this);
        }
        break;
      case 'awake':
        this.pos.copy(this.home).y += Math.sin(this.t * 2) * 0.12;
        if (this.pos.distanceTo(ctx.player) < 0.8) {
          this.state = 'carried';
          this.timer = 0;
          ctx.onPickup(this);
        }
        break;
      case 'carried': {
        this.timer += dt;
        const target = ctx.carryTarget(this, this.timer);
        this.pos.lerp(target, damp(dt, this.timer < 0.9 ? 0.05 : 0.14));
        break;
      }
      case 'returning':
      case 'depositing': {
        this.timer += dt;
        if (this.timer < 0) break;
        const u = Math.min(1, this.timer / this.duration);
        const e = easeOut(u);
        this.pos.lerpVectors(this.from, this.to, e);
        this.pos.y += Math.sin(u * Math.PI) * (this.state === 'returning' ? 2.5 : 1.5);
        if (u >= 1) {
          if (this.state === 'returning') {
            this.home.copy(this.to);
            this.state = 'awake';
          } else {
            this.state = 'deposited';
            this.group.visible = false;
            ctx.onDeposited(this);
          }
        }
        break;
      }
      default:
        break;
    }
    this.halo.material.opacity += (haloTarget - this.halo.material.opacity) * damp(dt, 0.2);
    this.halo.scale.setScalar(haloScale);
    this.group.position.copy(this.pos);
  }
}

// ------------------------------------------------------------------ effects

class Ripple {
  constructor(scene, pos, radius) {
    this.scene = scene;
    this.radius = radius;
    this.t = 0;
    this.life = Math.max(0.6, radius / RIPPLE_SPEED);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#fff1cf', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshBasicMaterial({ color: '#ffe6b0', transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.ring.position.copy(pos);
    this.shell.position.copy(pos);
    scene.add(this.ring, this.shell);
  }

  update(dt) {
    this.t += dt;
    const u = Math.min(1, this.t / this.life);
    const r = 0.3 + easeOut(u) * this.radius;
    this.ring.scale.setScalar(r);
    this.shell.scale.setScalar(r);
    this.ring.material.opacity = 0.9 * (1 - u);
    this.shell.material.opacity = 0.12 * (1 - u);
    if (u >= 1) {
      this.scene.remove(this.ring, this.shell);
      this.ring.geometry.dispose();
      this.shell.geometry.dispose();
      return false;
    }
    return true;
  }
}

class Burst {
  constructor(scene, pos, color, count = 160, speed = 5) {
    this.scene = scene;
    this.t = 0;
    this.life = 2.6;
    this.vel = new Float32Array(count * 3);
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = pos.x;
      p[i * 3 + 1] = pos.y;
      p[i * 3 + 2] = pos.z;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      v.y = Math.abs(v.y) * 0.8 + 1;
      this.vel.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: 0.22, map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt) {
    this.t += dt;
    const pos = this.points.geometry.attributes.position;
    const a = pos.array;
    const drag = Math.exp(-dt * 1.4);
    for (let i = 0; i < a.length; i += 3) {
      this.vel[i] *= drag;
      this.vel[i + 1] = this.vel[i + 1] * drag - 0.6 * dt;
      this.vel[i + 2] *= drag;
      a[i] += this.vel[i] * dt;
      a[i + 1] += this.vel[i + 1] * dt;
      a[i + 2] += this.vel[i + 2] * dt;
    }
    pos.needsUpdate = true;
    this.points.material.opacity = 1 - this.t / this.life;
    if (this.t >= this.life) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      return false;
    }
    return true;
  }
}

// ------------------------------------------------------------------ game

export class Game {
  constructor({ scene, physics, world, wanderer, audio, sun, hemi }) {
    this.scene = scene;
    this.world = world;
    this.w = wanderer;
    this.audio = audio;
    this.sun = sun;
    this.hemi = hemi;
    this.time = 0;

    this.districts = DISTRICTS.map((d, i) => ({
      ...d,
      id: i,
      hueColor: new THREE.Color(d.hue),
      fogColor: new THREE.Color(d.fog),
      lit: false,
      fill: 0,
      waveT: -1,
      needed: world.fragmentSpots[i].length,
      lantern: new Lantern(scene, physics, world.lanterns[i], d.hue),
    }));
    this.districts.forEach((d, i) => {
      wakeUniforms.uWakeCenter.value[i].copy(d.lantern.pos);
      const [x0, z0, x1, z1] = DISTRICT_BOUNDS[i];
      wakeUniforms.uWakeBox.value[i].set(x0, z0, x1, z1);
    });

    this.fragments = world.fragmentSpots.flatMap((spots, d) => spots.map((p) => new Fragment(scene, p, d)));
    this.ripples = [];
    this.bursts = [];
    this.trail = [];
    this.chirping = false;
    this.chirpT = 0;
    this.chirpTimes = [];
    this.chirpBlock = 0;
    this.player = new THREE.Vector3();

    this.chirpLight = new THREE.PointLight('#ffe7b0', 0, 12, 1.5);
    scene.add(this.chirpLight);

    this.fogColor = ASLEEP_FOG.clone();

    this.particles = new Particles(scene);
    this.lastStep = 0;
    this.fxCtx = {
      player: this.player,
      districtAt: (x, z) => this.districtAt(x, z),
      wakeAt: (x, z) => this.wakeAt(x, z),
      hueOf: (d) => this.districts[d].hueColor,
      petalColors: (d) => this.districts[d].petals,
      lanterns: this.districts.map((d) => d.lantern),
      carried: [],
    };

    this.fragCtx = {
      player: this.player,
      carryTarget: (f, t) => this.carryTarget(f, t),
      onWake: () => {},
      onPickup: (f) => {
        this.audio.pickup();
        this.w.scarfFx.flash = 0.6;
      },
      onDeposited: (f) => this.onDeposited(f),
    };

    wanderer.hooks = {
      onJump: () => audio.jump(),
      onLand: (fall, impact) => {
        audio.land(impact);
        this.particles.puff(wanderer.pos, impact, this.wakeAt(wanderer.pos.x, wanderer.pos.z));
        if (fall > BIG_FALL) this.dropFragments();
      },
      onTrip: () => {
        audio.trip();
        this.particles.puff(wanderer.pos, 0.5, this.wakeAt(wanderer.pos.x, wanderer.pos.z));
      },
      onMantle: () => {},
      onGrab: () => {},
    };
  }

  get carried() {
    return this.fragments.filter((f) => f.state === 'carried');
  }

  carryTarget(f, t) {
    const list = this.carried;
    const i = list.indexOf(f);
    if (t < 0.9) {
      // Orbit first…
      const a = this.time * 6 + (i / Math.max(1, list.length)) * Math.PI * 2;
      return V(this.w.pos.x + Math.cos(a) * 0.55, this.w.pos.y + 0.6, this.w.pos.z + Math.sin(a) * 0.55);
    }
    // …then trail behind like ducklings.
    const idx = Math.min(this.trail.length - 1, 2 + i * 3);
    const p = idx >= 0 ? this.trail[idx] : this.w.pos;
    return V(p.x, p.y + 0.5 + Math.sin(this.time * 3 + i) * 0.06, p.z);
  }

  districtAt(x, z) {
    return DISTRICT_BOUNDS.findIndex(([x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);
  }

  /** How woken (0..1) the ground at x, z is; matches the wake shader. */
  wakeAt(x, z) {
    const i = this.districtAt(x, z);
    if (i < 0) return 0;
    const r = wakeUniforms.uWakeRadius.value[i];
    if (r <= 0) return 0;
    const L = this.districts[i].lantern.pos;
    return 1 - THREE.MathUtils.smoothstep(Math.hypot(x - L.x, z - L.z), r - 8, r);
  }

  update(dt, inp) {
    this.time += dt;
    const w = this.w;
    this.player.copy(w.pos).y += 0.35;

    // Chirp: tap for a peep, hold for a bigger warble.
    this.chirpBlock -= dt;
    if (inp.chirpPressed && this.chirpBlock <= 0 && w.state !== 'trip') {
      this.chirping = true;
      this.chirpT = 0;
    }
    if (this.chirping) {
      this.chirpT += dt;
      w.chirpCharge = Math.min(1, this.chirpT / CHIRP_MAX_HOLD);
      if (!inp.chirpHeld) {
        this.chirping = false;
        w.chirpCharge = 0;
        this.chirp(this.chirpT);
      }
    }
    this.chirpLight.intensity *= Math.exp(-dt * 5);

    // Breadcrumb trail for carried fragments.
    if (!this.trail.length || this.trail[0].distanceToSquared(w.pos) > 0.06) {
      this.trail.unshift(w.pos.clone());
      if (this.trail.length > 40) this.trail.pop();
    }

    for (const f of this.fragments) f.update(dt, this.fragCtx);
    for (const d of this.districts) d.lantern.update(dt, this.time, d.needed);
    this.ripples = this.ripples.filter((r) => r.update(dt));
    this.bursts = this.bursts.filter((b) => b.update(dt));

    // Little dust puffs from running feet.
    const step = Math.floor(w.walkPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      const speed = Math.hypot(w.vel.x, w.vel.z);
      if (w.grounded && w.state === 'move' && speed > 2.5) {
        this.particles.puff(w.pos, 0.05 + 0.1 * Math.min(1, (speed - 2.5) / 2), this.wakeAt(w.pos.x, w.pos.z));
      }
    }
    this.fxCtx.carried.length = 0;
    for (const f of this.fragments) if (f.state === 'carried') this.fxCtx.carried.push(f.pos);
    this.particles.update(dt, this.time, this.fxCtx);

    // Colour waves.
    for (const d of this.districts) {
      if (d.waveT < 0) continue;
      d.waveT += dt;
      const u = Math.min(1, d.waveT / WAVE_TIME);
      wakeUniforms.uWakeRadius.value[d.id] = easeOut(u) * (d.maxRadius + 10) + 0.01;
      const edge = u < 1 ? 1 : Math.max(0, 1 - (d.waveT - WAVE_TIME));
      wakeUniforms.uWakeHue.value[d.id].copy(d.hueColor).multiplyScalar(edge);
    }

    // Fog walls thin as fragments return, then dissolve.
    for (const d of this.districts) {
      if (!d.unlocks) continue;
      const wall = this.world.fogWalls[d.unlocks];
      const target = d.lit ? 0 : wall.baseOpacity * (1 - 0.5 * (d.fill / d.needed));
      const m = wall.mesh.material;
      m.opacity += (target - m.opacity) * damp(dt, d.lit ? 1.2 : 0.8);
      if (d.lit && m.opacity < 0.02) {
        wall.mesh.visible = false;
        wall.collider.enabled = false;
      }
    }
    for (const wall of Object.values(this.world.fogWalls)) {
      wall.mesh.material.color.copy(this.fogColor).lerp(ASLEEP_FOG, 0.4);
    }

    // Atmosphere follows the district you're standing in.
    const di = this.districtAt(w.pos.x, w.pos.z);
    const here = di >= 0 ? this.districts[di] : null;
    const awake = here && here.lit ? Math.min(1, here.waveT / WAVE_TIME) : 0;
    const fogTarget = ASLEEP_FOG.clone().lerp(here ? here.fogColor : ASLEEP_FOG, awake);
    this.fogColor.lerp(fogTarget, damp(dt, 1.2));
    this.scene.fog.color.copy(this.fogColor);
    this.scene.background.copy(this.fogColor);
    this.scene.fog.near += ((awake ? 45 : 22) - this.scene.fog.near) * damp(dt, 1.5);
    this.scene.fog.far += ((awake ? 190 : 110) - this.scene.fog.far) * damp(dt, 1.5);
    this.sun.color.copy(ASLEEP_SUN).lerp(AWAKE_SUN, awake);
    this.sun.intensity += ((awake ? 2.1 : 1.3) - this.sun.intensity) * damp(dt, 1.5);
    this.hemi.intensity += ((awake ? 1.3 : 1.0) - this.hemi.intensity) * damp(dt, 1.5);

    this.audio.update();
  }

  chirp(hold) {
    const w = this.w;
    const now = this.time;
    this.chirpTimes = this.chirpTimes.filter((t) => now - t < 2.5);
    this.chirpTimes.push(now);
    if (this.chirpTimes.length >= 6) {
      // Too many chirps in a row: hic!
      this.chirpTimes = [];
      this.chirpBlock = 0.9;
      w.hiccup();
      this.audio.hiccup();
      return;
    }

    const h = Math.min(hold, CHIRP_MAX_HOLD);
    const radius = 4 + (h / CHIRP_MAX_HOLD) * 11;
    this.audio.chirp(h);
    w.kick(0.3 + h * 0.3);
    w.scarfFx.flash = 0.4;
    const origin = V(w.pos.x, w.pos.y + 0.35, w.pos.z);
    this.ripples.push(new Ripple(this.scene, origin, radius));
    this.particles.chirp(origin, h / CHIRP_MAX_HOLD);
    this.chirpLight.position.copy(origin);
    this.chirpLight.intensity = 6 + h * 10;

    // Wake sleeping fragments the ripple touches.
    for (const f of this.fragments) {
      if (f.state !== 'sleep') continue;
      const d = f.pos.distanceTo(origin);
      if (d < radius) {
        f.state = 'waking';
        f.timer = d / RIPPLE_SPEED;
      }
    }

    // Lanterns: hand over fragments, or refill the scarf at a lit one.
    for (const d of this.districts) {
      const L = d.lantern;
      const dx = L.pos.x - w.pos.x;
      const dz = L.pos.z - w.pos.z;
      if (Math.hypot(dx, dz) > 4.5 || Math.abs(L.pos.y - w.pos.y) > 3) continue;
      if (d.lit) {
        w.scarf = w.scarfMax;
        w.scarfFx.flash = 1;
        this.audio.refill();
        continue;
      }
      const carried = this.carried.filter((f) => f.district === d.id);
      carried.forEach((f, i) => f.flyTo(L.corePos, 'depositing', 0.9, i * 0.25));
    }
  }

  onDeposited(f) {
    const d = this.districts[f.district];
    d.fill++;
    this.audio.deposit(d.fill);
    this.bursts.push(new Burst(this.scene, d.lantern.corePos, d.hue, 40, 2));
    if (d.fill >= d.needed && !d.lit) this.lightDistrict(d);
  }

  lightDistrict(d) {
    d.lit = true;
    d.waveT = 0;
    d.lantern.lit = true;
    this.audio.lanternLit();
    this.audio.addLayer(d.id);
    this.bursts.push(new Burst(this.scene, d.lantern.corePos, d.hue, 260, 7));
    // The world opens upward: a longer scarf for longer climbs and glides.
    this.w.scarfMax += 2;
    this.w.scarf = this.w.scarfMax;
    this.w.scarfFx.flash = 1;
  }

  dropFragments() {
    const list = this.carried;
    if (!list.length) return;
    const base = this.w.lastLedge;
    list.forEach((f, i) => {
      const a = (i / list.length) * Math.PI * 2;
      f.flyTo(V(base.x + Math.cos(a) * 0.5, base.y + 0.5, base.z + Math.sin(a) * 0.5), 'returning', 1.6, i * 0.1);
    });
  }
}
