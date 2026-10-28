import * as THREE from 'three';

// Shared uniforms for the "wake" colour wave. Every world material reads these,
// so lighting a lantern recolours the whole district in one place.
export const MAX_DISTRICTS = 4;

export const wakeUniforms = {
  uWakeCenter: { value: Array.from({ length: MAX_DISTRICTS }, () => new THREE.Vector3()) },
  uWakeRadius: { value: new Array(MAX_DISTRICTS).fill(0) },
  // Edge-glow colour of the travelling wave front (hue * strength).
  uWakeHue: { value: Array.from({ length: MAX_DISTRICTS }, () => new THREE.Color(0, 0, 0)) },
  // District bounds (minX, minZ, maxX, maxZ) so a wave never bleeds past its fog wall.
  uWakeBox: { value: Array.from({ length: MAX_DISTRICTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

let gradient;
export function toonGradient() {
  if (!gradient) {
    // Three flat light bands.
    gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const WAKE_VERTEX_PARS = /* glsl */ `
varying vec3 vLmWorld;
varying vec3 vLmNormal;
`;

const WAKE_VERTEX = /* glsl */ `
vec4 lmWp = vec4(transformed, 1.0);
vec3 lmN = objectNormal;
#ifdef USE_INSTANCING
  lmWp = instanceMatrix * lmWp;
  lmN = mat3(instanceMatrix) * lmN;
#endif
vLmWorld = (modelMatrix * lmWp).xyz;
vLmNormal = normalize(mat3(modelMatrix) * lmN);
`;

// Surface detail, painted in world space so it never stretches: brick or stone
// coursing, plaster grain, per-block tone, and grime (dark feet, streaks under
// ledges, shaded undersides). Snapped to a few shades so it reads as painted.
// LM_SURFACE: 0 none, 1 brick, 2 stone, 3 plaster.
export const SURFACES = { none: 0, brick: 1, stone: 2, plaster: 3 };
const LEDGE_STEP = '3.2'; // terrace cornices every 3.2 m (see world.js)

const SURFACE_PARS = /* glsl */ `
varying vec3 vLmNormal;

float lmHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmHash(i), lmHash(i + vec2(1.0, 0.0)), f.x),
             mix(lmHash(i + vec2(0.0, 1.0)), lmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float lmSurface(vec3 wp, vec3 n) {
  bool top = abs(n.y) > 0.5;
  // Face coordinates in metres: across the wall and up it (or across a roof).
  vec2 fp = top ? wp.xz : vec2(abs(n.x) > abs(n.z) ? wp.z : wp.x, wp.y);
  vec2 px = fwidth(fp); // metres per pixel: fade fine detail out with distance
  float k = 1.0;

  // Faint tonal drift across a whole building.
  k *= 0.95 + 0.1 * lmNoise(wp.xz / 14.0 + vec2(wp.y / 30.0));

#if LM_SURFACE == 1 || LM_SURFACE == 2
  if (!top) {
  #if LM_SURFACE == 1
    vec2 size = vec2(0.45, 0.2);   // 16 courses per 3.2 m storey
    float jw = 0.018;
  #else
    vec2 size = vec2(0.9, 0.4);    // 8 courses per storey
    float jw = 0.025;
  #endif
    vec2 b = fp / size;
    float row = floor(b.y);
    b.x += mod(row, 2.0) * 0.5;    // stretcher bond
    vec2 cell = floor(b);
    vec2 f = fract(b);
    // Per-block tone, snapped to three shades.
    float tone = floor(lmHash(cell + vec2(row * 17.0, 3.0)) * 3.0) * 0.5;
    k *= 0.92 + 0.1 * tone;
    // Mortar joints, antialiased, fading out once they're thinner than a pixel.
    vec2 edge = min(f, 1.0 - f) * size;
    float joint = 1.0 - smoothstep(jw - px.x, jw + px.x, edge.x) * smoothstep(jw - px.y, jw + px.y, edge.y);
    k *= 1.0 - joint * 0.25 * (1.0 - smoothstep(0.02, 0.08, max(px.x, px.y)));
  }
#endif

  // Grain, snapped to three steps.
  float g = lmNoise(fp * 7.0) * 0.6 + lmNoise(fp * 19.0) * 0.4;
  k *= 1.0 - floor(g * 3.0) / 3.0 * 0.08 * (1.0 - smoothstep(0.015, 0.06, max(px.x, px.y)));

  if (!top) {
    // Grime: darker feet where the street splashes up.
    k *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 1.6, wp.y));
    float streak = lmNoise(vec2(fp.x * 1.6, fp.y * 0.1));
  #if LM_SURFACE == 1
    // Rain streaks running down from each cornice, and a dark band right under it.
    float below = mod(${LEDGE_STEP} - 0.25 - wp.y, ${LEDGE_STEP});
    k *= 1.0 - 0.3 * smoothstep(0.4, 0.8, streak) * exp(-below / 1.4);
    k *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.3, below));
  #else
    k *= 1.0 - 0.14 * smoothstep(0.5, 0.85, streak);
  #endif
  }
  // Undersides of cornices, sills and roofs sit in shade.
  if (n.y < -0.5) k *= 0.78;
  return k;
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
#include <color_fragment>
#if LM_SURFACE > 0
  diffuseColor.rgb *= lmSurface(vLmWorld, normalize(vLmNormal));
#endif
`;

const WAKE_FRAGMENT_PARS = /* glsl */ `
varying vec3 vLmWorld;
${SURFACE_PARS}
uniform vec3 uWakeCenter[${MAX_DISTRICTS}];
uniform float uWakeRadius[${MAX_DISTRICTS}];
uniform vec3 uWakeHue[${MAX_DISTRICTS}];
uniform vec4 uWakeBox[${MAX_DISTRICTS}];

float lmBoxMask(vec4 b, vec2 p) {
  float s = 2.0;
  return smoothstep(b.x - s, b.x + s, p.x) * (1.0 - smoothstep(b.z - s, b.z + s, p.x))
       * smoothstep(b.y - s, b.y + s, p.y) * (1.0 - smoothstep(b.w - s, b.w + s, p.y));
}
`;

const WAKE_FRAGMENT = /* glsl */ `
{
  float wake = 0.0;
  vec3 edgeGlow = vec3(0.0);
  for (int i = 0; i < ${MAX_DISTRICTS}; i++) {
    float r = uWakeRadius[i];
    if (r <= 0.0) continue;
    float mask = lmBoxMask(uWakeBox[i], vLmWorld.xz);
    float d = distance(vLmWorld.xz, uWakeCenter[i].xz);
    wake = max(wake, (1.0 - smoothstep(r - 8.0, r, d)) * mask);
    float e = smoothstep(r - 3.0, r - 0.6, d) * (1.0 - smoothstep(r - 0.6, r + 0.4, d));
    edgeGlow += uWakeHue[i] * e * mask;
  }
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  vec3 asleep = vec3(lum) * vec3(0.78, 0.84, 0.97) * 0.86;
  outgoingLight = mix(asleep, outgoingLight, wake) + edgeGlow * 0.7;
}
#include <opaque_fragment>
`;

function patchWake(material, surface) {
  material.defines = { ...material.defines, LM_SURFACE: SURFACES[surface] };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wakeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAKE_VERTEX_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WAKE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WAKE_FRAGMENT_PARS)
      .replace('#include <color_fragment>', SURFACE_FRAGMENT)
      .replace('#include <opaque_fragment>', WAKE_FRAGMENT);
  };
  material.customProgramCacheKey = () => `lm-wake-${surface}`;
  return material;
}

const cache = new Map();

/**
 * Toon material for the city: starts grey, gains colour as districts wake.
 * `surface` paints world-space detail: 'brick', 'stone', 'plaster' or 'none'.
 */
export function worldMat(color, { emissive = 0x000000, surface = 'none' } = {}) {
  const key = `${color}|${emissive}|${surface}`;
  let m = cache.get(key);
  if (!m) {
    m = patchWake(new THREE.MeshToonMaterial({ color, emissive, gradientMap: toonGradient() }), surface);
    cache.set(key, m);
  }
  return m;
}

const RIM_FRAGMENT = /* glsl */ `
{
  float lmFres = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
  outgoingLight += uRimColor * smoothstep(0.55, 0.8, lmFres) * uRimStrength;
}
#include <opaque_fragment>
`;

function patchRim(material, color, strength) {
  const uniforms = {
    uRimColor: { value: new THREE.Color(color) },
    uRimStrength: { value: strength },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
      .replace('#include <opaque_fragment>', RIM_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'lm-rim';
  material.userData.rim = uniforms;
  return material;
}

/**
 * Plain toon material (always in colour) for the wanderer and lanterns.
 * Pass `rim` (strength) for a soft rim light that lifts it off the grey city.
 */
export function toonMat(color, { rim, rimColor = '#fff1d6', ...opts } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
  return rim ? patchRim(m, rimColor, rim) : m;
}

let haloTex;
export function haloTexture() {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  return haloTex;
}
