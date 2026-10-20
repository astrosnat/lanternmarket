import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldMat } from './materials.js';

// Grey-box Covent Garden. x = east, z = south, y = up (metres).
// The Piazza and Market Building sit at the origin; St Paul's is west.
// Rooflines are exaggerated; the wanderer is knee-high, so everything feels huge.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AWNINGS = ['#e46a5a', '#4f9bd9', '#f0bf4c', '#5fb88a', '#c46ad1'];
const TRIM = '#efe3cf';

export const DISTRICT_BOUNDS = [
  [-27, -45, 48, 45], // 0 Piazza & Market Building
  [-75, -45, -27, 45], // 1 St Paul's Church
];

export function buildWorld(scene, physics) {
  const block = (cx, cz, w, d, y, h, color, opts = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), worldMat(color, opts));
    mesh.position.set(cx, y + h / 2, cz);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (opts.collide !== false) {
      physics.addBox(cx, y, cz, w, h, d, { climbable: opts.climbable ?? true, camera: opts.camera ?? true });
    }
    return mesh;
  };

  // Decorative pieces (windows, arches) merged into one mesh per colour.
  const decor = new Map();
  const addDecor = (color, geo, emissive) => {
    const key = `${color}|${emissive ?? ''}`;
    if (!decor.has(key)) decor.set(key, { color, emissive, geos: [] });
    decor.get(key).geos.push(geo);
  };
  const decorBox = (cx, y0, cz, w, h, d, color, emissive) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, y0 + h / 2, cz);
    addDecor(color, g, emissive);
  };

  // ---------------------------------------------------------- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), worldMat('#b9a68c'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  physics.addBox(0, -2, 0, 400, 2, 400, { climbable: false });

  // Soft rounded cobble tiles across the Piazza.
  {
    const tile = new THREE.BoxGeometry(1.8, 0.05, 1.8);
    const xs = [];
    for (let x = -26; x <= 30; x += 2) for (let z = -28; z <= 28; z += 2) {
      if (Math.abs(x) < 16 && Math.abs(z) < 9) continue; // under the market
      xs.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff'), xs.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#c9b79e', '#bfa98d', '#d3c3a8', '#b7a387', '#cdb18f'];
    xs.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.025, z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(tones[Math.abs(i * 7 + x * 3 + z * 13) % tones.length]));
    });
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // ---------------------------------------------------------- terrace buildings
  // face: which side looks onto the street. Ledges every 3.2 m are rest points.
  const building = ({ x, z, w, d, h, face, color, seed = 0, awnings = 2, chimneys = 2 }) => {
    block(x, z, w, d, 0, h, color);
    block(x, z, w + 0.6, d + 0.6, h, 0.35, TRIM); // roof cap overhang
    const top = h + 0.35;
    const n = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[face];
    const alongX = n[0] === 0;
    const span = alongX ? w : d;
    const faceC = alongX ? z + (n[1] * d) / 2 : x + (n[0] * w) / 2;
    const tangC = alongX ? x : z;
    // World point on the façade: t along it, height y, out = distance from the face.
    const at = (t, y, out) => (alongX ? V(tangC + t, y, faceC + n[1] * out) : V(faceC + n[0] * out, y, tangC + t));
    const onFace = (t, y0, out, sa, sh, so, col, opts) => {
      const p = at(t, y0, out);
      return block(p.x, p.z, alongX ? sa : so, alongX ? so : sa, y0, sh, col, opts);
    };
    const decorFace = (t, y0, out, sa, sh, so, col, emissive) => {
      const p = at(t, y0, out);
      decorBox(p.x, y0, p.z, alongX ? sa : so, sh, alongX ? so : sa, col, emissive);
    };

    // Cornice ledges.
    const ledgeYs = [];
    for (let y = 3.2; y < h - 1.4; y += 3.2) {
      onFace(0, y - 0.25, 0.35, span - 1.2, 0.25, 0.7, TRIM);
      ledgeYs.push(y);
    }
    // Glowing window tiles between ledges.
    const cols = Math.max(2, Math.floor(span / 2.6));
    for (const ly of ledgeYs) {
      if (ly + 2.2 > h) continue;
      for (let i = 0; i < cols; i++) {
        const t = -span / 2 + (span / cols) * (i + 0.5);
        decorFace(t, ly + 0.55, 0.04, 1.0, 1.5, 0.08, '#ffd88a', '#6e4a10');
      }
    }
    // Shopfronts and striped awnings (climb up into them to pull onto the top).
    for (let i = 0; i < awnings; i++) {
      const t = awnings === 1 ? 0 : -span / 4 + (span / 2) * i;
      const col = AWNINGS[(seed + i) % AWNINGS.length];
      decorFace(t, 0, 0.03, 3.2, 2.4, 0.06, '#4d3a2e');
      onFace(t, 2.35, 0.8, 3.4, 0.18, 1.6, col);
    }
    // Hanging sign.
    const sp = at(span / 2 - 1.2, 4.2, 0.55);
    block(sp.x, sp.z, alongX ? 0.12 : 0.9, alongX ? 0.9 : 0.12, 4.3, 0.8, AWNINGS[(seed + 3) % AWNINGS.length]);
    // Drainpipe (visual; the whole wall is climbable anyway).
    decorFace(-span / 2 + 0.5, 0, 0.1, 0.16, h, 0.16, '#555b66');
    // Chimneys.
    for (let i = 0; i < chimneys; i++) {
      const t = (i === 0 ? -0.3 : 0.25) * span;
      const back = alongX ? d : w;
      const p = at(t, top, -back * (0.35 + 0.1 * i));
      block(p.x, p.z, 1.1, 1.1, top, 1.5 + (seed % 3) * 0.4, '#8b5c4a');
    }
    return { top, at };
  };

  // ---------------------------------------------------------- 0: Piazza & Market Building
  const market = () => {
    block(0, 0, 30, 16, 0, 6, '#dcc5a2');
    // Cornice ring at 3.2 m.
    block(0, -8.35, 30, 0.7, 2.95, 0.25, TRIM);
    block(0, 8.35, 30, 0.7, 2.95, 0.25, TRIM);
    block(15.35, 0, 0.7, 17.4, 2.95, 0.25, TRIM);
    block(-15.35, 0, 0.7, 17.4, 2.95, 0.25, TRIM);
    // Arcade arches.
    for (let x = -12; x <= 12; x += 3) {
      for (const s of [-1, 1]) decorBox(x, 0, s * 8.03, 2.0, 2.6, 0.08, '#6b4b35');
    }
    for (let z = -4.5; z <= 4.5; z += 3) {
      for (const s of [-1, 1]) decorBox(s * 15.03, 0, z, 0.08, 2.6, 2.0, '#6b4b35');
    }
    // Upper-floor windows.
    for (let x = -13; x <= 13; x += 2.6) {
      for (const s of [-1, 1]) decorBox(x, 3.7, s * 8.04, 1.1, 1.5, 0.08, '#ffd88a', '#6e4a10');
    }
    // Glass roof, stepped up to the ridge.
    block(0, 0, 26, 10, 6, 2.4, '#a6d5df');
    block(0, 0, 22, 2.6, 8.4, 1.4, '#8cc2cf');
    for (let x = -12; x <= 12; x += 2) decorBox(x, 6, 0, 0.08, 2.42, 10.02, '#e9f4f6');
  };
  market();

  // North terrace (faces the Piazza to the south).
  const N = [
    building({ x: -22, z: -36, w: 14, d: 12, h: 11, face: 's', color: '#c98f6b', seed: 0 }),
    building({ x: -7, z: -36, w: 14, d: 12, h: 14, face: 's', color: '#d8b48a', seed: 1 }),
    building({ x: 8, z: -36, w: 14, d: 12, h: 10, face: 's', color: '#b5715a', seed: 2 }),
    building({ x: 23, z: -36, w: 14, d: 12, h: 13, face: 's', color: '#e0c9a0', seed: 3 }),
  ];
  block(31, -36, 2.2, 12, 0, 12, '#a98a7a');
  // East terrace (towards the Opera House).
  const E = [
    building({ x: 38, z: -22, w: 12, d: 14, h: 12, face: 'w', color: '#cfa77d', seed: 4 }),
    building({ x: 38, z: -7, w: 12, d: 14, h: 15, face: 'w', color: '#b98a6a', seed: 0, awnings: 1 }),
    building({ x: 38, z: 8, w: 12, d: 14, h: 11, face: 'w', color: '#d9b88f', seed: 2 }),
    building({ x: 38, z: 23, w: 12, d: 14, h: 13, face: 'w', color: '#c27d62', seed: 1 }),
  ];
  block(31, 36, 2.2, 12, 0, 11, '#a98a7a');
  // South terrace.
  const S = [
    building({ x: -22, z: 36, w: 14, d: 12, h: 10, face: 'n', color: '#d4a373', seed: 3 }),
    building({ x: -7, z: 36, w: 14, d: 12, h: 12, face: 'n', color: '#bb7f5f', seed: 4 }),
    building({ x: 8, z: 36, w: 14, d: 12, h: 9, face: 'n', color: '#e3c29b', seed: 0 }),
    building({ x: 23, z: 36, w: 14, d: 12, h: 12, face: 'n', color: '#c48e6e', seed: 2 }),
  ];

  // Lamp posts: climb the post, stand on the lamp.
  const lamp = (x, z) => {
    block(x, z, 0.3, 0.3, 0, 4, '#3e4048');
    block(x, z, 0.8, 0.8, 4, 0.5, '#ffe2a0', { emissive: '#7a5a1a' });
    block(x, z, 0.9, 0.9, 4.5, 0.12, '#3e4048');
  };
  [[-20, 18], [20, 18], [-20, -18], [20, -18], [-24, 0], [26, 0]].forEach(([x, z]) => lamp(x, z));

  // Benches and flower planters (flowers only show their colour once awake).
  const planter = (x, z) => {
    block(x, z, 1.4, 1.4, 0, 0.55, '#7a5a40');
    const cols = ['#ff7aa2', '#ffd447', '#b98cff', '#ff9a5a'];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.SphereGeometry(0.22, 10, 8);
      g.translate(x + (i % 2 ? 0.3 : -0.3), 0.75, z + (i < 2 ? 0.3 : -0.3));
      addDecor(cols[(i + Math.abs(x | 0)) % cols.length], g);
    }
  };
  [[-10, 14], [10, 14], [-10, -14], [10, -14], [-24, 12], [26, -12]].forEach(([x, z]) => planter(x, z));
  [[-4, 20], [4, 20], [-4, -20], [4, -20], [22, 8], [-22, -8]].forEach(([x, z]) => block(x, z, 2.2, 0.6, 0, 0.45, '#6d5442'));

  // The flower pot the wanderer pops out of.
  {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 0.7, 20), worldMat('#b8643f'));
    pot.position.set(0, 0.35, 15);
    pot.castShadow = pot.receiveShadow = true;
    scene.add(pot);
    physics.addBox(0, 0, 15, 1.2, 0.7, 1.2, { climbable: false });
  }

  // ---------------------------------------------------------- 1: St Paul's Church
  block(-48, 0, 26, 18, 0, 12, '#e6dccb'); // nave, x -61..-35
  block(-48, 0, 24, 8, 12, 2, '#9a8f86'); // roof ridge, top 14
  block(-54, 0, 3, 3, 14, 3.5, '#efe6d6'); // bell turret, top 17.5
  // Tuscan portico facing the Piazza.
  for (const z of [-6.5, -2.2, 2.2, 6.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 9.5, 18), worldMat('#f1e9da'));
    col.position.set(-31.5, 4.75, z);
    col.castShadow = col.receiveShadow = true;
    scene.add(col);
    physics.addBox(-31.5, 0, z, 1.1, 9.5, 1.1, { camera: false });
  }
  block(-32.9, 0, 4.2, 17, 9.5, 0.9, '#e9dfcf'); // portico roof, top 10.4
  block(-33.2, 0, 3.6, 12, 10.4, 1.2, '#ddd2c0'); // pediment, top 11.6
  for (let z = -6; z <= 6; z += 3) decorBox(-35.06, 2, z, 0.08, 4.5, 1.6, '#5d5560');
  // Churchyard terraces.
  const SP = [
    building({ x: -50, z: -26, w: 30, d: 10, h: 9, face: 's', color: '#c9b79c', seed: 1, awnings: 2, chimneys: 2 }),
    building({ x: -50, z: 26, w: 30, d: 10, h: 10, face: 'n', color: '#bfa58e', seed: 4, awnings: 2, chimneys: 2 }),
  ];
  // Churchyard trees: climb the trunk, pull up onto the canopy.
  const tree = (x, z) => {
    block(x, z, 0.6, 0.6, 0, 3, '#6a4a36');
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 10), worldMat('#7fb069'));
    leaf.position.set(x, 4.3, z);
    leaf.scale.y = 0.8;
    leaf.castShadow = leaf.receiveShadow = true;
    scene.add(leaf);
    physics.addBox(x, 3, z, 2.8, 2.6, 2.8, { camera: false });
  };
  [[-40, -15], [-52, -15], [-64, -12], [-40, 15], [-56, 15], [-66, 8]].forEach(([x, z]) => tree(x, z));
  [[-38, -20], [-60, 20]].forEach(([x, z]) => lamp(x, z));

  // ---------------------------------------------------------- fog walls
  const fogMat = new THREE.MeshBasicMaterial({
    color: '#a2aab8', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const fogWall = (x0, z0, x1, z1) => {
    const w = Math.max(1.2, Math.abs(x1 - x0));
    const d = Math.max(1.2, Math.abs(z1 - z0));
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 40, d), fogMat.clone());
    mesh.position.set(cx, 20, cz);
    mesh.renderOrder = 10;
    scene.add(mesh);
    const collider = physics.addBox(cx, -1, cz, w, 60, d, { climbable: false, camera: false });
    return { mesh, collider, baseOpacity: 0.55 };
  };
  const fogWalls = {
    stpauls: fogWall(-27, -45, -27, 45),
    north: fogWall(-75, -45, 48, -45),
    south: fogWall(-75, 45, 48, 45),
    east: fogWall(48, -45, 48, 45),
    west: fogWall(-75, -45, -75, 45),
  };

  // ---------------------------------------------------------- merge decor
  for (const { color, emissive, geos } of decor.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), worldMat(color, { emissive: emissive ?? 0x000000 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------------------------------------------------------- game data
  const p = (b, t, y, out) => b.at(t, y, out);
  return {
    spawn: V(0, 0.72, 15),
    lanterns: [V(0, 9.8, 0), V(-54, 17.5, 0)],
    fragmentSpots: [
      [
        V(-12, 9.0, 4), // market glass roof, west end
        V(-4, N[1].top + 0.6, -38), // tallest north roof
        p(E[1], 3, 9.6 + 0.5, 0.35), // high cornice on the east terrace
        V(10, S[2].top + 0.6, 38), // south roof
        V(20, 5.0, 18), // on top of a lamp
      ],
      [
        V(-33.2, 12.2, 0), // portico pediment
        V(-58, 14.6, 0), // west end of the church ridge
        V(-62, SP[0].top + 0.6, -27), // churchyard terrace roof
      ],
    ],
    fogWalls,
  };
}
