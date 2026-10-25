// Headless playtest bot: plays the slice through the real wanderer + game code
// with the same input object the keyboard produces, and reports what happened.
//
//   node tools/playtest.mjs                  # summary, as a "runner"
//   node tools/playtest.mjs --style careful  # runner | careful | novice | stubborn
//   node tools/playtest.mjs --all            # every style, side by side
//   node tools/playtest.mjs --verbose        # every event

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
      out = execFileSync(process.execPath, [self, '--style', style, '--json'], { encoding: 'utf8' });
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
  process.exit(rows.every((r) => r.lit === '2/2' && r.blocked === 0) ? 0 : 1);
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
let learnedGlide = STYLE === 'runner';
const DT = 1 / 60;
const SUB = 2;
const LEG_TIMEOUT = 25;

// ------------------------------------------------------------------ setup

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#8d96a6', 22, 110);
scene.background = new THREE.Color();
const physics = new Physics();
const world = buildWorld(scene, physics);
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

const go = (x, z, y) => ({ kind: 'go', x, z, y });
const chirp = (hold = 1.2) => ({ kind: 'chirp', hold });
const wait = (sec) => ({ kind: 'wait', sec });
const section = (name) => ({ kind: 'section', name });
const expect = (what, check) => ({ kind: 'expect', what, check });

function runGo(leg) {
  const target = new THREE.Vector3(leg.x, leg.y ?? 0, leg.z);
  const start = t;
  let pushDir = new THREE.Vector3(leg.x - w.pos.x, 0, leg.z - w.pos.z).normalize();
  const climbDir = pushDir.clone(); // keep pushing this way to climb on up
  let checkT = t;
  let checkPos = w.pos.clone();
  let jumpNext = false;
  let jumps = 0;
  while (t - start < LEG_TIMEOUT) {
    const d = new THREE.Vector3(target.x - w.pos.x, 0, target.z - w.pos.z);
    const hd = d.length();
    const yOk = leg.y === undefined || (w.pos.y > leg.y - 0.35 && w.grounded);
    if (hd < 0.45 && yOk) {
      for (let i = 0; i < 20; i++) frame(ZERO); // settle
      return true;
    }
    if (hd > 0.3) pushDir = d.normalize();
    const wish = hd < 0.45 && !yOk ? climbDir.clone() : pushDir.clone().multiplyScalar(Math.min(1, hd / 0.6 + 0.35));
    if (w.state === 'move') wish.multiplyScalar(WALK); // walk speed on the ground; full push on walls
    frame(wish, { jump: jumpNext });
    jumpNext = false;
    if (t - checkT > 2) {
      const moved = w.pos.distanceTo(checkPos);
      if (moved < 0.25 && w.state !== 'trip') {
        jumpNext = true;
        jumps++;
        if (jumps === 1 || jumps % 3 === 0) log('stuck', `no progress at ${fmt(w.pos)} (state ${w.state}, scarf ${w.scarf.toFixed(1)}) → jump`);
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

function runChirp(leg) {
  stats.chirps++;
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
];

const wall0 = Date.now();
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
