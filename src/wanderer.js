import * as THREE from 'three';
import { Scarf } from './scarf.js';
import { toonMat } from './materials.js';

// Body
export const R = 0.24; // half-width of the collision box
export const H = 0.62; // knee-high
const STEP = 0.34;
const EPS = 1e-3;

// Ground feel: ~0.4 s to full speed, soft drift on stop.
const RUN = 4.4;
const ACCEL_T = 0.13;
const STOP_T = 0.2;
const AIR_T = 0.4;
const GLIDE_T = 0.55;
const TURN_T = 0.08; // ~0.25 s to settle a turn

// Air feel: floaty arc with low gravity at the peak.
const GRAV = 21;
const JUMP_V = 7.0;
const APEX_BAND = 2.4;
const APEX_MUL = 0.42;
const MAX_FALL = 16;
const GLIDE_FALL = 1.3;
const COYOTE = 0.12;
const BUFFER = 0.14;

// Climbing
const CLIMB_V = 2.2;
const SLIDE_V = 1.5;

// Scarf charge use per second
const SCARF_REFILL = 2.6;
const SCARF_GLIDE = 0.45;
const SCARF_CLIMB_IDLE = 0.22;
const SCARF_CLIMB_MOVE = 0.9;

export const BIG_FALL = 6.5;

// Walking (not running) off a drop deeper than this grabs the edge to climb down.
const EDGE_GRAB_SPEED = RUN * 0.75;
const EDGE_GRAB_DROP = 3;
// The first falls that would cost fragments unfurl the scarf by themselves.
const TEACH_GLIDES = 2;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (dt, tau) => 1 - Math.exp(-dt / tau);
const clamp = THREE.MathUtils.clamp;
const _neck = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Wanderer {
  constructor(scene, physics) {
    this.physics = physics;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.state = 'move'; // move | climb | trip
    this.grounded = false;
    this.groundC = null;
    this.wallC = null;
    this.wallN = new THREE.Vector3();
    this.climbN = new THREE.Vector3();
    this.ceilC = null;
    this.canStep = false;

    this.coyote = 0;
    this.jumpBuf = 0;
    this.climbLock = 0;
    this.airTime = 0;
    this.peakY = 0;
    this.gliding = false;
    this.autoGlide = false;
    this.teachGlides = TEACH_GLIDES;
    this.carrying = 0; // fragments in tow, set by the game
    this.scarfMax = 5;
    this.scarf = 5;
    this.lastLedge = new THREE.Vector3();
    this.visualOffset = new THREE.Vector3();

    // Animation state
    this.runTime = 0;
    this.tripT = 0;
    this.hoodT = 0;
    this.hood = 0;
    this.squash = 1;
    this.squashV = 0;
    this.hem = new THREE.Vector2();
    this.hemV = new THREE.Vector2();
    this.prevLocalV = new THREE.Vector2();
    this.walkPhase = 0;
    this.climbPhase = 0;
    this.climbVy = 0;
    this.chirpCharge = 0;
    this.hicT = 0;
    this.idleT = 0;
    this.lastWish = 0;
    this.blinkT = 3;

    this.hooks = {};
    this.buildModel(scene);
    this.scarfFx = new Scarf(scene);
  }

  spawn(p) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.lastLedge.copy(p);
    this.state = 'move';
    this.peakY = p.y;
    this.model.root.position.copy(p);
    this.model.root.updateMatrixWorld(true);
    this.model.neck.getWorldPosition(_neck);
    this.scarfFx.reset(_neck);
  }

  // ---------------------------------------------------------------- model

  buildModel(scene) {
    const robe = toonMat('#c4523a', { rim: 0.45 });
    const robeLight = toonMat('#dc6f4e', { rim: 0.45 });
    const hoodMat = toonMat('#dc6f4e', { rim: 0.45, side: THREE.DoubleSide });
    const trim = toonMat('#f2d7a6', { rim: 0.3 });
    const gold = toonMat('#ffd36b', { rim: 0.5, emissive: '#5a3a08' });
    const dark = toonMat('#2b2230', { rim: 0.35, rimColor: '#ffd9a8' });
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#fff6dc' });

    const root = new THREE.Group();
    const tumble = new THREE.Group();
    tumble.position.y = 0.3;
    root.add(tumble);
    const body = new THREE.Group();
    body.position.y = -0.3;
    tumble.add(body);

    // No legs: the robe reaches the ground.
    const robePivot = new THREE.Group();
    robePivot.position.y = 0.55;
    body.add(robePivot);
    // Bell-shaped robe: narrow at the neck, flaring out to a lipped hem.
    const robeProfile = [
      [0, -0.53], [0.3, -0.54], [0.335, -0.52], [0.315, -0.47], [0.275, -0.37],
      [0.225, -0.25], [0.175, -0.13], [0.125, -0.03], [0.085, 0.05], [0, 0.07],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    robePivot.add(new THREE.Mesh(new THREE.LatheGeometry(robeProfile, 26), robe));
    const hemTrim = new THREE.Mesh(new THREE.TorusGeometry(0.318, 0.02, 6, 32), trim);
    hemTrim.rotation.x = Math.PI / 2;
    hemTrim.position.y = -0.495;
    robePivot.add(hemTrim);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), dark);
    head.position.y = 0.64;
    body.add(head);

    const eyes = [-1, 1].map((s) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), eyeMat);
      eye.position.set(s * 0.055, 0.645, 0.138);
      body.add(eye);
      return eye;
    });

    // Little clasp where the scarf is tied.
    const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), gold);
    clasp.position.set(0, 0.53, 0.125);
    body.add(clasp);

    const hoodPivot = new THREE.Group();
    hoodPivot.position.y = 0.64;
    body.add(hoodPivot);
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.64),
      hoodMat,
    );
    hoodPivot.add(hood);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 10), robeLight);
    tip.position.set(0, 0.16, -0.1);
    tip.rotation.x = -0.75;
    hood.add(tip);

    const armGeo = new THREE.CapsuleGeometry(0.035, 0.13, 4, 8);
    armGeo.translate(0, -0.09, 0);
    const arms = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.15, 0.5, 0.03);
      pivot.add(new THREE.Mesh(armGeo, robe));
      pivot.visible = false;
      body.add(pivot);
      return pivot;
    });

    const neck = new THREE.Object3D();
    neck.position.set(0, 0.56, -0.16);
    body.add(neck);

    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(root);
    this.model = { root, tumble, body, robePivot, hoodPivot, arms, neck, eyes };
  }

  // ---------------------------------------------------------------- physics

  overlaps(c, p) {
    return p.x + R > c.min.x && p.x - R < c.max.x &&
           p.z + R > c.min.z && p.z - R < c.max.z &&
           p.y + H > c.min.y && p.y < c.max.y;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const p = this.pos;
    p[axis] += d;
    for (const c of this.physics.colliders) {
      if (!c.enabled || !this.overlaps(c, p)) continue;
      if (axis === 'y') {
        if (d < 0) {
          p.y = c.max.y;
          this.grounded = true;
          this.groundC = c;
          if (this.vel.y < 0) this.vel.y = 0;
        } else {
          p.y = c.min.y - H - EPS;
          this.ceilC = c;
          if (this.vel.y > 0) this.vel.y = 0;
        }
        continue;
      }
      const rise = c.max.y - p.y;
      if (this.canStep && rise > 0 && rise <= STEP) {
        _t.set(p.x, c.max.y + EPS, p.z);
        if (this.physics.fits(_t, R, H)) {
          this.visualOffset.y -= _t.y - p.y;
          p.y = _t.y;
          continue;
        }
      }
      p[axis] = d > 0 ? c.min[axis] - R - EPS : c.max[axis] + R + EPS;
      this.wallC = c;
      this.wallN.set(0, 0, 0);
      this.wallN[axis] = d > 0 ? -1 : 1;
      this.vel[axis] = 0;
    }
  }

  /** Is there something solid just in front of the climbing wanderer at height h? */
  probe(h) {
    const n = this.climbN;
    return this.physics.solidAt(this.pos.x - n.x * (R + 0.1), this.pos.y + h, this.pos.z - n.z * (R + 0.1));
  }

  // ---------------------------------------------------------------- update

  update(dt, inp, camYaw) {
    // Camera-relative wish direction.
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    let wx = fx * inp.move.y + rx * inp.move.x;
    let wz = fz * inp.move.y + rz * inp.move.x;
    const wm = Math.min(1, Math.hypot(wx, wz));
    this.lastWish = wm;

    if (inp.jumpPressed) this.jumpBuf = BUFFER;
    else this.jumpBuf -= dt;
    this.climbLock -= dt;
    this.hicT = Math.max(0, this.hicT - dt);

    if (this.state === 'climb') this.updateClimb(dt, wx, wz);
    else this.updateMove(dt, inp, wx, wz, wm);

    if (this.pos.y < -30) this.spawn(this.lastLedge);
  }

  updateMove(dt, inp, wx, wz, wm) {
    const tripping = this.state === 'trip';
    if (tripping) {
      this.tripT += dt;
      wx = wz = wm = 0;
      if (this.tripT > 1.5) this.state = 'move';
    }
    let wasGrounded = this.grounded;

    // Horizontal: ease toward the wish velocity.
    let tau;
    if (wasGrounded) tau = wm > 0.05 ? ACCEL_T : STOP_T;
    else tau = this.gliding ? GLIDE_T : AIR_T;
    if (tripping && this.tripT < 0.5) tau = 0.6;
    const maxV = this.gliding ? RUN * 1.15 : RUN;
    const k = damp(dt, tau);
    this.vel.x += (wx * maxV - this.vel.x) * k;
    this.vel.z += (wz * maxV - this.vel.z) * k;

    // Jump (buffered, with coyote time).
    if (this.jumpBuf > 0 && this.coyote > 0 && !tripping) {
      this.vel.y = JUMP_V;
      this.coyote = 0;
      this.jumpBuf = 0;
      wasGrounded = false;
      this.grounded = false;
      this.airTime = 0;
      this.peakY = this.pos.y;
      this.kick(0.35);
      this.hooks.onJump?.();
    }

    if (wasGrounded) {
      this.vel.y = -1.5;
      this.gliding = false;
    } else {
      let g = GRAV;
      if (Math.abs(this.vel.y) < APEX_BAND) g *= APEX_MUL;
      if (this.vel.y > 0 && !inp.jumpHeld) g *= 1.8;
      this.vel.y = Math.max(-MAX_FALL, this.vel.y - g * dt);
      // Teach gliding: a fall that would cost fragments unfurls the scarf by itself.
      if (!this.autoGlide && this.teachGlides > 0 && this.carrying > 0 && !inp.jumpHeld && !tripping &&
          this.vel.y < -2 && this.scarf > 0.5 && this.peakY - this.physics.floorBelow(this.pos, R) > BIG_FALL) {
        this.autoGlide = true;
        this.teachGlides--;
        this.hooks.onAutoGlide?.();
      }
      this.gliding = (inp.jumpHeld || this.autoGlide) && this.vel.y < 0.4 && this.scarf > 0 && this.airTime > 0.18 && !tripping;
      if (this.gliding && inp.jumpHeld && !this.autoGlide) this.teachGlides = 0; // they've got it
      if (this.gliding) {
        this.vel.y += (-GLIDE_FALL - this.vel.y) * damp(dt, 0.12);
        this.scarf = Math.max(0, this.scarf - SCARF_GLIDE * dt);
        this.peakY = this.pos.y; // gliding down is always a gentle landing
      }
    }

    // Integrate: horizontal first (with step-up), then vertical.
    const prevGround = this.groundC;
    this.wallC = null;
    this.canStep = wasGrounded;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.canStep = false;
    this.grounded = false;
    this.groundC = null;
    this.ceilC = null;
    this.moveAxis('y', this.vel.y * dt);

    if (this.grounded) {
      if (!wasGrounded) this.land();
      this.coyote = COYOTE;
      this.airTime = 0;
      this.gliding = false;
      this.autoGlide = false;
      this.scarf = Math.min(this.scarfMax, this.scarf + SCARF_REFILL * dt);
      if (this.groundC && this.groundC.max.y > 1.5) this.lastLedge.copy(this.pos);

      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > RUN * 0.92) this.runTime += dt;
      else this.runTime = Math.max(0, this.runTime - dt * 2);
      if (this.runTime > 6 && !tripping && Math.random() < dt * 0.5) this.startTrip();
    } else {
      if (wasGrounded) this.peakY = this.pos.y;
      this.coyote -= dt;
      this.airTime += dt;
      this.peakY = Math.max(this.peakY, this.pos.y);
    }

    // Walked (didn't run or jump) off a tall drop: grab the edge and climb down.
    if (wasGrounded && !this.grounded && prevGround && !tripping && wm > 0.1 && this.scarf > 0.15 &&
        Math.hypot(this.vel.x, this.vel.z) < EDGE_GRAB_SPEED && this.grabEdge(prevGround)) return;

    // Auto-grab: walk into any climbable surface.
    if (!tripping && this.wallC && this.wallC.climbable && this.climbLock <= 0 && this.scarf > 0.15 && wm > 0.3) {
      const into = -(wx * this.wallN.x + wz * this.wallN.z) / wm;
      if (into > 0.55 && this.wallC.max.y - this.pos.y > STEP + 0.05) this.startClimb();
    }

    // Turn to face where we're going.
    if (this.state === 'move' || tripping) {
      let target = null;
      if (wm > 0.1) target = Math.atan2(wx, wz);
      else if (Math.hypot(this.vel.x, this.vel.z) > 0.6) target = Math.atan2(this.vel.x, this.vel.z);
      if (target !== null) this.yaw += wrap(target - this.yaw) * damp(dt, TURN_T);
    }
  }

  /** Hang off the side of `c` we just stepped off, on the wall beneath its edge. */
  grabEdge(c) {
    const p = this.pos;
    const ox = Math.max(p.x - R - c.max.x, c.min.x - p.x - R);
    const oz = Math.max(p.z - R - c.max.z, c.min.z - p.z - R);
    const a = ox >= oz ? 'x' : 'z';
    const s = p[a] > (c.min[a] + c.max[a]) / 2 ? 1 : -1;
    const top = c.max.y;
    const edge = s > 0 ? c.max[a] : c.min[a];
    // Measure the drop where you'd come down, past any narrow cornice just below.
    const t = _t.copy(p);
    t[a] = edge + s * 0.8;
    if (top - this.physics.floorBelow(t, 0.1) < EDGE_GRAB_DROP) return false;

    // The wall may be set back under a roof trim or a lamp: feel inward for it.
    t.copy(p);
    let wall = null;
    for (let o = 0.02; o < 0.8 && !wall; o += 0.05) {
      t[a] = edge - s * o;
      wall = this.physics.solidAt(t.x, top - 1.0, t.z);
    }
    if (!wall || !wall.climbable) return false;
    t[a] = (s > 0 ? wall.max[a] : wall.min[a]) + s * (R + EPS);
    // Hang as high as fits (just under any overhang).
    let fits = false;
    for (t.y = top - H - 0.02; t.y > top - H - 1.2 && !fits; ) {
      fits = this.physics.fits(t, R, H);
      if (!fits) t.y -= 0.05;
    }
    if (!fits) return false;

    this.visualOffset.add(p).sub(t);
    p.copy(t);
    this.wallN.set(0, 0, 0);
    this.wallN[a] = s;
    this.startClimb();
    this.peakY = p.y;
    this.hooks.onEdgeGrab?.();
    return true;
  }

  startClimb() {
    this.state = 'climb';
    this.climbN.copy(this.wallN);
    this.vel.set(0, 0, 0);
    this.gliding = false;
    this.autoGlide = false;
    this.grounded = false;
    this.runTime = 0;
    this.hooks.onGrab?.();
  }

  updateClimb(dt, wx, wz) {
    const n = this.climbN;
    const tx = n.z;
    const tz = -n.x; // "right" along the wall while facing it
    // Push toward the wall to go up, away to go down, along it to shuffle sideways.
    const up = -(wx * n.x + wz * n.z);
    const side = wx * tx + wz * tz;
    this.yaw += wrap(Math.atan2(-n.x, -n.z) - this.yaw) * damp(dt, TURN_T);

    if (this.jumpBuf > 0) {
      // Leap away from the wall.
      this.jumpBuf = 0;
      this.state = 'move';
      this.vel.set(n.x * 3.2 + tx * side * 2, 6.2, n.z * 3.2 + tz * side * 2);
      this.climbLock = 0.35;
      this.peakY = this.pos.y;
      this.airTime = 0;
      this.coyote = 0;
      this.yaw = Math.atan2(n.x, n.z);
      this.kick(0.3);
      this.hooks.onJump?.();
      return;
    }

    const im = Math.min(1, Math.hypot(up, side));
    let vy;
    let vl;
    if (this.scarf > 0) {
      vy = up * CLIMB_V;
      vl = side * CLIMB_V * 0.7;
      this.scarf = Math.max(0, this.scarf - dt * (SCARF_CLIMB_IDLE + SCARF_CLIMB_MOVE * im));
      this.climbPhase += dt * im * 8;
    } else {
      vy = -SLIDE_V; // out of scarf: slide down gently, never fall
      vl = 0;
    }
    this.climbVy = vy;
    this.vel.set(0, 0, 0);

    this.moveAxis('x', tx * vl * dt);
    this.moveAxis('z', tz * vl * dt);
    this.grounded = false;
    this.ceilC = null;
    this.moveAxis('y', vy * dt);

    if (this.grounded && vy <= 0) {
      this.state = 'move';
      this.peakY = this.pos.y;
      return;
    }
    // Overhang above (ledge, awning, cornice): pull up onto it.
    if (this.ceilC && vy > 0 && this.tryMantle(this.ceilC)) return;

    const low = this.probe(0.12);
    const high = this.probe(H * 0.85);
    if (!low && !high) {
      this.state = 'move';
      this.climbLock = 0.25;
      this.peakY = this.pos.y;
      return;
    }
    // Cresting the top of a wall.
    if (low && !high && vy > 0) this.tryMantle(low);
  }

  tryMantle(c) {
    const n = this.climbN;
    const t = _t.copy(this.pos);
    t.y = c.max.y + EPS;
    for (const a of ['x', 'z']) {
      if (n[a] > 0) t[a] = c.max[a] - R - 0.06;
      else if (n[a] < 0) t[a] = c.min[a] + R + 0.06;
      else t[a] = clamp(t[a], c.min[a], c.max[a]);
    }
    if (!this.physics.fits(t, R, H)) {
      // Something low sits on the ledge (a lamp cap, a trim): stand on that instead.
      const top = this.physics.topOf(t, R, H);
      if (top - c.max.y > STEP) return false;
      t.y = top + EPS;
      if (!this.physics.fits(t, R, H)) return false;
    }
    this.visualOffset.add(this.pos).sub(t);
    this.pos.copy(t);
    this.state = 'move';
    this.grounded = true;
    this.coyote = COYOTE;
    this.vel.set(0, 0, 0);
    this.peakY = t.y;
    this.kick(0.25);
    this.hooks.onMantle?.();
    return true;
  }

  land() {
    const fall = this.peakY - this.pos.y;
    const impact = clamp(fall / 6, 0, 1);
    this.squashV -= 2 + impact * 9;
    if (fall > 4) this.hoodT = 1.3;
    this.hooks.onLand?.(fall, impact);
  }

  startTrip() {
    this.state = 'trip';
    this.tripT = 0;
    this.runTime = 0;
    this.hooks.onTrip?.();
  }

  hiccup() {
    this.hicT = 0.35;
    this.squashV += 4;
  }

  /** Positive = stretch, negative = squash. */
  kick(amount) {
    this.squashV += amount * 12;
  }

  // ---------------------------------------------------------------- animation

  animate(dt, camPos, time) {
    const m = this.model;
    this.visualOffset.multiplyScalar(Math.exp(-dt / 0.07));
    m.root.position.copy(this.pos).add(this.visualOffset);
    m.root.rotation.y = this.yaw;

    const climbing = this.state === 'climb';
    const tripping = this.state === 'trip';
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const fwdV = this.vel.x * sy + this.vel.z * cy;
    const sideV = -this.vel.x * cy + this.vel.z * sy;
    const accF = (fwdV - this.prevLocalV.x) / Math.max(dt, 1e-3);
    const accS = (sideV - this.prevLocalV.y) / Math.max(dt, 1e-3);
    this.prevLocalV.set(fwdV, sideV);
    const speed = Math.hypot(this.vel.x, this.vel.z);

    // Squash & stretch spring (overshoots and settles).
    this.squashV += (-(this.squash - 1) * 170 - this.squashV * 11) * dt;
    this.squash += this.squashV * dt;
    let s = this.squash;
    if (!this.grounded && !climbing) s *= 1 + clamp(this.vel.y * 0.02, -0.06, 0.1);
    if (this.chirpCharge > 0) s *= 1 - this.chirpCharge * 0.08;
    s = clamp(s, 0.55, 1.5);
    const puff = 1 + this.chirpCharge * 0.1;
    m.body.scale.set(puff / Math.sqrt(s), s, puff / Math.sqrt(s));

    // Robe hem swings a beat behind the body.
    const hx = clamp(accF * 0.012 + fwdV * 0.04, -0.45, 0.45);
    const hz = clamp(accS * 0.012 + sideV * 0.03, -0.35, 0.35);
    this.hemV.x += ((hx - this.hem.x) * 90 - this.hemV.x * 7) * dt;
    this.hemV.y += ((hz - this.hem.y) * 90 - this.hemV.y * 7) * dt;
    this.hem.addScaledVector(this.hemV, dt);
    m.robePivot.rotation.x = this.hem.x;
    m.robePivot.rotation.z = this.hem.y;

    // Body bob.
    let bob = 0;
    if (!climbing && this.grounded && speed > 0.1) {
      this.walkPhase += speed * dt * 5.2;
      bob = Math.abs(Math.sin(this.walkPhase)) * 0.035 * Math.min(1, speed / 2);
    }
    if (this.hicT > 0) bob += Math.sin((this.hicT / 0.35) * Math.PI) * 0.12;
    m.body.position.y = -0.3 + bob;

    // Arms only show while climbing or gliding.
    m.arms[0].visible = m.arms[1].visible = climbing || this.gliding;
    if (climbing) {
      const a = Math.sin(this.climbPhase);
      m.arms[0].rotation.set(-2.6 + a * 0.4, 0, 0.2);
      m.arms[1].rotation.set(-2.6 - a * 0.4, 0, -0.2);
    } else if (this.gliding) {
      const f = Math.sin(time * 10) * 0.08;
      m.arms[0].rotation.set(0, 0, -1.35 + f);
      m.arms[1].rotation.set(0, 0, 1.35 - f);
    }

    // Body tilt: lean into the climb, tip forward in a glide, tumble when tripping.
    let tiltX = 0;
    let tiltZ = 0;
    if (climbing) tiltX = 0.12;
    else if (this.gliding) tiltX = 0.3;
    else tiltX = clamp(fwdV * 0.025, -0.1, 0.12);
    if (tripping) {
      const t = this.tripT;
      if (t < 0.5) tiltX = (t / 0.5) * Math.PI * 2; // roll forward
      else if (t < 0.9) tiltX = 0;
      else tiltZ = Math.sin((t - 0.9) * 28) * 0.18 * (1.5 - t); // shake it off
    }
    m.tumble.rotation.x = tripping && this.tripT < 0.5 ? tiltX : m.tumble.rotation.x + (tiltX - m.tumble.rotation.x) * damp(dt, 0.1);
    m.tumble.rotation.z = tiltZ;

    // Idle: sway gently after standing still a while.
    if (this.grounded && speed < 0.1 && this.lastWish < 0.05 && !tripping) this.idleT += dt;
    else this.idleT = 0;
    if (this.idleT > 4) m.tumble.rotation.z += Math.sin(time * 1.6) * 0.06 * Math.min(1, this.idleT - 4);

    // Hood: flops over the eyes after big landings and trips, then gets pushed back.
    if (this.hoodT > 0) this.hoodT -= dt;
    let hoodTarget = this.hoodT > 0.35 || (tripping && this.tripT > 0.4 && this.tripT < 1.0) ? 1 : 0;
    this.hood += (hoodTarget - this.hood) * damp(dt, hoodTarget ? 0.05 : 0.12);
    m.hoodPivot.rotation.x = -0.6 + this.hood * 0.85 - this.chirpCharge * 0.35;
    if (this.hoodT > 0 && this.hoodT < 0.45) {
      // a quick paw at the hood
      m.arms[1].visible = true;
      m.arms[1].rotation.set(-2.4, 0, -0.5);
    }

    // Blink every few seconds; squeeze shut while charging a big chirp.
    this.blinkT -= dt;
    if (this.blinkT < -0.13) this.blinkT = 2 + Math.random() * 3.5;
    const blink = this.blinkT < 0 ? 0.1 : 1;
    const eyeY = Math.min(blink, 1 - this.chirpCharge * 0.8);
    m.eyes[0].scale.y = m.eyes[1].scale.y = eyeY;

    m.root.updateMatrixWorld(true);
    m.neck.getWorldPosition(_neck);
    this.scarfFx.update(
      Math.min(dt, 1 / 30),
      _neck,
      m.root.position,
      this.scarfMax > 0 ? this.scarf / this.scarfMax : 0,
      this.scarfMax / 5,
      this.gliding,
      camPos,
      time,
    );
  }
}
