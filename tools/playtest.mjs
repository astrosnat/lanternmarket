// Headless playtest bot: plays the slice through the real wanderer + game code
// with the same input object the keyboard produces, and reports what happened.
//
//   node tools/playtest.mjs                  # summary, as a "runner"
//   node tools/playtest.mjs --style careful  # runner | careful | novice | stubborn
//   node tools/playtest.mjs --all            # every style, side by side
//   node tools/playtest.mjs --verbose        # every event
//   node tools/playtest.mjs --seed 7         # which random Seven Dials fragments to play
//   node tools/playtest.mjs --sd-pool        # check every Seven Dials fragment spot is reachable

import * as THREE from 'three';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// How the bot plays, i.e. which kind of player it stands in for.
const STYLES = {
  runner: 'full speed, holds jump to glide on every fall',
  careful: 'walks at 60% stick and never glides, so it climbs down',
  novice: 'full speed, only glides once the scarf has unfurled by itself',
  stubborn: 'full speed, never glides',
};

if (process.argv.includes('--all')) {
  const self = fileURLToPath(import.meta.url);
  const rows = [];
  for (const style of Object.keys(STYLES)) {
    let out;
    try {
      const seedIdx = process.argv.indexOf('--seed');
      const extra = seedIdx > 0 ? ['--seed', process.argv[seedIdx + 1]] : [];
      out = execFileSync(process.execPath, [self, '--style', style, '--json', ...extra], { encoding: 'utf8' });
    } catch (e) {
      out = e.stdout;
    }
    rows.push(JSON.parse(out.trim().split(/\r?\n/).pop()));
  }
  console.log('style      lit  time   drops edgeGrabs autoGlides glide  slides blocked');
  for (const r of rows) {
    console.log(
      `${r.style.padEnd(10)} ${String(r.lit).padEnd(4)} ${(r.minutes.toFixed(1) + 'm').padEnd(6)} ` +
      `${String(r.stats.drops).padEnd(5)} ${String(r.stats.edgeGrabs).padEnd(9)} ${String(r.stats.autoGlides).padEnd(10)} ` +
      `${(r.stats.glideTime.toFixed(0) + 's').padEnd(6)} ${String(r.stats.slides).padEnd(6)} ${r.blocked}`,
    );
  }
  process.exit(rows.every((r) => r.lit.split('/')[0] === r.lit.split('/')[1] && r.blocked === 0) ? 0 : 1);
}

// Minimal DOM so materials.js can paint its halo texture.
globalThis.document ??= {
  createElement: () => ({
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
  }),
};

const { Physics } = await import('../src/physics.js');
const { buildWorld } = await import('../src/world.js');
const { Wanderer } = await import('../src/wanderer.js');
const { Game } = await import('../src/game.js');

const VERBOSE = process.argv.includes('--verbose');
const JSON_OUT = process.argv.includes('--json');
const styleArg = process.argv.indexOf('--style');
const STYLE = styleArg > 0 ? process.argv[styleArg + 1] : 'runner';
if (!STYLES[STYLE]) throw new Error(`unknown style ${STYLE}; try ${Object.keys(STYLES).join(', ')}`);
const WALK = STYLE === 'careful' ? 0.6 : 1;
const seedArg = process.argv.indexOf('--seed');
const SEED = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 1;
const SD_POOL = process.argv.includes('--sd-pool');
let learnedGlide = STYLE === 'runner';
const DT = 1 / 60;
const SUB = 2;
const LEG_TIMEOUT = 25;

// ------------------------------------------------------------------ setup

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#8d96a6', 22, 110);
scene.background = new THREE.Color();
const physics = new Physics();
const world = buildWorld(scene, physics, { seed: SEED, sdAllCandidates: SD_POOL });
const audio = new Proxy({}, { get: () => () => {} });
const w = new Wanderer(scene, physics);
w.spawn(world.spawn);
const sun = new THREE.DirectionalLight();
const hemi = new THREE.HemisphereLight();
const game = new Game({ scene, physics, world, wanderer: w, audio, sun, hemi });

let t = 0;
const events = [];
const stats = {
  trips: 0, bigFalls: 0, drops: 0, slides: 0, glideTime: 0, chirps: 0, hiccups: 0,
  edgeGrabs: 0, autoGlides: 0, teleports: 0,
};
const log = (kind, msg) => {
  const line = `${t.toFixed(1).padStart(6)}s  ${kind.padEnd(9)} ${msg}`;
  events.push({ t, kind, msg, line });
  if (!JSON_OUT && (VERBOSE || ['BLOCKED', 'DROP', 'LIT', 'SECTION', 'NOTE'].includes(kind))) console.log(line);
};
const fmt = (v) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;

const hooks = w.hooks;
w.hooks = {
  ...hooks,
  onLand: (fall, impact) => {
    if (fall > 2) log('land', `fall ${fall.toFixed(1)} m at ${fmt(w.pos)}`);
    if (fall > 6.5) stats.bigFalls++;
    hooks.onLand(fall, impact);
  },
  onTrip: () => { stats.trips++; log('trip', `at ${fmt(w.pos)}`); hooks.onTrip(); },
  onMantle: () => log('mantle', `onto y=${w.pos.y.toFixed(2)}`),
  onEdgeGrab: () => { stats.edgeGrabs++; log('edgegrab', `hanging at ${fmt(w.pos)} to climb down`); },
  onAutoGlide: () => {
    stats.autoGlides++;
    log('autoglide', `scarf unfurled by itself at ${fmt(w.pos)}, carrying ${game.carried.length}`);
    if (STYLE === 'novice') learnedGlide = true;
    hooks.onAutoGlide();
  },
};
const drop = game.dropFragments.bind(game);
game.dropFragments = () => {
  const n = game.carried.length;
  if (n) { stats.drops++; log('DROP', `${n} fragment(s) dropped after a big fall at ${fmt(w.pos)}`); }
  drop();
};
const onDeposited = game.onDeposited.bind(game);
game.onDeposited = (f) => {
  onDeposited(f);
  const d = game.districts[f.district];
  log('deposit', `${d.name}: ${d.fill}/${d.needed}`);
  if (d.lit) log('LIT', `${d.name} wakes up`);
};
const onPickup = game.fragCtx.onPickup;
game.fragCtx.onPickup = (f) => { log('pickup', `fragment at ${fmt(f.home)} (district ${f.district})`); onPickup(f); };
const onWake = game.fragCtx.onWake;
game.fragCtx.onWake = (f) => { log('wake', `fragment at ${fmt(f.home)} (district ${f.district})`); onWake(f); };
const origHiccup = w.hiccup.bind(w);
w.hiccup = () => { stats.hiccups++; log('hiccup', ''); origHiccup(); };

// ------------------------------------------------------------------ input + stepping

const inp = {
  move: { x: 0, y: 0 }, padLook: { x: 0, y: 0 }, mouseDX: 0, mouseDY: 0,
  jumpHeld: false, jumpPressed: false, chirpHeld: false, chirpPressed: false,
  pausePressed: false, confirmPressed: false, usingPad: false,
};
let prevJump = false;
let prevChirp = false;
let slideArmed = true;

/** One frame, mirroring main.js. Camera yaw is fixed at 0, so move.y = -z. */
function frame(wish, { jump = false, chirp = false } = {}) {
  inp.move.x = wish.x;
  inp.move.y = -wish.z;
  // A player who knows about gliding holds jump whenever falling.
  const glide = learnedGlide && w.state === 'move' && !w.grounded && w.vel.y < -1;
  const jumpHeld = jump || glide;
  inp.jumpPressed = jumpHeld && !prevJump;
  inp.jumpHeld = jumpHeld;
  inp.chirpPressed = chirp && !prevChirp;
  inp.chirpHeld = chirp;
  prevJump = jumpHeld;
  prevChirp = chirp;
  const held = { ...inp, jumpPressed: false, chirpPressed: false };
  for (let i = 0; i < SUB; i++) w.update(DT / SUB, i === 0 ? inp : held, 0);
  game.update(DT, inp);
  if (w.gliding) stats.glideTime += DT;
  // Count each time the scarf runs dry mid-climb (re-arm once it has refilled).
  if (w.state === 'climb' && w.scarf <= 0 && slideArmed) {
    stats.slides++;
    slideArmed = false;
    log('slide', `scarf ran out climbing at ${fmt(w.pos)}`);
  } else if (w.scarf > 1) slideArmed = true;
  t += DT;
}

const ZERO = new THREE.Vector3();

// ------------------------------------------------------------------ legs

// push: optional [x, z] to push along once there (e.g. straight into a column to climb it).
const go = (x, z, y, push) => ({ kind: 'go', x, z, y, push });
const chirp = (hold = 1.2) => ({ kind: 'chirp', hold });
const wait = (sec) => ({ kind: 'wait', sec });
const section = (name) => ({ kind: 'section', name });
const expect = (what, check) => ({ kind: 'expect', what, check });
// Jump off the roof along a string of lights and ride it down.
const zip = (dir) => ({ kind: 'zip', dir });
// Walk back into the Seven Dials circus along whichever street you're in.
const toCircus = () => ({ kind: 'toCircus' });

function runGo(leg) {
  const target = new THREE.Vector3(leg.x, leg.y ?? 0, leg.z);
  const start = t;
  let pushDir = new THREE.Vector3(leg.x - w.pos.x, 0, leg.z - w.pos.z).normalize();
  const climbDir = leg.push ? new THREE.Vector3(leg.push[0], 0, leg.push[1]).normalize() : pushDir.clone(); // keep pushing this way to climb on up
  let checkT = t;
  let checkPos = w.pos.clone();
  let jumpNext = false;
  let jumps = 0;
  while (t - start < LEG_TIMEOUT) {
    const d = new THREE.Vector3(target.x - w.pos.x, 0, target.z - w.pos.z);
    const hd = d.length();
    const yOk = leg.y === undefined || (w.pos.y > leg.y - 0.35 && w.grounded);
    // A plain "go here" isn't done while still gliding overhead: land first.
    const settled = leg.y !== undefined || w.grounded || w.state !== 'move';
    if (hd < 0.45 && yOk && settled) {
      for (let i = 0; i < 20; i++) frame(ZERO); // settle
      return true;
    }
    if (hd > 0.3) pushDir = d.normalize();
    // Close enough to start climbing? (Legs with an explicit push may climb a little way off the target.)
    const near = hd < (leg.push ? 0.9 : 0.45);
    const wish = near && !yOk ? climbDir.clone() : pushDir.clone().multiplyScalar(Math.min(1, hd / 0.6 + 0.35));
    if (w.state === 'move') wish.multiplyScalar(WALK); // walk speed on the ground; full push on walls
    frame(wish, { jump: jumpNext });
    jumpNext = false;
    if (t - checkT > 2) {
      const moved = w.pos.distanceTo(checkPos);
      if (moved < 0.25 && w.state !== 'trip') {
        jumpNext = true;
        jumps++;
        if (jumps === 1 || jumps % 3 === 0) log('stuck', `no progress at ${fmt(w.pos)} (state ${w.state}, scarf ${w.scarf.toFixed(1)}) → jump${process.env.DBG ? ` wish=${fmt(wish)} grounded=${w.grounded} ground=${w.groundC ? fmt(w.groundC.min) + "→" + fmt(w.groundC.max) : "-"} wall=${w.wallC ? fmt(w.wallC.min) : "-"}` : ""}`);
      }
      checkT = t;
      checkPos.copy(w.pos);
    }
  }
  stats.teleports++;
  log('BLOCKED', `could not reach ${fmt(target)} from ${fmt(w.pos)} (state ${w.state}, scarf ${w.scarf.toFixed(1)}/${w.scarfMax}); teleporting to keep testing`);
  w.pos.copy(target);
  w.vel.set(0, 0, 0);
  w.state = 'move';
  for (let i = 0; i < 30; i++) frame(ZERO);
  return false;
}

function runZip(leg) {
  const wish = new THREE.Vector3(leg.dir[0], 0, leg.dir[1]);
  let rode = false;
  // Back up a step, then run at the pole and jump, like a player would.
  for (let i = 0; i < 20; i++) frame(wish.clone().negate().multiplyScalar(0.5));
  for (let i = 0; i < 60 * 15; i++) {
    frame(rode ? ZERO : wish, { jump: i === 14 });
    if (w.state === 'zip') rode = true;
    if (rode && w.state !== 'zip' && w.grounded) {
      log('zip', `rode a string of lights down to ${fmt(w.pos)}`);
      return;
    }
  }
  log('NOTE', `didn't catch the string from ${fmt(w.pos)}`);
}

function runChirp(leg) {
  stats.chirps++;
  // A tripping wanderer can't chirp; wait until it's back on its feet, as a player would.
  while (w.state === 'trip') frame(ZERO);
  const before = game.fragments.filter((f) => f.state === 'sleep').length;
  const frames = Math.max(1, Math.round(leg.hold / DT));
  for (let i = 0; i < frames; i++) frame(ZERO, { chirp: true });
  frame(ZERO);
  for (let i = 0; i < 40; i++) frame(ZERO);
  const woke = before - game.fragments.filter((f) => f.state === 'sleep').length;
  log('chirp', `hold ${leg.hold}s at ${fmt(w.pos)}: woke ${woke}, carrying ${game.carried.length}`);
}

const results = [];
function runRoute(route) {
  for (const leg of route) {
    if (leg.kind === 'section') { log('SECTION', leg.name); continue; }
    if (leg.kind === 'go') runGo(leg);
    if (leg.kind === 'chirp') runChirp(leg);
    if (leg.kind === 'zip') runZip(leg);
    if (leg.kind === 'toCircus') {
      const C = world.sevenDials.center;
      const step = (Math.PI * 2) / 7;
      const th = Math.round(Math.atan2(w.pos.z - C.z, w.pos.x - C.x) / step) * step;
      const r = Math.hypot(w.pos.x - C.x, w.pos.z - C.z);
      if (r > 9) {
        runGo(go(C.x + Math.cos(th) * Math.min(r, 30), C.z + Math.sin(th) * Math.min(r, 30)));
        runGo(go(C.x + Math.cos(th) * 7.5, C.z + Math.sin(th) * 7.5));
      }
    }
    if (leg.kind === 'wait') for (let i = 0; i < leg.sec / DT; i++) frame(ZERO);
    if (leg.kind === 'expect') {
      const ok = leg.check();
      results.push({ what: leg.what, ok });
      log(ok ? 'ok' : 'NOTE', `${ok ? '✓' : '✗'} ${leg.what}`);
    }
  }
}

// ------------------------------------------------------------------ the slice

const carrying = (n) => () => game.carried.length >= n;
const INTO_COLUMN = [-1, 0]; // the sundial pillar's east face
const lit = (i) => () => game.districts[i].lit;

// Up the market's south face, over the glass roof, onto the ridge by the lantern.
const toLantern0 = [go(-3, 9.6), go(-3, 0, 9.8), go(-1.6, 0), chirp(0.3), wait(2.5)];

const ROUTE = [
  section('Opening: pop out of the flower pot'),
  wait(1.5),
  go(-6, 10.5),
  chirp(),
  section('Fragment 1: market glass roof'),
  go(-12, 4, 8.4),
  wait(0.5),
  expect('picked up the glass-roof fragment', carrying(1)),
  go(-3, 0, 9.8),
  go(-1.6, 0),
  chirp(0.3),
  wait(2.5),

  section('Fragment 5: on top of a lamp post'),
  go(-1.6, 3),
  go(10, 11),
  go(19, 16.5),
  chirp(),
  go(20, 17.2),
  go(20, 18, 4.5),
  wait(0.5),
  expect('picked up the lamp fragment', carrying(1)),

  section('Fragment 4: south terrace roof'),
  go(14, 22),
  go(10, 28),
  chirp(),
  go(10, 38, 9.35),
  wait(0.5),
  expect('carrying lamp + south-roof fragments', carrying(2)),
  go(10, 27),
  ...toLantern0,

  section('Fragment 3: high cornice on the east terrace'),
  go(6, 0),
  go(20, -10),
  go(29, -4),
  chirp(),
  go(31.65, -4, 9.6),
  wait(0.5),
  expect('picked up the east-cornice fragment', carrying(1)),

  section('Fragment 2: tallest north roof'),
  go(28, -4),
  go(10, -20),
  go(-4, -27),
  go(-4, -38, 6.4),
  chirp(),
  go(-4, -38, 14.35),
  wait(0.5),
  expect('carrying east-cornice + north-roof fragments', carrying(2)),
  go(-4, -27),
  go(-3, -10),
  go(-3, -8.5),
  go(-3, 0, 9.8),
  go(-1.6, 0),
  chirp(0.3),
  wait(3),
  expect('Piazza lantern lit', lit(0)),
  wait(6),
  expect("fog wall to St Paul's has dissolved", () => !world.fogWalls.stpauls.collider.enabled),
  expect('fog wall to the Opera House has dissolved too', () => !world.fogWalls.opera.collider.enabled),
  expect('Long Acre into Seven Dials has opened too', () => !world.fogWalls.sdLongAcre.collider.enabled),

  section('Long Acre: from the Piazza straight into Seven Dials, and back'),
  go(0, -10),
  go(28, -27),
  go(36, -38),
  go(36, -43),
  go(30, -52),
  expect('standing in Seven Dials, straight from the Piazza', () => game.districtAt(w.pos.x, w.pos.z) === 4),
  go(36, -43),
  go(28, -27),
  go(0, -10),

  section("St Paul's: up the portico"),
  go(-10, 0, 9.8),
  go(-26, 0),
  go(-29, 0),
  chirp(),
  go(-30, 2.2),
  go(-33.2, 2.2, 10.4),
  go(-33.2, 0, 11.6),
  wait(0.5),
  expect('picked up the pediment fragment', carrying(1)),

  section("St Paul's: along the church ridge"),
  go(-36.5, 0, 12),
  go(-40, 0, 14),
  go(-49, 3),
  chirp(),
  go(-58, 3),
  go(-58, 0),
  wait(0.5),
  expect('carrying pediment + ridge fragments', carrying(2)),

  section("St Paul's: churchyard terrace roof"),
  go(-62, -6),
  go(-62, -19),
  chirp(),
  go(-62, -27, 9.35),
  wait(0.5),
  expect('carrying all three St Paul\'s fragments', carrying(3)),

  section("St Paul's: the bell turret lantern"),
  go(-62, -19),
  go(-45, -12),
  go(-45, -8, 12),
  go(-45, 0, 14),
  go(-50, 0),
  go(-53, 0, 17.5),
  chirp(0.3),
  wait(3),
  expect("St Paul's lantern lit", lit(1)),

  section('Opera House: back through the Piazza and the north-east alley'),
  go(-45, -12),
  go(-26, -12),
  go(28, -27),
  go(31, -29.5),
  go(46, -29.5),
  go(50, -14),

  section('Opera House: up the Floral Hall and over onto the Opera House roof'),
  go(66, -14),
  go(66, -26, 9),
  go(63, -26, 14.6),
  go(83, -26, 18.35),
  // Round the fly tower (not over it) to the roof strip beside Bow Street:
  // one chirp there reaches both the fly-tower top and the portico.
  go(83, -41),
  go(97.5, -41),
  go(97.5, -28),
  chirp(),

  section('Opera House: the fly tower'),
  go(90, -28, 30.7),
  wait(0.5),
  expect('picked up the fly-tower fragment', carrying(1)),

  section('Opera House: the Bow Street portico'),
  go(101.6, -26, 14.3),
  wait(0.5),
  expect('carrying fly-tower + portico fragments', carrying(2)),

  section('Opera House: Bow Street roof'),
  go(105, -10),
  go(105, 12),
  go(112, 12, 6.4),
  chirp(),
  go(112, 12, 13.35),
  wait(0.5),
  expect('carrying three Opera House fragments', carrying(3)),

  section('Opera House: Russell Street roof'),
  go(104, 24),
  go(77, 25),
  go(77, 36, 6.4),
  chirp(),
  go(77, 36, 13.35),
  wait(0.5),
  expect('carrying all four Opera House fragments', carrying(4)),

  section('Opera House: the lantern on the Floral Hall crown'),
  go(77, 24),
  go(66, -14),
  go(66, -26, 9),
  go(63, -26, 14.6),
  go(64.6, -26),
  chirp(0.3),
  wait(3),
  expect('Opera House lantern lit', lit(2)),
  wait(6),
  expect("fog wall to Neal's Yard has dissolved", () => !world.fogWalls.nealsyard.collider.enabled),

  section('Long Acre: out of the Opera House west gate and into Seven Dials'),
  go(46, -38),
  go(36, -43),
  go(30, -52),
  expect('standing in Seven Dials, straight from the Opera House', () => game.districtAt(w.pos.x, w.pos.z) === 4),
  go(36, -43),

  section("Neal's Yard: down off the Floral Hall and up the Shorts Gardens alley"),
  go(64, -40),
  go(64, -62),
  go(80, -75),
  chirp(),

  section("Neal's Yard: up the yard's tree"),
  go(84, -71),
  go(84, -74, 5.6),
  wait(0.5),
  expect("picked up the tree fragment", carrying(1)),

  section("Neal's Yard: tallest east roof"),
  go(100, -82),
  go(110, -82, 14.35),
  chirp(),
  go(110, -84, 14.35),
  wait(0.5),
  expect("carrying tree + east-roof fragments", carrying(2)),

  section("Neal's Yard: north-west roof"),
  go(70, -86),
  go(58, -88),
  go(58, -94, 13.35),
  chirp(),
  go(56, -97, 13.35),
  wait(0.5),
  expect("carrying three Neal's Yard fragments", carrying(3)),

  section("Neal's Yard: west roof by the alley"),
  go(58, -88),
  go(66, -67),
  go(55, -67, 12.35),
  chirp(),
  wait(0.5),
  expect("carrying four Neal's Yard fragments", carrying(4)),

  section("Neal's Yard: the rooftop water tank"),
  go(66, -67),
  go(88, -64),
  go(88, -56, 11.35),
  chirp(),
  go(90, -53, 13.35),
  wait(0.5),
  expect("carrying all five Neal's Yard fragments", carrying(5)),

  section("Neal's Yard: up the window boxes to the lantern"),
  go(88, -64),
  go(91, -88),
  go(91, -94.5, 20.35),
  chirp(0.3),
  wait(3),
  expect("Neal's Yard lantern lit", lit(3)),
  wait(6),
  expect('Monmouth Street into Seven Dials has opened', () => !world.fogWalls.monmouth.collider.enabled),

  section('Seven Dials: out of the yard along Monmouth Street'),
  go(91, -88),
  go(66, -72),
  go(49, -72),
  go(36, -72),
  go(21, -72),
  ...sevenDialsFragments(),

  section('Seven Dials: the sundial pillar (chirp to bring out its ledges)'),
  go(20, -72),
  wait(2), // land and settle before walking up the steps
  go(13.4, -72),
  go(12.0, -72), // on the steps, just short of the column
  chirp(),
  go(11.15, -72, 5.35, INTO_COLUMN),
  go(11.15, -72, 10.35, INTO_COLUMN),
  chirp(),
  go(11.15, -72, 15.35, INTO_COLUMN),
  go(11.15, -72, 20.35, INTO_COLUMN),
  chirp(),
  go(11.15, -72, 24.85, INTO_COLUMN),
  go(11.2, -72, world.sevenDials.top, INTO_COLUMN),
  chirp(0.3),
  wait(3),
  expect('Seven Dials lantern lit', lit(4)),
  wait(6),
  expect('shortcut from Seven Dials into the Piazza has opened', () => !world.fogWalls.sdPiazza.collider.enabled),
];

/** The legs to fetch one Seven Dials fragment, whatever kind of spot it's on. */
function sevenDialsLegs(c) {
  const C = world.sevenDials.center;
  // Out of the circus along the nearest of the seven streets, as far as the spot,
  // so the bot never cuts across a building.
  const via = (p) => {
    const step = (Math.PI * 2) / 7;
    const th = Math.round(Math.atan2(p.z - C.z, p.x - C.x) / step) * step;
    const R = Math.min(30, Math.hypot(p.x - C.x, p.z - C.z));
    return [go(C.x + Math.cos(th) * 7.5, C.z + Math.sin(th) * 7.5), go(C.x + Math.cos(th) * R, C.z + Math.sin(th) * R)];
  };
  switch (c.kind) {
    case 'roof':
      return [...via(c.front), go(c.front.x, c.front.z), go(c.climb.x, c.climb.z, c.climb.y), chirp()];
    case 'sill':
      return [...via(c.ground), go(c.ground.x, c.ground.z), go(c.climb.x, c.climb.z, c.climb.y, c.push), chirp()];
    case 'tree':
      return [...via(c.ground), go(c.ground.x, c.ground.z), go(c.climb.x, c.climb.z, c.climb.y, c.push),
        go(c.top.x, c.top.z, c.top.y), chirp()];
    case 'zip':
      return [...via(c.front), go(c.front.x, c.front.z), go(c.climb.x, c.climb.z, c.climb.y), chirp(), zip(c.dir)];
    default:
      throw new Error(`unknown spot ${c.kind}`);
  }
}

/** All six of this game's Seven Dials fragments, in order round the circus. */
function sevenDialsFragments() {
  const C = world.sevenDials.center;
  const ang = (c) => Math.atan2(c.pos.z - C.z, c.pos.x - C.x);
  const order = [...world.sevenDials.fragments].sort((p, q) => ang(p) - ang(q));
  return order.flatMap((c, i) => [
    section(`Seven Dials: fragment ${i + 1} of ${order.length} (${c.kind})`),
    toCircus(),
    ...sevenDialsLegs(c),
    wait(0.5),
    expect(`carrying ${i + 1} Seven Dials fragment(s)`, carrying(i + 1)),
  ]);
}

const wall0 = Date.now();
if (SD_POOL) {
  // Light the four earlier districts and open their walls, then try every candidate spot.
  for (const i of [0, 1, 2, 3]) game.lightDistrict(game.districts[i]);
  // --scarf 9: arrive with less (e.g. only the Piazza and the Opera House lit).
  const scarfArg = process.argv.indexOf('--scarf');
  if (scarfArg > 0) w.scarfMax = Number(process.argv[scarfArg + 1]);
  for (const k of ['stpauls', 'opera', 'nealsyard', 'monmouth', 'sdLongAcre']) {
    world.fogWalls[k].collider.enabled = false;
    world.fogWalls[k].mesh.visible = false;
  }
  const C = world.sevenDials.center;
  const frags = game.fragments.filter((f) => f.district === 4);
  const res = {};
  const fails = [];
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg > 0 ? process.argv[onlyArg + 1] : null; // e.g. --only tree
  const nearArg = process.argv.indexOf('--near');
  const near = nearArg > 0 ? process.argv[nearArg + 1].split(',').map(Number) : null; // e.g. --near 27.4,-56.5
  world.sevenDials.fragments.forEach((c, i) => {
    if (only && c.kind !== only) return;
    if (near && Math.hypot(c.pos.x - near[0], c.pos.z - near[1]) > 0.3) return;
    // Only the spot under test is live; the others are out of play so they can't be scooped up.
    frags.forEach((f, j) => {
      f.state = j === i ? 'sleep' : 'deposited';
      f.group.visible = j === i;
      f.pos.copy(f.home);
    });
    const d = new THREE.Vector3(c.pos.x - C.x, 0, c.pos.z - C.z).normalize();
    w.spawn(new THREE.Vector3(C.x + d.x * 7.5, 0.01, C.z + d.z * 7.5));
    w.scarf = w.scarfMax;
    const tp = stats.teleports;
    runRoute(sevenDialsLegs(c));
    for (let j = 0; j < 30; j++) frame(ZERO);
    const ok = frags[i].state === 'carried' && stats.teleports === tp;
    res[c.kind] ??= { ok: 0, n: 0 };
    res[c.kind].n++;
    if (ok) res[c.kind].ok++;
    else fails.push(`${c.kind} ${c.tag} at ${fmt(c.pos)}`);
  });
  console.log(`\nSeven Dials fragment spots reachable (scarf ${w.scarfMax}):`);
  for (const [k, r] of Object.entries(res)) console.log(`  ${k.padEnd(5)} ${r.ok}/${r.n}`);
  if (fails.length) console.log(`Unreachable:\n  ${fails.join('\n  ')}`);
  process.exit(fails.length ? 1 : 0);
}
runRoute(ROUTE);

const blocked = events.filter((e) => e.kind === 'BLOCKED');
if (JSON_OUT) {
  const lit = game.districts.filter((d) => d.lit).length;
  console.log(JSON.stringify({ style: STYLE, lit: `${lit}/${game.districts.length}`, minutes: t / 60, stats, blocked: blocked.length }));
  process.exit(0);
}

// ------------------------------------------------------------------ report

console.log(`\n================ PLAYTEST REPORT (${STYLE}: ${STYLES[STYLE]}) ================`);
console.log(`Slice time (bot, no exploring): ${(t / 60).toFixed(1)} min`);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.what}`);
console.log('\nStats');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(10)} ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) + ' s' : v}`);
if (blocked.length) {
  console.log('\nBlockers');
  for (const b of blocked) console.log('  ' + b.line);
}
const stuck = events.filter((e) => e.kind === 'stuck');
if (stuck.length) {
  console.log('\nStuck moments (bot jumped to free itself)');
  for (const s of stuck) console.log('  ' + s.line);
}
console.log(`\n(simulated in ${((Date.now() - wall0) / 1000).toFixed(1)} s real time)`);
process.exit(results.every((r) => r.ok) && !blocked.length ? 0 : 1);
