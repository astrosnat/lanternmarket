import * as THREE from 'three';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (dt, tau) => 1 - Math.exp(-dt / tau);
const _dir = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

// Third-person follow. The focus point rides an under-damped spring (~0.3 s lag,
// slight overshoot on sharp moves); orbit angles stay direct so looking is crisp.
export class FollowCamera {
  constructor(camera, physics) {
    this.cam = camera;
    this.physics = physics;
    this.yaw = 0;
    this.pitch = 0.3;
    this.dist = 4.2;
    this.curDist = 4.2;
    this.focus = new THREE.Vector3();
    this.focusVel = new THREE.Vector3();
    this.lookUp = 0;
    this.idleLook = 0;
    this.sensitivity = 1;
  }

  snap(w) {
    this.focus.copy(w.pos).y += 0.85;
    this.focusVel.set(0, 0, 0);
  }

  update(dt, inp, w) {
    const sens = this.sensitivity;
    const lx = inp.mouseDX * 0.0024 * sens + inp.padLook.x * 2.6 * dt * sens;
    const ly = inp.mouseDY * 0.0024 * sens + inp.padLook.y * 1.8 * dt * sens;
    this.yaw -= lx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + ly, -0.35, 1.25);
    if (Math.abs(lx) + Math.abs(ly) > 1e-4) this.idleLook = 0;
    else this.idleLook += dt;

    const climbing = w.state === 'climb';
    const speed = Math.hypot(w.vel.x, w.vel.z);

    // Gently swing behind the wanderer when the player isn't steering the camera.
    if (this.idleLook > 1.2 && !climbing && speed > 1) {
      const behind = w.yaw + Math.PI;
      this.yaw += wrap(behind - this.yaw) * damp(dt, 2.2) * Math.min(1, speed / 4);
    }

    // Framing: pull back and look up for climbs, widen a little for glides.
    let targetDist = this.dist;
    let up = 0.85;
    let lookUp = 0;
    if (climbing) {
      targetDist = this.dist * 1.45;
      up = 1.2;
      lookUp = 1.6;
      if (this.idleLook > 0.6) this.pitch += (0.05 - this.pitch) * damp(dt, 1.2);
    } else if (w.gliding) {
      targetDist = this.dist * 1.25;
    }
    this.curDist += (targetDist - this.curDist) * damp(dt, 0.5);
    this.lookUp += (lookUp - this.lookUp) * damp(dt, 0.4);

    // Spring-damped focus.
    const wn = 6.5;
    const zeta = 0.72;
    _desired.copy(w.pos).y += up;
    const ax = (_desired.x - this.focus.x) * wn * wn - this.focusVel.x * 2 * zeta * wn;
    const ay = (_desired.y - this.focus.y) * wn * wn - this.focusVel.y * 2 * zeta * wn;
    const az = (_desired.z - this.focus.z) * wn * wn - this.focusVel.z * 2 * zeta * wn;
    this.focusVel.x += ax * dt;
    this.focusVel.y += ay * dt;
    this.focusVel.z += az * dt;
    this.focus.addScaledVector(this.focusVel, dt);

    // Orbit, then pull in if a building is in the way.
    _dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = this.physics.raycast(this.focus, _dir, this.curDist + 0.3);
    const d = Math.max(0.5, Math.min(this.curDist, hit - 0.3));
    this.cam.position.copy(this.focus).addScaledVector(_dir, d);
    if (this.cam.position.y < 0.25) this.cam.position.y = 0.25;
    _look.copy(this.focus).y += this.lookUp;
    this.cam.lookAt(_look);
  }
}
