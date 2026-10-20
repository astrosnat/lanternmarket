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
`;

const WAKE_VERTEX = /* glsl */ `
vec4 lmWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  lmWp = instanceMatrix * lmWp;
#endif
vLmWorld = (modelMatrix * lmWp).xyz;
`;

const WAKE_FRAGMENT_PARS = /* glsl */ `
varying vec3 vLmWorld;
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

function patchWake(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wakeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAKE_VERTEX_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WAKE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WAKE_FRAGMENT_PARS)
      .replace('#include <opaque_fragment>', WAKE_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'lm-wake';
  return material;
}

const cache = new Map();

/** Toon material for the city: starts grey, gains colour as districts wake. */
export function worldMat(color, { emissive = 0x000000 } = {}) {
  const key = `${color}|${emissive}`;
  let m = cache.get(key);
  if (!m) {
    m = patchWake(new THREE.MeshToonMaterial({ color, emissive, gradientMap: toonGradient() }));
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
