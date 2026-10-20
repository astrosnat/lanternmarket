import * as THREE from 'three';

const DIM = new THREE.Color('#5e5446');
const BRIGHT = new THREE.Color('#ffe39a');
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _c = new THREE.Color();

// A glowing ribbon on a follow-the-leader rope. The lit length of the ribbon
// is the wanderer's stamina, so the HUD can stay empty.
export class Scarf {
  constructor(scene, count = 18) {
    this.n = count;
    this.p = Array.from({ length: count }, () => new THREE.Vector3());
    this.q = Array.from({ length: count }, () => new THREE.Vector3());
    this.flash = 0;

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 2 * 3);
    this.colors = new Float32Array(count * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  reset(anchor) {
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(anchor);
      this.q[i].copy(anchor);
      this.p[i].z -= i * 0.05;
      this.q[i].z -= i * 0.05;
    }
  }

  update(dt, anchor, body, charge, lengthScale, gliding, camPos, time) {
    const seg = 0.075 * lengthScale;
    const g = gliding ? 1.0 : -7.5;
    const dt2 = dt * dt;
    const flutter = gliding ? 0.006 : 0.0015;

    this.p[0].copy(anchor);
    this.q[0].copy(anchor);
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i];
      const q = this.q[i];
      const vx = (p.x - q.x) * 0.95;
      const vy = (p.y - q.y) * 0.95;
      const vz = (p.z - q.z) * 0.95;
      q.copy(p);
      const f = Math.sin(time * 9 + i * 0.7) * flutter * (i / this.n);
      p.x += vx + f;
      p.y += vy + g * dt2 + f;
      p.z += vz - f;
    }
    // Follow-the-leader constraint keeps segment lengths fixed.
    for (let i = 1; i < this.n; i++) {
      const a = this.p[i - 1];
      const b = this.p[i];
      _dir.subVectors(b, a);
      const len = _dir.length() || 1e-5;
      b.copy(a).addScaledVector(_dir, seg / len);
      // Drape over the robe instead of passing through it.
      const by = b.y - body.y;
      if (by > 0 && by < 0.6) {
        const rr = 0.29 * (1 - by / 0.6) + 0.12;
        const dx = b.x - body.x;
        const dz = b.z - body.z;
        const dl = Math.hypot(dx, dz);
        if (dl < rr) {
          if (dl > 1e-4) { b.x = body.x + (dx / dl) * rr; b.z = body.z + (dz / dl) * rr; }
          else b.x += rr;
        }
      }
      if (b.y < 0.03) b.y = 0.03;
    }

    // Camera-facing ribbon; lit portion shows remaining charge.
    this.flash = Math.max(0, this.flash - dt * 1.5);
    const litTo = charge * (this.n - 1);
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (i < this.n - 1) _dir.subVectors(this.p[i + 1], p);
      else _dir.subVectors(p, this.p[i - 1]);
      _toCam.subVectors(camPos, p);
      _side.crossVectors(_dir, _toCam);
      const sl = _side.length();
      if (sl < 1e-6) _side.set(0.05, 0, 0);
      else _side.multiplyScalar((0.038 * (1 - (i / this.n) * 0.45)) / sl);
      const o = i * 6;
      this.positions[o] = p.x + _side.x;
      this.positions[o + 1] = p.y + _side.y;
      this.positions[o + 2] = p.z + _side.z;
      this.positions[o + 3] = p.x - _side.x;
      this.positions[o + 4] = p.y - _side.y;
      this.positions[o + 5] = p.z - _side.z;

      const lit = THREE.MathUtils.clamp(litTo - i + 1, 0, 1);
      _c.copy(DIM).lerp(BRIGHT, lit);
      const shimmer = 0.85 + 0.15 * Math.sin(time * 6 - i * 0.5) + this.flash;
      _c.multiplyScalar(lit > 0 ? shimmer : 1);
      for (let k = 0; k < 2; k++) {
        this.colors[o + k * 3] = _c.r;
        this.colors[o + k * 3 + 1] = _c.g;
        this.colors[o + k * 3 + 2] = _c.b;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
