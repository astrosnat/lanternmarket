import * as THREE from 'three';

// Axis-aligned boxes are the whole collision world: façades, ledges, awnings,
// columns. Every one is climbable unless marked otherwise.
export class Collider {
  constructor(min, max, opts = {}) {
    this.min = min;
    this.max = max;
    this.climbable = opts.climbable ?? true;
    this.blocksCamera = opts.camera ?? true;
    this.enabled = true;
  }
}

const AXES = ['x', 'y', 'z'];

export class Physics {
  constructor() {
    this.colliders = [];
  }

  addBox(cx, y0, cz, w, h, d, opts) {
    const c = new Collider(
      new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
      opts,
    );
    this.colliders.push(c);
    return c;
  }

  /** True if an upright box (half-width r, height h, feet at p) touches nothing. */
  fits(p, r, h) {
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (p.x + r > c.min.x && p.x - r < c.max.x &&
          p.z + r > c.min.z && p.z - r < c.max.z &&
          p.y + h > c.min.y && p.y < c.max.y) return false;
    }
    return true;
  }

  solidAt(x, y, z) {
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (x >= c.min.x && x <= c.max.x && y >= c.min.y && y <= c.max.y && z >= c.min.z && z <= c.max.z) return c;
    }
    return null;
  }

  /** Distance along dir (unit) to the first camera-blocking box, or maxDist. */
  raycast(o, dir, maxDist) {
    let best = maxDist;
    for (const c of this.colliders) {
      if (!c.enabled || !c.blocksCamera) continue;
      let tmin = 0;
      let tmax = best;
      let hit = true;
      for (const a of AXES) {
        if (Math.abs(dir[a]) < 1e-8) {
          if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; }
          continue;
        }
        const inv = 1 / dir[a];
        let t1 = (c.min[a] - o[a]) * inv;
        let t2 = (c.max[a] - o[a]) * inv;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmax < tmin) { hit = false; break; }
      }
      if (hit && tmin > 0 && tmin < best) best = tmin;
    }
    return best;
  }
}
