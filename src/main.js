import * as THREE from 'three';
import { Physics } from './physics.js';
import { buildWorld } from './world.js';
import { Wanderer } from './wanderer.js';
import { FollowCamera } from './camera.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Game } from './game.js';
import { Sky } from './sky.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8d96a6');
scene.fog = new THREE.Fog('#8d96a6', 22, 110);

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);

const hemi = new THREE.HemisphereLight('#d6e2f5', '#7d746b', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#c9d4e6', 1.3);
const SUN_OFFSET = new THREE.Vector3(-50, 90, 36);
// The shadow box follows the view: 100 m across at 4096² (~2.4 cm per texel),
// with a soft PCF radius so cornice and awning shadows don't stair-step.
const SHADOW_HALF = 50;
const SHADOW_RES = 4096;
const SHADOW_TEXEL = (SHADOW_HALF * 2) / SHADOW_RES;
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
Object.assign(sun.shadow.camera, {
  left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 260,
});
sun.shadow.radius = 3;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Light-space basis, for snapping the shadow box to whole texels as it moves
// (otherwise every shadow edge shimmers while you walk).
const LIGHT_BASIS = new THREE.Matrix4().lookAt(SUN_OFFSET, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const LIGHT_BASIS_INV = LIGHT_BASIS.clone().invert();
const _shadowC = new THREE.Vector3();
const _view = new THREE.Vector3();

function placeSun() {
  // Centre the box a little ahead of the camera so what you look at is covered.
  camera.getWorldDirection(_view);
  _view.y = 0;
  if (_view.lengthSq() > 1e-6) _view.normalize();
  _shadowC.copy(wanderer.pos).addScaledVector(_view, SHADOW_HALF * 0.4).applyMatrix4(LIGHT_BASIS_INV);
  _shadowC.x = Math.round(_shadowC.x / SHADOW_TEXEL) * SHADOW_TEXEL;
  _shadowC.y = Math.round(_shadowC.y / SHADOW_TEXEL) * SHADOW_TEXEL;
  _shadowC.applyMatrix4(LIGHT_BASIS);
  sun.target.position.copy(_shadowC);
  sun.position.copy(_shadowC).add(SUN_OFFSET);
}

const physics = new Physics();
const world = buildWorld(scene, physics);
const audio = new AudioSys();
const wanderer = new Wanderer(scene, physics);
wanderer.spawn(world.spawn);
const input = new Input(canvas);
const follow = new FollowCamera(camera, physics);
follow.snap(wanderer);
const game = new Game({ scene, physics, world, wanderer, audio, sun, hemi });
const sky = new Sky(scene);

// ------------------------------------------------------------ pause / overlay

const overlay = document.querySelector('#overlay');
const prompt = document.querySelector('#prompt');
const pausePanel = document.querySelector('#pausePanel');
let paused = true;
let started = false;

function resume() {
  paused = false;
  overlay.classList.add('hidden');
  audio.init();
  if (!started) {
    started = true;
    wanderer.vel.y = 6; // pop out of the flower pot
  }
  if (!input.state.usingPad) canvas.requestPointerLock?.()?.catch?.(() => {});
}

function pause() {
  if (paused) return;
  paused = true;
  overlay.classList.remove('hidden');
  prompt.textContent = 'click to continue';
  pausePanel.hidden = false;
}

overlay.addEventListener('click', (e) => {
  if (e.target.closest('#pausePanel')) return;
  resume();
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !input.state.usingPad) pause();
});
document.querySelector('#sens').addEventListener('input', (e) => {
  follow.sensitivity = parseFloat(e.target.value);
});
const toggleFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
document.querySelector('#fullscreen').addEventListener('click', toggleFullscreen);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'Escape' || e.code === 'KeyP') pause();
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  game.particles.setScale((h * renderer.getPixelRatio()) / 2);
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ loop

const STEP = 1 / 120;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const inp = input.update();

  if (inp.pausePressed) paused ? resume() : pause();
  else if (paused && inp.confirmPressed) resume();

  if (!paused) {
    // Fixed physics substeps so thin ledges never get tunnelled through.
    const steps = Math.max(1, Math.ceil(dt / STEP));
    const h = dt / steps;
    const held = { ...inp, jumpPressed: false, chirpPressed: false };
    for (let i = 0; i < steps; i++) wanderer.update(h, i === 0 ? inp : held, follow.yaw);
    game.update(dt, inp);
    follow.update(dt, inp, wanderer);
  } else {
    follow.update(dt, { ...inp, mouseDX: 0, mouseDY: 0, padLook: { x: 0, y: 0 } }, wanderer);
  }
  wanderer.animate(paused ? 0 : dt, camera.position, t);

  placeSun();
  sky.update(dt, camera, scene.fog.color, game.allWoken);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) window.__lm = { wanderer, game, follow, physics, scene, camera, sky };
