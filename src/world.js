import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldMat, toonMat } from './materials.js';

// Grey-box Covent Garden. x = east, z = south, y = up (metres).
// The Piazza and Market Building sit at the origin; St Paul's is west.
// Rooflines are exaggerated; the wanderer is knee-high, so everything feels huge.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AWNINGS = ['#e46a5a', '#4f9bd9', '#f0bf4c', '#5fb88a', '#c46ad1'];
const TRIM = '#efe3cf';
const WINDOW_BOXES = ['#e94f8a', '#4fb3e8', '#7cc243', '#f08a3c', '#f4c430'];
const FLOWERS = ['#ff5fa2', '#ffe04f', '#ff8a3d', '#b56cff', '#ffffff', '#ff4f6d'];
const SHUTTERS = ['#2f6f5e', '#1f5f6b', '#9c4a2f', '#2d3f63', '#3f7f4a'];

export const DISTRICT_BOUNDS = [
  [-27, -45, 48, 45], // 0 Piazza & Market Building
  [-75, -45, -27, 45], // 1 St Paul's Church
  [48, -45, 118, 45], // 2 Royal Opera House
  [48, -105, 118, -45], // 3 Neal's Yard
  [-27, -105, 48, -45], // 4 Seven Dials
  [118, -105, 178, 45], // 5 Drury Lane theatres
];

// opts.seed: which random fragments Seven Dials uses (new each game by default).
// opts.sdAllCandidates / dlAllCandidates: place a fragment on every candidate spot in
// Seven Dials / Drury Lane (for the playtest bot's reachability check).
export function buildWorld(scene, physics, opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  let rngState = seed || 1;
  const rng = () => {
    rngState = (rngState * 16807) % 2147483647;
    return (rngState - 1) / 2147483646;
  };
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

  // Decorative pieces (windows, arches) merged into one mesh per colour and surface.
  const decor = new Map();
  const addDecor = (color, geo, emissive, surface = 'none') => {
    const key = `${color}|${emissive ?? ''}|${surface}`;
    if (!decor.has(key)) decor.set(key, { color, emissive, surface, geos: [] });
    decor.get(key).geos.push(geo);
  };
  const decorBox = (cx, y0, cz, w, h, d, color, emissive, surface) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, y0 + h / 2, cz);
    if (surface === 'glass') {
      // One random number per pane, so each window's glints get their own offset.
      const id = Math.random();
      g.setAttribute('lmId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
    }
    addDecor(color, g, emissive, surface);
  };

  // ---------------------------------------------------------- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), worldMat('#b9a68c', { surface: 'plaster' }));
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
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff', { surface: 'plaster' }), xs.length);
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

  // A row of little round flowers along a window box (decor only, merged per colour).
  // at(t, y, out) maps façade coordinates to the world, as in building().
  const flowerRow = (at, t, y, out, width, k) => {
    for (let i = 0; i < 4; i++) {
      const p = at(t - width / 2 + (width / 4) * (i + 0.5), y + 0.08, out);
      const g = new THREE.SphereGeometry(0.13, 7, 5);
      g.translate(p.x, p.y, p.z);
      addDecor(FLOWERS[(k + i * 2) % FLOWERS.length], g);
    }
  };

  // ---------------------------------------------------------- terrace buildings
  // face: which side looks onto the street. Ledges every 3.2 m are rest points.
  // back: optionally dress the rear too (plainer: windows, ledges, pipe, back door),
  //       for buildings whose backs are on show.
  // base: build on top of something (e.g. a fly tower on a roof).
  // boxes: painted window boxes full of flowers under every window (Neal's Yard).
  // shutters: open shutters and a climbable sill at every window (Seven Dials);
  //   ledges: false drops the continuous cornices, so the sills are the rest points.
  // sides: dress the two side walls too (for buildings with streets down their sides).
  const building = ({
    x, z, w, d, h, face, back, color, seed = 0, awnings = 2, chimneys = 2, base = 0, surface = 'brick', sign = true,
    boxes = false, shutters = false, ledges = true, sides = false, roof = 'plaster',
  }) => {
    const sills = [];
    block(x, z, w, d, base, h, color, { surface });
    block(x, z, w + 0.6, d + 0.6, base + h, 0.35, TRIM, { surface: roof }); // roof cap overhang
    const top = base + h + 0.35;

    // Helpers for one side of the building.
    const side = (f) => {
      const n = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[f];
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
      const decorFace = (t, y0, out, sa, sh, so, col, emissive, surf) => {
        const p = at(t, y0, out);
        decorBox(p.x, y0, p.z, alongX ? sa : so, sh, alongX ? so : sa, col, emissive, surf);
      };
      return { span, alongX, at, onFace, decorFace, normal: V(n[0], 0, n[1]) };
    };
    // Cornice ledges with glowing window tiles between them, and a drainpipe.
    const storeys = ({ span, at, onFace, decorFace, normal }, pipeAt) => {
      const ledgeYs = [];
      for (let y = base + 3.2; y < base + h - 1.4; y += 3.2) {
        if (ledges) onFace(0, y - 0.25, 0.35, span - 1.2, 0.25, 0.7, TRIM, { surface: 'plaster' });
        ledgeYs.push(y);
      }
      const cols = Math.max(2, Math.floor(span / 2.6));
      for (const ly of ledgeYs) {
        if (ly + 2.2 > base + h) continue;
        for (let i = 0; i < cols; i++) {
          const t = -span / 2 + (span / cols) * (i + 0.5);
          decorFace(t, ly + 0.55, 0.04, 1.0, 1.5, 0.08, '#ffd88a', '#6e4a10', 'glass');
          if (boxes) {
            const k = seed + i + Math.round(ly);
            decorFace(t, ly + 0.28, 0.28, 1.2, 0.26, 0.42, WINDOW_BOXES[k % WINDOW_BOXES.length]);
            flowerRow(at, t, ly + 0.54, 0.28, 1.1, k);
          }
          if (shutters) {
            // A sill deep enough to stand on, and a pair of shutters folded open.
            onFace(t, ly + 0.33, 0.35, 1.3, 0.22, 0.7, TRIM, { surface: 'plaster' });
            const col = SHUTTERS[(seed + i + Math.round(ly / 3.2)) % SHUTTERS.length];
            for (const sgn of [-1, 1]) decorFace(t + sgn * 0.74, ly + 0.55, 0.07, 0.42, 1.5, 0.06, col);
            sills.push({ stand: at(t, ly + 0.55, 0.4), normal: normal.clone(), t, at });
          }
        }
      }
      // Drainpipe (visual; the whole wall is climbable anyway).
      decorFace(pipeAt * span, base, 0.1, 0.16, h, 0.16, '#555b66');
    };

    const front = side(face);
    const { span, alongX, at, onFace, decorFace } = front;
    storeys(front, -0.5 + 0.5 / span);
    // Shopfronts and striped awnings (climb up into them to pull onto the top).
    for (let i = 0; i < awnings; i++) {
      const t = awnings === 1 ? 0 : -span / 4 + (span / 2) * i;
      const col = AWNINGS[(seed + i) % AWNINGS.length];
      decorFace(t, base, 0.03, 3.2, 2.4, 0.06, '#4d3a2e');
      onFace(t, base + 2.35, 0.8, 3.4, 0.18, 1.6, col);
    }
    // Hanging sign.
    if (sign) {
      const sp = at(span / 2 - 1.2, base + 4.2, 0.55);
      block(sp.x, sp.z, alongX ? 0.12 : 0.9, alongX ? 0.9 : 0.12, base + 4.3, 0.8, AWNINGS[(seed + 3) % AWNINGS.length]);
    }

    if (sides) {
      const across = alongX ? ['e', 'w'] : ['n', 's'];
      for (const f of across) {
        const sw = side(f);
        storeys(sw, f === 'e' || f === 's' ? 0.5 - 0.5 / sw.span : -0.5 + 0.5 / sw.span);
      }
    }

    if (back) {
      const rear = side(back);
      storeys(rear, 0.5 - 0.5 / rear.span);
      // A plain back door with a little step and lamp over it.
      const dt = ((seed % 3) - 1) * rear.span * 0.25;
      rear.decorFace(dt, base, 0.03, 1.1, 2.1, 0.06, '#3d2f27');
      rear.onFace(dt, base, 0.35, 1.5, 0.2, 0.7, TRIM, { surface: 'plaster' });
      rear.decorFace(dt, base + 2.35, 0.12, 0.3, 0.3, 0.24, '#ffe2a0', '#7a5a1a');
    }

    // Chimneys.
    for (let i = 0; i < chimneys; i++) {
      const t = (i === 0 ? -0.3 : 0.25) * span;
      const depth = alongX ? d : w;
      const p = at(t, top, -depth * (0.35 + 0.1 * i));
      block(p.x, p.z, 1.1, 1.1, top, 1.5 + (seed % 3) * 0.4, '#8b5c4a', { surface: 'brick' });
    }
    return { top, at, sills, front, side, x, z, w, d };
  };

  // ---------------------------------------------------------- 0: Piazza & Market Building
  const market = () => {
    block(0, 0, 30, 16, 0, 6, '#dcc5a2', { surface: 'stone' });
    // Cornice ring at 3.2 m.
    const ring = { surface: 'plaster' };
    block(0, -8.35, 30, 0.7, 2.95, 0.25, TRIM, ring);
    block(0, 8.35, 30, 0.7, 2.95, 0.25, TRIM, ring);
    block(15.35, 0, 0.7, 17.4, 2.95, 0.25, TRIM, ring);
    block(-15.35, 0, 0.7, 17.4, 2.95, 0.25, TRIM, ring);
    // Arcade arches.
    for (let x = -12; x <= 12; x += 3) {
      for (const s of [-1, 1]) decorBox(x, 0, s * 8.03, 2.0, 2.6, 0.08, '#6b4b35');
    }
    for (let z = -4.5; z <= 4.5; z += 3) {
      for (const s of [-1, 1]) decorBox(s * 15.03, 0, z, 0.08, 2.6, 2.0, '#6b4b35');
    }
    // Upper-floor windows.
    for (let x = -13; x <= 13; x += 2.6) {
      for (const s of [-1, 1]) decorBox(x, 3.7, s * 8.04, 1.1, 1.5, 0.08, '#ffd88a', '#6e4a10', 'glass');
    }
    // Glass roof, stepped up to the ridge.
    block(0, 0, 26, 10, 6, 2.4, '#a6d5df');
    block(0, 0, 22, 2.6, 8.4, 1.4, '#8cc2cf');
    for (let x = -12; x <= 12; x += 2) decorBox(x, 6, 0, 0.08, 2.42, 10.02, '#e9f4f6');
  };
  market();

  // North terrace (faces the Piazza to the south).
  const N = [
    building({ x: -22, z: -36, back: 'n', w: 14, d: 12, h: 11, face: 's', color: '#c98f6b', seed: 0 }),
    building({ x: -7, z: -36, back: 'n', w: 14, d: 12, h: 14, face: 's', color: '#d8b48a', seed: 1 }),
    building({ x: 8, z: -36, back: 'n', w: 14, d: 12, h: 10, face: 's', color: '#b5715a', seed: 2 }),
    building({ x: 23, z: -36, back: 'n', w: 14, d: 12, h: 13, face: 's', color: '#e0c9a0', seed: 3 }),
  ];
  block(31, -36, 2.2, 12, 0, 12, '#a98a7a', { surface: 'brick' });
  // East terrace (towards the Opera House).
  const E = [
    building({ x: 38, z: -22, w: 12, d: 14, h: 12, face: 'w', back: 'e', color: '#cfa77d', seed: 4 }),
    building({ x: 38, z: -7, w: 12, d: 14, h: 15, face: 'w', back: 'e', color: '#b98a6a', seed: 0, awnings: 1 }),
    building({ x: 38, z: 8, w: 12, d: 14, h: 11, face: 'w', back: 'e', color: '#d9b88f', seed: 2 }),
    building({ x: 38, z: 23, w: 12, d: 14, h: 13, face: 'w', back: 'e', color: '#c27d62', seed: 1 }),
  ];
  block(31, 36, 2.2, 12, 0, 11, '#a98a7a', { surface: 'brick' });
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
  const stone = { surface: 'stone' };
  block(-48, 0, 26, 18, 0, 12, '#e6dccb', stone); // nave, x -61..-35
  block(-48, 0, 24, 8, 12, 2, '#9a8f86', { surface: 'plaster' }); // roof ridge, top 14
  block(-54, 0, 3, 3, 14, 3.5, '#efe6d6', stone); // bell turret, top 17.5
  // Tuscan portico facing the Piazza.
  for (const z of [-6.5, -2.2, 2.2, 6.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 9.5, 18), worldMat('#f1e9da', stone));
    col.position.set(-31.5, 4.75, z);
    col.castShadow = col.receiveShadow = true;
    scene.add(col);
    physics.addBox(-31.5, 0, z, 1.1, 9.5, 1.1, { camera: false });
  }
  block(-32.9, 0, 4.2, 17, 9.5, 0.9, '#e9dfcf', stone); // portico roof, top 10.4
  block(-33.2, 0, 3.6, 12, 10.4, 1.2, '#ddd2c0', stone); // pediment, top 11.6
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

  // ---------------------------------------------------------- 2: Royal Opera House
  // East of the Piazza (x 48..118). Floral Hall faces the Piazza's north-east corner;
  // the Opera House sits behind it with its fly tower, portico on Bow Street.
  const IRON = '#4a5560';
  const glassId = (g, id = Math.random()) =>
    g.setAttribute('lmId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));

  // Tall arched window on a wall facing ±z (out = which side of the wall).
  const archWindow = (x, z, out, y0, w, h) => {
    const id = Math.random();
    const rect = new THREE.BoxGeometry(w, h, 0.08);
    rect.translate(x, y0 + h / 2, z + out);
    glassId(rect, id);
    addDecor('#ffd88a', rect, '#6e4a10', 'glass');
    const top = new THREE.CylinderGeometry(w / 2, w / 2, 0.08, 16, 1, false, -Math.PI / 2, Math.PI);
    top.rotateX(Math.PI / 2);
    top.translate(x, y0 + h, z + out);
    glassId(top, id);
    addDecor('#ffd88a', top, '#6e4a10', 'glass');
  };

  // Floral Hall: arched glass-and-iron hall, x 52..80, z -34..-18.
  {
    block(66, -26, 28, 16, 0, 9, '#eadccb', stone);
    // Cornice ledges at 3.2 and 6.4 m on the three open sides (rest points).
    for (const y of [3.2, 6.4]) {
      block(66, -34.35, 28, 0.7, y - 0.25, 0.25, TRIM, { surface: 'plaster' });
      block(66, -17.65, 28, 0.7, y - 0.25, 0.25, TRIM, { surface: 'plaster' });
      block(51.65, -26, 0.7, 17.4, y - 0.25, 0.25, TRIM, { surface: 'plaster' });
    }
    // Tall arched windows along both long sides.
    for (let x = 54.5; x <= 78; x += 3) {
      for (const [z, out] of [[-18, 0.04], [-34, -0.04]]) {
        archWindow(x, z, out, 0.4, 1.5, 2.1);
        archWindow(x, z, out, 3.55, 1.5, 1.8);
      }
    }
    // Stepped glass vault on top, ribbed with iron; the lantern sits on the crown.
    block(66, -26, 26, 12, 9, 2.2, '#a6d5df'); // top 11.2
    block(66, -26, 24, 7.6, 11.2, 2.0, '#9fcfd9'); // top 13.2
    block(66, -26, 22, 3, 13.2, 1.4, '#94c6d2'); // top 14.6
    for (let x = 54; x <= 78; x += 2) {
      decorBox(x, 9, -26, 0.1, 2.22, 12.02, IRON);
      if (x >= 55 && x <= 77) decorBox(x, 11.2, -26, 0.1, 2.02, 7.62, IRON);
      if (x >= 56 && x <= 76) decorBox(x, 13.2, -26, 0.1, 1.42, 3.02, IRON);
    }
    // The great iron fan arch on the gable facing the Piazza.
    const fan = new THREE.TorusGeometry(6.2, 0.2, 6, 28, Math.PI);
    fan.rotateY(Math.PI / 2);
    fan.translate(52.95, 9, -26);
    addDecor(IRON, fan);
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      const spoke = new THREE.BoxGeometry(0.12, 6.2, 0.12);
      spoke.translate(0, 3.1, 0);
      spoke.rotateX(a - Math.PI / 2);
      spoke.translate(52.95, 9, -26);
      addDecor(IRON, spoke);
    }
  }

  // The Opera House: stone block with a fly tower above the stage.
  const OPERA = building({
    x: 90, z: -26, w: 20, d: 36, h: 18, face: 'e', color: '#efe6da', seed: 2,
    awnings: 0, chimneys: 0, surface: 'stone', sign: false,
  }); // x 80..100, z -44..-8
  const FLY = building({
    x: 90, z: -28, w: 12, d: 14, h: 12, face: 'e', color: '#ddd0c1', seed: 1,
    awnings: 0, chimneys: 0, surface: 'stone', sign: false, base: OPERA.top,
  }); // x 84..96, top ~30.7
  // Rows of tall arched windows on the side facing the plaza, and on the fly tower.
  for (let x = 82.5; x <= 98; x += 3.1) {
    for (const y of [1.2, 5.6, 10.0]) archWindow(x, -8, 0.04, y, 1.3, 2.6);
  }
  for (let x = 86; x <= 94; x += 2.7) archWindow(x, -21, 0.04, OPERA.top + 4, 1.1, 3.2);
  // Corinthian portico on Bow Street.
  block(101.4, -26, 2.8, 16, 0, 1.0, '#e2d6c4', stone); // podium
  for (const z of [-33, -30, -27, -24, -21, -18]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 11, 16), worldMat('#f3ebde', stone));
    col.position.set(101.8, 6.5, z);
    col.castShadow = col.receiveShadow = true;
    scene.add(col);
    physics.addBox(101.8, 1, z, 1.0, 11, 1.0, { camera: false });
  }
  block(101.5, -26, 3.4, 17, 12, 0.9, '#e9dfcf', stone); // portico roof, top 12.9
  block(101.6, -26, 2.8, 12, 12.9, 1.4, '#ddd2c0', stone); // pediment, top 14.3

  // Bow Street terraces (east side, facing the Opera House).
  const BOW = [
    building({ x: 112, z: -36, w: 8, d: 14, h: 12, face: 'w', back: 'e', color: '#c9a27e', seed: 0, awnings: 1 }),
    building({ x: 112, z: -20, w: 8, d: 14, h: 14, face: 'w', back: 'e', color: '#b47c62', seed: 3, awnings: 1 }),
    building({ x: 112, z: -4, w: 8, d: 14, h: 11, face: 'w', back: 'e', color: '#d8b892', seed: 1, awnings: 1 }),
    building({ x: 112, z: 12, w: 8, d: 14, h: 13, face: 'w', back: 'e', color: '#a86f58', seed: 4, awnings: 1 }),
    building({ x: 112, z: 28, w: 8, d: 14, h: 12, face: 'w', back: 'e', color: '#cfa985', seed: 2, awnings: 1 }),
  ];
  // Russell Street terrace (south side, facing the plaza).
  const RUSSELL = [
    building({ x: 62, z: 34, w: 14, d: 12, h: 11, face: 'n', color: '#c98f6b', seed: 1 }),
    building({ x: 77, z: 34, w: 14, d: 12, h: 13, face: 'n', color: '#d9b48c', seed: 3 }),
    building({ x: 92, z: 34, w: 14, d: 12, h: 10, face: 'n', color: '#b5715a', seed: 0 }),
  ];
  // Plaza furniture.
  [[58, -12], [74, -12], [104, -4], [104, 16], [60, 20], [88, 20]].forEach(([x, z]) => lamp(x, z));
  [[70, 2], [86, 2], [56, 6]].forEach(([x, z]) => planter(x, z));
  [[64, 10], [80, 10]].forEach(([x, z]) => block(x, z, 2.2, 0.6, 0, 0.45, '#6d5442'));

  // Cobbles everywhere on the open ground of the district.
  {
    const tile = new THREE.BoxGeometry(1.8, 0.05, 1.8);
    const spots = [];
    for (let x = 49; x <= 117; x += 2) for (let z = -44; z <= 44; z += 2) {
      if (physics.fits(V(x, 0.01, z), 0.9, 0.04)) spots.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff', { surface: 'plaster' }), spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#c9b0a8', '#bfa39a', '#d3bdb3', '#b79c92', '#cdb0a2'];
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.025, z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(tones[Math.abs(i * 7 + x * 3 + z * 13) % tones.length]));
    });
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // ---------------------------------------------------------- 3: Neal's Yard
  // North of the Opera House (x 48..118, z -105..-45): a small, hidden courtyard of
  // brightly painted houses with window boxes, reached by one narrow alley (Shorts
  // Gardens, x 62..66) from the Opera House plaza. Signature climb: the tall pink
  // house's staircase of window boxes, with the lantern on its roof.
  const PAINT = ['#f2a7c3', '#a9dc6e', '#8fcdf0', '#f6b45e', '#f4dc6a', '#79cdb9', '#c9a2e8'];
  const painted = { surface: 'plaster', boxes: true };
  // South row; its backs face the Opera House plaza, so they're dressed too.
  const NYS = [
    building({ x: 56, z: -54, w: 12, d: 12, h: 10, face: 'n', back: 's', color: PAINT[0], seed: 0, ...painted }),
    building({ x: 73, z: -54, w: 14, d: 12, h: 12, face: 'n', back: 's', color: PAINT[2], seed: 1, ...painted }),
    building({ x: 89, z: -54, w: 18, d: 12, h: 11, face: 'n', back: 's', color: PAINT[3], seed: 2, chimneys: 1, ...painted }),
    building({ x: 107, z: -54, w: 16, d: 12, h: 13, face: 'n', back: 's', color: PAINT[1], seed: 3, ...painted }),
  ];
  // North row (the signature house goes in the gap at x 82..100).
  const NYN = [
    building({ x: 58, z: -96, w: 16, d: 12, h: 13, face: 's', color: PAINT[4], seed: 4, ...painted }),
    building({ x: 74, z: -96, w: 16, d: 12, h: 11, face: 's', color: PAINT[5], seed: 0, ...painted }),
    building({ x: 108, z: -96, w: 16, d: 12, h: 12, face: 's', color: PAINT[6], seed: 1, ...painted }),
  ];
  // West and east rows.
  const NYW = [
    building({ x: 56, z: -82, w: 12, d: 16, h: 11, face: 'e', back: 'w', color: PAINT[1], seed: 2, awnings: 1, ...painted }),
    // Shortened to leave Monmouth Street (z -74..-70) running west to Seven Dials.
    building({ x: 56, z: -65, w: 12, d: 10, h: 12, face: 'e', back: 'w', color: PAINT[3], seed: 3, awnings: 1, ...painted }),
  ];
  const NYE = [
    building({ x: 110, z: -82, w: 12, d: 16, h: 14, face: 'w', back: 'e', color: PAINT[2], seed: 4, awnings: 1, ...painted }),
    // Shortened to leave Shelton Street (z -74..-70) running east to Drury Lane.
    building({ x: 110, z: -65, w: 12, d: 10, h: 11, face: 'w', back: 'e', color: PAINT[0], seed: 0, awnings: 1, ...painted }),
  ];

  // The signature house: tall, pink, no cornices; only a zig-zag staircase of
  // window boxes to rest on. Yard face at z = -90; the lantern sits on its roof.
  const SIG_H = 20;
  block(91, -96, 18, 12, 0, SIG_H, '#f07fae', { surface: 'plaster' });
  block(91, -96, 18.6, 12.6, SIG_H, 0.35, TRIM, { surface: 'plaster' });
  const SIG_TOP = SIG_H + 0.35;
  const sigAt = (t, y, out) => V(91 + t, y, -90 + out);
  for (let i = 0; i < 11; i++) {
    const y = 1.7 + i * 1.65;
    const t = (i % 2 ? 1 : -1) * (1.5 + (i % 3) * 0.2);
    decorBox(91 + t, y + 0.45, -89.96, 1.1, 1.3, 0.08, '#ffd88a', '#6e4a10', 'glass');
    block(91 + t, -89.65, 1.5, 0.7, y, 0.4, WINDOW_BOXES[i % WINDOW_BOXES.length], { surface: 'plaster' });
    flowerRow(sigAt, t, y + 0.4, 0.35, 1.4, i);
  }
  decorBox(91, 0, -89.97, 1.4, 2.4, 0.06, '#3d2f27'); // front door

  // The yard: a tree to climb, planters, benches, lamps and water butts.
  tree(84, -74);
  [[72, -82], [98, -68]].forEach(([x, z]) => planter(x, z));
  [[76, -66], [96, -84]].forEach(([x, z]) => block(x, z, 2.2, 0.6, 0, 0.45, '#6d5442'));
  [[70, -70], [100, -78]].forEach(([x, z]) => lamp(x, z));
  const butt = (x, z, y = 0, r = 0.55, h = 1.1, color = '#4a7a5c') => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 16), worldMat(color));
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    physics.addBox(x, y, z, r * 2, h, r * 2);
  };
  butt(64.6, -87);
  butt(101.4, -63);
  // A rooftop water tank on the south row, to stand on.
  butt(90, -53, NYS[2].top, 1.1, 2.0, '#7b8fa0');

  // Pastel cobbles across the yard and alley.
  {
    const tile = new THREE.BoxGeometry(1.8, 0.05, 1.8);
    const spots = [];
    for (let x = 49; x <= 117; x += 2) for (let z = -104; z <= -46; z += 2) {
      if (physics.fits(V(x, 0.01, z), 0.9, 0.04)) spots.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff', { surface: 'plaster' }), spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#cdbfa6', '#c4b8b0', '#d6c9b3', '#bfb59f', '#d1c2b8'];
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.025, z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(tones[Math.abs(i * 7 + x * 3 + z * 13) % tones.length]));
    });
    inst.receiveShadow = true;
    scene.add(inst);
  }


  // ---------------------------------------------------------- 4: Seven Dials
  // North of the Piazza, west of Neal's Yard (x -27..48, z -105..-45). Seven streets
  // radiate from a circus round the sundial pillar; Monmouth Street (z -74..-70)
  // comes in from Neal's Yard along the east street. The pillar is too tall to climb
  // on scarf alone: its ledges are ghosts that turn solid for a while when a chirp
  // ripple passes (and for good once the lantern on top is lit).
  const SD_C = V(10, 0, -72);
  const SD_COLORS = ['#cfd8c8', '#b9897a', '#e3d4b8', '#9fb8ae', '#c48f6a', '#d9c7a3', '#a8a296'];
  const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
  // Wedge buildings: shuttered windows with sills on every side (no cornices), so a
  // façade is climbed window by window, and the streets between them are dressed.
  const sdRing = [];
  for (let k = 0; k < 7; k++) {
    const a = ((k + 0.5) / 7) * Math.PI * 2; // the wedge between street k and k+1
    const cx = SD_C.x + Math.cos(a) * 21;
    const cz = SD_C.z + Math.sin(a) * 21;
    const face = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a))
      ? (Math.cos(a) > 0 ? 'w' : 'e')
      : (Math.sin(a) > 0 ? 'n' : 's');
    const b = building({
      x: cx, z: cz, w: 12, d: 12, h: 11 + ((k * 3) % 4), face, back: OPPOSITE[face], color: SD_COLORS[k], seed: k,
      surface: k % 2 ? 'brick' : 'plaster', shutters: true, ledges: false, sides: true, sign: false,
    });
    sdRing.push({ k, b, x: cx, z: cz, box: { x0: cx - 6, x1: cx + 6, z0: cz - 6, z1: cz + 6 } });
  }

  // The sundial pillar: stepped plinth, a tall column, and a hexagonal head with six
  // copper sundials (the column itself is the seventh dial).
  const COLUMN_TOP = 29;
  const HEAD_H = 2.5;
  // Three low steps (each under the step-up height) you can simply walk up.
  block(SD_C.x, SD_C.z, 5.2, 5.2, 0, 0.33, '#cfc6b4', stone);
  block(SD_C.x, SD_C.z, 4.2, 4.2, 0.33, 0.33, '#d3cab8', stone);
  block(SD_C.x, SD_C.z, 3.2, 3.2, 0.66, 0.33, '#d6cdbb', stone);
  block(SD_C.x, SD_C.z, 2.2, 2.2, 0.99, COLUMN_TOP - 0.99, '#ddd5c6', stone);
  {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, HEAD_H, 6), worldMat('#e6dece', stone));
    head.position.set(SD_C.x, COLUMN_TOP + HEAD_H / 2, SD_C.z);
    head.castShadow = head.receiveShadow = true;
    scene.add(head);
    physics.addBox(SD_C.x, COLUMN_TOP, SD_C.z, 3.0, HEAD_H, 3.0);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i / 6) * Math.PI * 2; // centre of each hexagon face
      const r = 1.75 * Math.cos(Math.PI / 6) + 0.03;
      const px = SD_C.x + Math.cos(a) * r;
      const pz = SD_C.z + Math.sin(a) * r;
      const dial = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20);
      dial.rotateX(Math.PI / 2);
      dial.rotateY(Math.PI / 2 - a);
      dial.translate(px, COLUMN_TOP + HEAD_H / 2, pz);
      addDecor('#c87533', dial);
      const gnomon = new THREE.BoxGeometry(0.06, 0.45, 0.32);
      gnomon.translate(0, 0, 0.16);
      gnomon.rotateY(Math.PI / 2 - a);
      gnomon.translate(px, COLUMN_TOP + HEAD_H / 2 + 0.1, pz);
      addDecor('#3a3530', gnomon);
    }
  }
  const SD_TOP = COLUMN_TOP + HEAD_H;

  // Ghost ledges: a collar of four slabs round the column every ~5 m.
  const chirpLedges = [];
  for (const y of [5, 10, 15, 20, 24.5]) {
    const mat = toonMat('#3fd0c0', { transparent: true, opacity: 0.18, emissive: '#0f4f49', depthWrite: false });
    const parts = [
      [0, -1.45, 3.6, 0.7], [0, 1.45, 3.6, 0.7], // north, south
      [-1.45, 0, 0.7, 2.2], [1.45, 0, 0.7, 2.2], // west, east
    ];
    const geos = [];
    const colliders = [];
    for (const [dx, dz, w, d] of parts) {
      const g = new THREE.BoxGeometry(w, 0.35, d);
      g.translate(SD_C.x + dx, y + 0.175, SD_C.z + dz);
      geos.push(g);
      const c = physics.addBox(SD_C.x + dx, y, SD_C.z + dz, w, 0.35, d, { camera: false });
      c.enabled = false;
      colliders.push(c);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.renderOrder = 2;
    scene.add(mesh);
    chirpLedges.push({ district: 4, center: V(SD_C.x, y, SD_C.z), colliders, mesh });
  }

  // Bollards ring the circus.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    block(SD_C.x + Math.cos(a) * 9, SD_C.z + Math.sin(a) * 9, 0.35, 0.35, 0, 0.8, '#2f3a3a', { collide: false });
  }
  // (No street lamps here: the strings of lights do that job.)

  // Cobbles laid in rings round the pillar.
  {
    const tile = new THREE.BoxGeometry(1.8, 0.05, 1.8);
    const spots = [];
    for (let x = -26; x <= 47; x += 2) for (let z = -104; z <= -46; z += 2) {
      if (physics.fits(V(x, 0.01, z), 0.9, 0.04)) spots.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff', { surface: 'plaster' }), spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#c3c6bd', '#b7bdb3', '#cfcfc4', '#adb6ad', '#c9c2b4'];
    spots.forEach(([x, z], i) => {
      const ring = Math.floor(Math.hypot(x - SD_C.x, z - SD_C.z) / 3);
      m.makeTranslation(x, 0.025, z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(tones[(ring + (i % 2)) % tones.length]));
    });
    inst.receiveShadow = true;
    scene.add(inst);
  }


  // ---------------------------------------------------------- Seven Dials: ways up and down
  const BULBS = [['#ffd27a', '#a8701a'], ['#ff9a8a', '#a0402a'], ['#9fe8ff', '#2a7f98'], ['#c6ff9a', '#4f8f2a']];
  // A string of lights along a sagging curve: dark wire plus bulbs, merged into decor.
  const lightString = (curveAt, len, idx) => {
    const n = Math.max(8, Math.round(len * 2));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curveAt(i / n, V(0, 0, 0)));
    addDecor('#2a2a2e', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.03, 4, false));
    const count = Math.floor(len / 0.9);
    for (let i = 1; i < count; i++) {
      const p = curveAt(i / count, V(0, 0, 0));
      const g = new THREE.SphereGeometry(0.09, 6, 5);
      g.translate(p.x, p.y - 0.12, p.z);
      const [col, em] = BULBS[(i + idx) % BULBS.length];
      addDecor(col, g, em);
    }
  };
  const sagCurve = (a, b, sag) => (t, out) => out.lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));

  // Light strings from every wedge roof down to a copper ring on the pillar. Jump at
  // the pole on the roof edge to catch one and zip down into the circus.
  const RING_Y = 4.6;
  {
    const ring = new THREE.TorusGeometry(1.16, 0.07, 6, 24);
    ring.rotateX(Math.PI / 2);
    ring.translate(SD_C.x, RING_Y, SD_C.z);
    addDecor('#c87533', ring);
  }
  const sdZips = sdRing.map((r) => {
    const f = r.b.front;
    const a = f.at(0, r.b.top + 1.0, -0.5);
    const dir = V(SD_C.x - a.x, 0, SD_C.z - a.z).normalize();
    const b = V(SD_C.x - dir.x * 1.16, RING_Y, SD_C.z - dir.z * 1.16);
    const len = a.distanceTo(b);
    const at = sagCurve(a, b, len * 0.05);
    // Let go once 2.6 m out from the column's centre: clear of the plinth and the ledges.
    const horiz = Math.hypot(a.x - b.x, a.z - b.z);
    const release = (horiz - (2.6 - 1.16)) / horiz;
    const line = { a, b, len, at, release, dir };
    physics.ziplines.push(line);
    const pole = f.at(0, r.b.top, -0.5);
    decorBox(pole.x, r.b.top, pole.z, 0.12, 1.15, 0.12, '#2f3a3a');
    lightString(at, len, r.k);
    // Take off from just behind the pole, in line with the string.
    const roofStand = a.clone().addScaledVector(dir, -1.2).setY(r.b.top);
    return { ...line, idx: physics.ziplines.length - 1, roofStand, front: f.at(0, 0, 3), top: r.b.top, k: r.k };
  });

  // Decorative strings across each street, from roof to roof (they're out of reach).
  const nearestOnBox = (box, p) => V(
    THREE.MathUtils.clamp(p.x, box.x0, box.x1), 0, THREE.MathUtils.clamp(p.z, box.z0, box.z1),
  );
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const left = sdRing[(k + 6) % 7];
    const right = sdRing[k];
    for (const r of [19, 25]) {
      const mid = V(SD_C.x + Math.cos(a) * r, 0, SD_C.z + Math.sin(a) * r);
      const pa = nearestOnBox(left.box, mid);
      const pb = nearestOnBox(right.box, mid);
      const y = Math.min(left.b.top, right.b.top) - 0.6;
      pa.y = y;
      pb.y = y;
      if (pa.distanceTo(pb) < 2) continue;
      lightString(sagCurve(pa, pb, 0.6), pa.distanceTo(pb), k + r);
    }
  }

  // Tall green trees in the streets, close to a wall: climb the trunk canopy by canopy
  // nearly to the roofs (then up the wall), or hop down them gently.
  const sdTrees = [];
  const boxDist = (box, p) => {
    const q = nearestOnBox(box, p);
    return Math.hypot(p.x - q.x, p.z - q.z);
  };
  for (let k = 1; k < 7; k++) { // street 0 (Monmouth Street) stays clear
    const a = (k / 7) * Math.PI * 2;
    const along = V(Math.cos(a), 0, Math.sin(a));
    const perp = V(-along.z, 0, along.x);
    const flank = [sdRing[(k + 6) % 7], sdRing[k]];
    let found = null;
    // Search along the street for room for the canopy, right beside a wall.
    for (let rr = 18; rr <= 32 && !found; rr += 0.5) {
      for (let off = -3; off <= 3 && !found; off += 0.5) {
        const p = V(SD_C.x + along.x * rr + perp.x * off, 0.01, SD_C.z + along.z * rr + perp.z * off);
        const r = flank.reduce((best, f) => (boxDist(f.box, p) < boxDist(best.box, p) ? f : best));
        const d = boxDist(r.box, p);
        if (d < 1.55 || d > 2.4) continue;
        const layers = [];
        for (let y = 3.4; y <= r.b.top - 2.2; y += 3.4) layers.push(y);
        const topY = layers[layers.length - 1] + 0.6;
        if (!physics.fits(p, 1.45, topY)) continue;
        const wall = nearestOnBox(r.box, p);
        const nW = Math.abs(p.x - wall.x) > Math.abs(p.z - wall.z)
          ? V(Math.sign(p.x - wall.x), 0, 0) : V(0, 0, Math.sign(p.z - wall.z));
        const ground = p.clone().addScaledVector(nW, 2.6);
        if (!physics.fits(ground, 0.3, 0.62)) continue;
        found = { r, T: V(p.x, 0, p.z), nW, layers, topY, ground: ground.setY(0) };
      }
    }
    if (!found) continue;
    const { T, nW, layers, topY } = found;
    block(T.x, T.z, 0.5, 0.5, 0, topY - 0.6, '#6a4a36', { camera: false, collide: false });
    const trunk = physics.addBox(T.x, 0, T.z, 0.5, topY - 0.6, 0.5, { camera: false });
    layers.forEach((y, i) => {
      const g = new THREE.SphereGeometry(1.55 - i * 0.1, 12, 9);
      g.scale(1, 0.42, 1);
      g.translate(T.x + (i % 2 ? 0.15 : -0.15), y + 0.05, T.z);
      addDecor(['#5f9f55', '#6fb060', '#7fbf6a', '#68a85a'][(i + k) % 4], g);
      // Step slowly off a canopy and you grab the trunk to climb down (see Wanderer.grabEdge).
      physics.addBox(T.x, y, T.z, 2.6, 0.6, 2.6, { camera: false }).trunk = trunk;
    });
    sdTrees.push({ k, T, nW, topY, ground: found.ground, stand: T.clone().addScaledVector(nW, 1.0) });
  }

  // Fragment pool: roofs, high window sills, treetops, and the middle of the light
  // strings (collected mid-zip). Each new game picks six at random.
  const sdPool = [];
  // Keep fragments out of the narrow strips hard against the fog walls.
  const inSD = (p) => p.x > -24.5 && p.x < 45.5 && p.z > -102.5 && p.z < -47.5;
  for (const r of sdRing) {
    const f = r.b.front;
    const t = (rng() - 0.5) * 3;
    sdPool.push({
      kind: 'roof', tag: `b${r.k}`, pos: f.at(t, r.b.top + 0.6, -2.2),
      front: f.at(0, 0, 3), climb: f.at(t, r.b.top, -2.2),
    });
    for (const sill of r.b.sills) {
      if (sill.stand.y < 6) continue;
      const ground = sill.stand.clone().addScaledVector(sill.normal, 2.6);
      ground.y = 0;
      if (!inSD(ground) || !physics.fits(V(ground.x, 0.01, ground.z), 0.4, 0.62)) continue;
      sdPool.push({
        kind: 'sill', tag: `b${r.k}`, pos: sill.stand.clone().setY(sill.stand.y + 0.6),
        ground, climb: sill.stand.clone(), push: [-sill.normal.x, -sill.normal.z],
      });
    }
  }
  for (const tr of sdTrees) {
    sdPool.push({
      kind: 'tree', tag: `t${tr.k}`, pos: V(tr.T.x, tr.topY + 0.6, tr.T.z),
      ground: tr.ground, climb: tr.stand.clone().setY(tr.topY), push: [-tr.nW.x, -tr.nW.z], top: V(tr.T.x, tr.topY, tr.T.z),
    });
  }
  for (const z of sdZips) {
    const mid = z.at(0.5, V(0, 0, 0));
    sdPool.push({
      kind: 'zip', tag: `b${z.k}`, pos: mid.setY(mid.y - 0.42), front: z.front, climb: z.roofStand.clone().setY(z.top),
      line: z.idx, dir: [z.dir.x, z.dir.z],
    });
  }
  // Six at random: at most two of a kind, never two on the same building or tree.
  const sdChosen = [];
  {
    const order = sdPool.map((c) => [rng(), c]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const kinds = {};
    const tags = new Set();
    for (const c of order) {
      if (sdChosen.length === 6) break;
      if ((kinds[c.kind] ?? 0) >= 2 || tags.has(c.tag)) continue;
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      tags.add(c.tag);
      sdChosen.push(c);
    }
  }


  // ---------------------------------------------------------- 5: Drury Lane theatres
  // East of the Opera House and Neal's Yard (x 118..178, z -105..45). Drury Lane runs
  // north-south (x 132..140); theatres line its east side: the Lyceum, the Theatre
  // Royal (with its fly tower) and the Fortune. Russell Street comes in from the Opera
  // House (z 35..45), Shelton Street from Neal's Yard (z -74..-70). Signature climb: the
  // stage-door fire escapes, iron stairs you walk up flight by flight, all the way up the
  // Theatre Royal's fly tower to the lantern.
  const DL_STREET = 136;
  const MAGENTA = '#c8327f';
  const GOLD = '#f2c14e';
  const DL_IRON = '#3b3f46';
  const DL_PAINT = ['#d9c3a5', '#b8826a', '#cfb08a', '#a9765f', '#e0cdb0', '#c49a7c'];

  // West side of Drury Lane: terraces facing the street, with gaps for Shelton Street
  // and Russell Street.
  const DLW = [
    [-97, 14, 12], [-82, 12, 11], [-61, 14, 13], [-45, 14, 10], [-29, 14, 12], [-13, 14, 11], [3, 14, 13], [19, 14, 10],
  ].map(([z, d, h], i) => building({
    x: 125, z, w: 12, d, h, face: 'e', color: DL_PAINT[i % DL_PAINT.length], seed: i, awnings: 1, roof: 'tiles',
  }));

  // The theatres, facing the street.
  const theatre = (x, z, w, d, h, color, seed) => building({
    x, z, w, d, h, face: 'w', color, seed, awnings: 0, chimneys: 0, surface: 'stone', sign: false, roof: 'tiles',
  });
  const LYCEUM = theatre(157, -80, 30, 40, 14, '#e8dccb', 1); // x 142..172, z -100..-60
  const ROYAL = theatre(156, -24, 28, 36, 15, '#efe4d2', 2); // x 142..170, z -42..-6
  const FORTUNE = theatre(152, 13, 20, 22, 12, '#e2d2bd', 3); // x 142..162, z 2..24
  const ROYAL_FLY = building({
    x: 160, z: -24, w: 18, d: 24, h: 10, face: 'w', color: '#ddd0bd', seed: 4,
    awnings: 0, chimneys: 0, surface: 'stone', sign: false, base: ROYAL.top, roof: 'tiles',
  }); // x 151..169, z -36..-12, on the Theatre Royal's roof
  const FLY_TOP = ROYAL_FLY.top;

  // Marquees: gold canopies over the theatre doors, edged with bulbs, a name board above.
  const marquees = [];
  for (const [t, i] of [[LYCEUM, 0], [ROYAL, 1], [FORTUNE, 2]]) {
    const f = t.front;
    const w = f.span * 0.55;
    f.onFace(0, 4.0, 1.25, w, 0.35, 2.5, GOLD, { surface: 'plaster' });
    f.decorFace(0, 4.45, 0.06, w * 0.8, 1.1, 0.12, MAGENTA);
    f.decorFace(0, 0, 0.03, w * 0.6, 3.2, 0.06, '#3a2430'); // doors
    for (let k = 0; k <= 12; k++) {
      const p = f.at(-w / 2 + (w * k) / 12, 3.95, 2.5);
      const g = new THREE.SphereGeometry(0.1, 6, 5);
      g.translate(p.x, p.y, p.z);
      addDecor(k % 2 ? GOLD : '#ff9ad0', g, k % 2 ? '#8a6510' : '#7a2050');
    }
    marquees.push({ i, f, top: 4.35 });
  }

  // Stage-door fire escapes: flights of shallow steps (each low enough to walk up)
  // climbing diagonally along a wall, with a short landing at every floor.
  const fireEscape = (side, t0, dir, y0, topY) => {
    const RUN = 0.36;
    const LAND = 0.8;
    const OUT = 0.65;
    const DEPTH = 1.1;
    const flights = Math.ceil((topY - y0) / 3.2);
    const riseF = (topY - y0) / flights;
    const steps = Math.ceil(riseF / 0.31);
    const rise = riseF / steps;
    const path = [side.at(t0 - dir * 1.0, y0, OUT)];
    let t = t0;
    let y = y0;
    for (let f = 0; f < flights; f++) {
      for (let s = 1; s <= steps; s++) {
        const ty = y + rise * s;
        const tc = t + dir * RUN * (s - 0.5);
        side.onFace(tc, ty - 0.12, OUT, RUN, 0.12, DEPTH, DL_IRON, { camera: false });
        if (s % 2 === 0) side.decorFace(tc, ty, OUT + DEPTH / 2 - 0.03, 0.04, 0.9, 0.04, DL_IRON); // railing post
        side.decorFace(tc, ty + 0.88, OUT + DEPTH / 2 - 0.03, RUN, 0.05, 0.05, DL_IRON); // handrail
      }
      t += dir * RUN * steps;
      y += riseF;
      side.onFace(t + (dir * LAND) / 2, y - 0.12, OUT, LAND, 0.12, DEPTH, DL_IRON, { camera: false });
      path.push(side.at(t + (dir * LAND) / 2, y, OUT));
      t += dir * LAND;
    }
    return path;
  };
  // A stage door with its little lamp at the foot of each escape.
  const stageDoor = (side, t) => {
    side.decorFace(t, 0, 0.03, 1.1, 2.2, 0.06, '#2c2f36');
    side.decorFace(t, 2.4, 0.12, 0.3, 0.3, 0.24, '#ffe2a0', '#7a5a1a');
  };
  const ESC = {};
  {
    const north = ROYAL.side('n'); // on the stage-door alley
    stageDoor(north, -13.2);
    ESC.royal = fireEscape(north, -12, 1, 0, ROYAL.top);
    const flyN = ROYAL_FLY.side('n');
    ESC.fly = fireEscape(flyN, -8.5, 1, ROYAL.top, FLY_TOP);
    const south = LYCEUM.side('s'); // the other side of the same alley
    stageDoor(south, -14.2);
    ESC.lyceum = fireEscape(south, -13, 1, 0, LYCEUM.top);
    const fortuneN = FORTUNE.side('n'); // on Catherine Street
    stageDoor(fortuneN, -9.7);
    ESC.fortune = fireEscape(fortuneN, -8.5, 1, 0, FORTUNE.top);
  }

  // Strings of lights across Drury Lane, from the theatre roofs down to the terraces
  // opposite: catch one at the pole and zip across.
  const dlZips = [];
  for (const [t, z] of [[LYCEUM, -92], [LYCEUM, -64], [ROYAL, -30], [ROYAL, -14], [FORTUNE, 8], [FORTUNE, 20]]) {
    const f = t.front;
    const tz = z - (f.at(0, 0, 0).z);
    const a = f.at(tz, t.top + 1.0, -0.5);
    const b = V(131.15, 5.4, z);
    const len = a.distanceTo(b);
    const at = sagCurve(a, b, len * 0.05);
    const horiz = Math.hypot(a.x - b.x, a.z - b.z);
    const dir = V(b.x - a.x, 0, b.z - a.z).normalize();
    const line = { a, b, len, at, release: 1 - 1.3 / horiz, dir };
    physics.ziplines.push(line);
    const pole = f.at(tz, t.top, -0.5);
    decorBox(pole.x, t.top, pole.z, 0.12, 1.15, 0.12, DL_IRON);
    lightString(at, len, dlZips.length + 3);
    const roofStand = a.clone().addScaledVector(dir, -1.2).setY(t.top);
    dlZips.push({ ...line, idx: physics.ziplines.length - 1, roofStand, front: f.at(tz, 0, 3.6), top: t.top, z });
  }


  // Roof gardens: iron railings round every roof edge (decorative, so they never stop
  // you pulling up onto a roof), with gaps where fire escapes and light strings arrive;
  // planters of flowers at the back; potted bay trees on the theatres.
  const roofGarden = (b, gaps, bays) => {
    const top = b.top;
    const hx = b.w / 2 + 0.18;
    const hz = b.d / 2 + 0.18;
    const nearGap = (x, z, r) => gaps.some((g) => Math.hypot(g.x - x, g.z - z) < r);
    const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    corners.forEach(([ax, az], i) => {
      const [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 0.75));
      for (let k = 0; k < n; k++) {
        const u0 = k / n;
        const u1 = (k + 1) / n;
        const px = b.x + ax + (bx - ax) * u0;
        const pz = b.z + az + (bz - az) * u0;
        const mx = b.x + ax + (bx - ax) * ((u0 + u1) / 2);
        const mz = b.z + az + (bz - az) * ((u0 + u1) / 2);
        if (nearGap(mx, mz, 1.4)) continue;
        decorBox(px, top, pz, 0.06, 0.92, 0.06, DL_IRON);
        if (k % 4 === 0) {
          const g = new THREE.SphereGeometry(0.07, 6, 5);
          g.translate(px, top + 0.98, pz);
          addDecor(GOLD, g);
        }
        const segX = Math.abs(bx - ax) * (u1 - u0) + 0.06;
        const segZ = Math.abs(bz - az) * (u1 - u0) + 0.06;
        decorBox(mx, top + 0.86, mz, segX, 0.05, segZ, DL_IRON);
        decorBox(mx, top + 0.45, mz, segX, 0.04, segZ, DL_IRON);
      }
    });
    // Planters at the back corners and the middle of the back edge.
    const n = b.front.normal;
    const back = V(-n.x, 0, -n.z);
    const across = V(-back.z, 0, back.x);
    const reachBack = Math.abs(back.x) ? b.w / 2 - 0.9 : b.d / 2 - 0.9;
    const reachAcross = Math.abs(across.x) ? b.w / 2 - 1.3 : b.d / 2 - 1.3;
    for (const a of [-1, 0, 1]) {
      const cx = b.x + back.x * reachBack + across.x * reachAcross * a;
      const cz = b.z + back.z * reachBack + across.z * reachAcross * a;
      if (nearGap(cx, cz, 2.2)) continue;
      const along = Math.abs(across.x) > 0.5;
      block(cx, cz, along ? 1.6 : 0.6, along ? 0.6 : 1.6, top, 0.45, '#8a5a3c', { surface: 'plaster' });
      for (let f = 0; f < 5; f++) {
        const off = -0.6 + f * 0.3;
        const g = new THREE.SphereGeometry(0.15, 7, 5);
        g.translate(cx + (along ? off : 0), top + 0.6, cz + (along ? 0 : off));
        addDecor(FLOWERS[(f * 2 + Math.round(cx + cz)) % FLOWERS.length], g);
      }
    }
    // Potted bay trees at the front corners of the theatres.
    if (bays) {
      for (const a of [-1, 1]) {
        const reachFront = Math.abs(n.x) ? b.w / 2 - 1.0 : b.d / 2 - 1.0;
        const cx = b.x + n.x * reachFront + across.x * reachAcross * a;
        const cz = b.z + n.z * reachFront + across.z * reachAcross * a;
        if (nearGap(cx, cz, 2.2)) continue;
        block(cx, cz, 0.6, 0.6, top, 0.5, '#3a3f4a');
        decorBox(cx, top + 0.5, cz, 0.08, 0.6, 0.08, '#6a4a36');
        const g = new THREE.SphereGeometry(0.45, 10, 8);
        g.translate(cx, top + 1.35, cz);
        addDecor('#4f8f4a', g);
      }
    }
  };
  {
    const top = (path) => path[path.length - 1];
    const poles = (b) => dlZips.filter((z) => Math.abs(z.a.x - b.front.at(0, 0, 0).x) < 1).map((z) => z.a);
    roofGarden(LYCEUM, [top(ESC.lyceum), ...poles(LYCEUM)], true);
    roofGarden(ROYAL, [top(ESC.royal), ESC.fly[0], ...poles(ROYAL).filter((p) => Math.abs(p.z - ROYAL.z) < ROYAL.d / 2)], true);
    roofGarden(FORTUNE, [top(ESC.fortune), ...poles(FORTUNE).filter((p) => Math.abs(p.z - FORTUNE.z) < FORTUNE.d / 2)], true);
    roofGarden(ROYAL_FLY, [top(ESC.fly)], false);
    DLW.forEach((b) => roofGarden(b, [], false));
  }

  // Poster columns on the pavement: climb up onto the dome.
  const dlColumns = [];
  for (const z of [-51, -2, 31]) {
    const x = 139.2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 3.0, 16), worldMat('#2f5d3a'));
    col.position.set(x, 1.5, z);
    col.castShadow = col.receiveShadow = true;
    scene.add(col);
    for (const [y, c] of [[1.0, MAGENTA], [1.9, GOLD]]) {
      const band = new THREE.CylinderGeometry(0.63, 0.63, 0.7, 16);
      band.translate(x, y, z);
      addDecor(c, band);
    }
    const dome = new THREE.SphereGeometry(0.66, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.5, 1);
    dome.translate(x, 3.0, z);
    addDecor('#2f5d3a', dome);
    physics.addBox(x, 0, z, 1.2, 3.1, 1.2);
    dlColumns.push({ x, z, top: 3.1 });
  }
  [[133, -78], [133, -48], [133, 0], [133, 30]].forEach(([x, z]) => lamp(x, z));

  // Cobbles.
  {
    const tile = new THREE.BoxGeometry(1.8, 0.05, 1.8);
    const spots = [];
    for (let x = 119; x <= 177; x += 2) for (let z = -104; z <= 44; z += 2) {
      if (physics.fits(V(x, 0.01, z), 0.9, 0.04)) spots.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(tile, worldMat('#ffffff', { surface: 'plaster' }), spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#c9b7b8', '#bfa9ad', '#d3c1c0', '#b79fa6', '#cdb4b2'];
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.025, z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(tones[Math.abs(i * 7 + x * 3 + z * 13) % tones.length]));
    });
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // Fragment pool: theatre and terrace roofs, fire-escape landings, marquees, poster
  // columns and the strings across the street. Six at random each game.
  const dlPool = [];
  for (const [b, tag] of [[LYCEUM, 'lyceum'], [ROYAL, 'royal'], [FORTUNE, 'fortune'], ...DLW.map((b, i) => [b, `w${i}`])]) {
    const f = b.front;
    const t = (rng() - 0.5) * f.span * 0.5;
    dlPool.push({ kind: 'roof', tag, pos: f.at(t, b.top + 0.6, -2.2), front: f.at(t, 0, 3.6), climb: f.at(t, b.top, -2.2) });
  }
  for (const [name, path] of Object.entries(ESC)) {
    if (name === 'fly') continue; // that's the way to the lantern
    path.slice(1, -1).forEach((p, k) => {
      dlPool.push({ kind: 'landing', tag: `esc-${name}`, pos: p.clone().setY(p.y + 0.6), path: path.slice(0, k + 2) });
    });
  }
  for (const m of marquees) {
    const n = m.f.normal;
    dlPool.push({
      kind: 'sill', tag: `marquee${m.i}`, pos: m.f.at(0, m.top + 0.6, 2.2),
      ground: m.f.at(0, 0, 3.8), climb: m.f.at(0, m.top, 2.2), push: [-n.x, -n.z],
    });
  }
  for (const [i, c] of dlColumns.entries()) {
    dlPool.push({
      kind: 'sill', tag: `column${i}`, pos: V(c.x - 0.3, c.top + 0.6, c.z),
      ground: V(c.x - 2.4, 0, c.z), climb: V(c.x - 0.3, c.top, c.z), push: [1, 0],
    });
  }
  for (const zl of dlZips) {
    const mid = zl.at(0.5, V(0, 0, 0));
    dlPool.push({
      kind: 'zip', tag: `zip${zl.z}`, pos: mid.setY(mid.y - 0.42), front: zl.front, climb: zl.roofStand.clone(),
      line: zl.idx, dir: [zl.dir.x, zl.dir.z],
    });
  }
  const dlChosen = [];
  {
    const order = dlPool.map((c) => [rng(), c]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const kinds = {};
    const tags = new Set();
    for (const c of order) {
      if (dlChosen.length === 6) break;
      if ((kinds[c.kind] ?? 0) >= 2 || tags.has(c.tag)) continue;
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      tags.add(c.tag);
      dlChosen.push(c);
    }
  }

  // ---------------------------------------------------------- corner groves
  // Little round trees filling the empty corners between the terraces and the fog.
  // Every tree is merged into one mesh per colour; canopies are climbable like the
  // churchyard trees.
  {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const GREENS = ['#7fb069', '#8cc084', '#6fa860', '#9bc57a', '#86b86a'];
    const BLOSSOM = ['#f4a7b9', '#f7c873'];
    const grove = new Map();
    const add = (color, geo) => {
      if (!grove.has(color)) grove.set(color, []);
      grove.get(color).push(geo);
    };
    const puff = (color, x, y, z, r) => {
      const g = new THREE.SphereGeometry(r, 12, 9);
      g.scale(1, 0.88, 1);
      g.translate(x, y, z);
      add(color, g);
    };

    const cuteTree = (x, z) => {
      const s = 0.75 + rand() * 0.5;
      const trunkH = (1.4 + rand() * 0.8) * s;
      const trunk = new THREE.CylinderGeometry(0.16 * s, 0.24 * s, trunkH, 8);
      trunk.translate(x, trunkH / 2, z);
      add('#6a4a36', trunk);
      const leaf = rand() < 0.15 ? pick(BLOSSOM) : pick(GREENS);
      const kind = rand();
      let top;
      if (kind < 0.45) {
        // lollipop
        const r = (1.1 + rand() * 0.4) * s;
        puff(leaf, x, trunkH + r * 0.7, z, r);
        top = trunkH + r * 1.5;
      } else if (kind < 0.75) {
        // two stacked puffs
        const r = (0.95 + rand() * 0.25) * s;
        puff(leaf, x, trunkH + r * 0.6, z, r);
        puff(leaf, x + 0.1 * s, trunkH + r * 1.55, z - 0.08 * s, r * 0.72);
        top = trunkH + r * 2.15;
      } else {
        // a cluster of three
        const r = (0.75 + rand() * 0.2) * s;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + rand();
          puff(leaf, x + Math.cos(a) * r * 0.6, trunkH + r * (0.7 + (i === 0 ? 0.5 : 0)), z + Math.sin(a) * r * 0.6, r);
        }
        top = trunkH + r * 1.9;
      }
      physics.addBox(x, 0, z, 0.4 * s, trunkH, 0.4 * s, { camera: false });
      const w = 2.2 * s;
      physics.addBox(x, trunkH, z, w, top - trunkH, w, { camera: false });
    };

    // Jittered grid in each empty corner, skipping anything already standing there.
    const fill = (x0, z0, x1, z1) => {
      const step = 3.8;
      for (let x = x0; x <= x1; x += step) {
        for (let z = z0; z <= z1; z += step) {
          const p = V(x + (rand() - 0.5) * 2, 0.01, z + (rand() - 0.5) * 2);
          if (rand() < 0.15) continue; // leave a few gaps so it isn't a plantation
          if (!physics.fits(p, 1.3, 3)) continue;
          cuteTree(p.x, p.z);
        }
      }
    };
    // Kept ~3 m inside the fog walls so no canopy pokes through them.
    fill(41, -42, 45, -31); // Piazza, north-east (kept to the edge: Long Acre runs through here)
    fill(34, 32, 44, 42); // Piazza, south-east
    fill(-72, -42, -67, -33); // St Paul's, north-west
    fill(-72, 33, -67, 42); // St Paul's, south-west
    fill(-33, -42, -29, -33); // St Paul's, north-east
    fill(-33, 33, -29, 42); // St Paul's, south-east
    fill(-24, -102, -12, -91); // Seven Dials, north-west
    fill(-24, -56, -12, -48); // Seven Dials, south-west
    fill(36, -102, 45, -91); // Seven Dials, north-east
    fill(41, -57, 45, -48); // Seven Dials, south-east (clear of Long Acre)

    for (const [color, geos] of grove) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), worldMat(color));
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // ---------------------------------------------------------- fog walls
  const fogMat = new THREE.MeshBasicMaterial({
    color: '#a2aab8', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexColors: true,
  });
  // Walls thin out with height so they melt into the sky instead of ending in a hard edge.
  const fogWallGeo = (w, d) => {
    const g = new THREE.BoxGeometry(w, 40, d, 1, 10, 1);
    const pos = g.attributes.position;
    const rgba = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 20;
      rgba.set([1, 1, 1, 1 - THREE.MathUtils.smoothstep(y, 8, 38)], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    return g;
  };
  const fogWall = (x0, z0, x1, z1) => {
    const w = Math.max(1.2, Math.abs(x1 - x0));
    const d = Math.max(1.2, Math.abs(z1 - z0));
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const mesh = new THREE.Mesh(fogWallGeo(w, d), fogMat.clone());
    mesh.position.set(cx, 20, cz);
    mesh.renderOrder = 10;
    scene.add(mesh);
    const collider = physics.addBox(cx, -1, cz, w, 60, d, { climbable: false, camera: false });
    return { mesh, collider, baseOpacity: 0.55 };
  };
  const fogWalls = {
    stpauls: fogWall(-27, -45, -27, 45),
    opera: fogWall(48, -45, 48, 45),
    // Shorts Gardens, between the Opera House plaza and Neal's Yard: lighting either opens it.
    shortsGardens: fogWall(48, -45, 118, -45),
    north: fogWall(-75, -45, -27, -45),
    sdPiazza: fogWall(-27, -45, 21, -45),
    // Long Acre: from the Piazza's north-east corner (right outside the Opera House's
    // west gate) north into Seven Dials. Lighting the Piazza opens it.
    sdLongAcre: fogWall(21, -45, 48, -45),
    // Monmouth Street, between Neal's Yard and Seven Dials: lighting either opens it.
    monmouth: fogWall(48, -105, 48, -45),
    sdWest: fogWall(-27, -105, -27, -45),
    sdNorth: fogWall(-27, -105, 48, -105),
    nyNorth: fogWall(48, -105, 118, -105),
    // Into Drury Lane: Shelton Street from Neal's Yard, Russell Street from the Opera House.
    sheltonSt: fogWall(118, -105, 118, -45),
    russellSt: fogWall(118, -45, 118, 45),
    south: fogWall(-75, 45, 178, 45),
    dlNorth: fogWall(118, -105, 178, -105),
    east: fogWall(178, -105, 178, 45),
    west: fogWall(-75, -45, -75, 45),
  };

  // ---------------------------------------------------------- merge decor
  for (const { color, emissive, surface, geos } of decor.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), worldMat(color, { emissive: emissive ?? 0x000000, surface }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------------------------------------------------------- game data
  const p = (b, t, y, out) => b.at(t, y, out);
  return {
    spawn: V(0, 0.72, 15),
    lanterns: [V(0, 9.8, 0), V(-54, 17.5, 0), V(66, 14.6, -26), V(91, SIG_TOP, -96), V(SD_C.x, SD_TOP, SD_C.z), V(160, FLY_TOP, -24)],
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
      [
        V(90, FLY.top + 0.6, -28), // top of the fly tower, the highest point yet
        V(101.6, 14.9, -26), // portico pediment on Bow Street
        V(77, RUSSELL[1].top + 0.6, 36), // Russell Street roof
        V(112, BOW[3].top + 0.6, 12), // Bow Street roof
      ],
      [
        V(84, 6.2, -74), // up in the yard's tree
        V(90, NYS[2].top + 2.6, -53), // on the rooftop water tank
        V(110, NYE[0].top + 0.6, -84), // tallest east roof
        V(56, NYN[0].top + 0.6, -97), // north-west roof
        V(55, NYW[1].top + 0.6, -67), // west roof by the alley
      ],
      (opts.sdAllCandidates ? sdPool : sdChosen).map((c) => c.pos), // Seven Dials, picked at random
      (opts.dlAllCandidates ? dlPool : dlChosen).map((c) => c.pos), // Drury Lane, picked at random
    ],
    fogWalls,
    chirpLedges,
    seed,
    sevenDials: { center: SD_C, top: SD_TOP, fragments: opts.sdAllCandidates ? sdPool : sdChosen, pool: sdPool },
    drury: {
      street: DL_STREET, top: FLY_TOP, lantern: V(160, FLY_TOP, -24), escapes: ESC,
      fragments: opts.dlAllCandidates ? dlPool : dlChosen, pool: dlPool,
    },
  };
}
