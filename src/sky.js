import * as THREE from 'three';

// The ceiling of the sky: an all-sky fisheye photo of the Milky Way on a dome
// that follows the camera, fading into the fog towards the horizon.
// Grey while the city sleeps; it takes on colour once every fragment is woken.
//
// Photo: "Milchstraße im Internationalen Sternenpark Westhavelland" by Bautsch,
// CC0 (public domain), via Wikimedia Commons. Cropped to the sky circle, so the
// zenith is the image centre and the horizon is the inscribed circle.

const RADIUS = 400;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // sit on the far plane, behind everything
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFog;
uniform float uColour;
uniform float uLoaded;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  // Equidistant fisheye: distance from the image centre grows with angle from the zenith.
  float fromZenith = acos(clamp(d.y, -1.0, 1.0)) / 1.5707963;
  vec2 h = d.xz / max(length(d.xz), 1e-5);
  // Photo seen from below: top of the image is north (-z), right is west (-x).
  vec2 uv = 0.5 - 0.5 * min(fromZenith, 1.0) * h;
  vec3 sky = texture2D(uMap, uv).rgb;

  float grey = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  // Grey asleep; full (slightly boosted) colour once everything is woken.
  sky = max(mix(vec3(grey), sky, uColour * 1.5), 0.0);

  // Full stars down to ~9° above the horizon; only the last band blends into the fog.
  float t = smoothstep(0.0, 0.15, d.y) * uLoaded;
  gl_FragColor = vec4(mix(uFog, sky * 1.4, t), 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor(scene) {
    this.colour = 0;
    this.target = 0;
    this.uniforms = {
      uMap: { value: null },
      uFog: { value: new THREE.Color() },
      uColour: { value: 0 },
      uLoaded: { value: 0 },
    };
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}sky/milky-way.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.uniforms.uMap.value = tex;
      this.uniforms.uLoaded.value = 1;
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /** awake: true once every fragment has been woken. */
  update(dt, camera, fogColor, awake) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uFog.value.copy(fogColor);
    this.target = awake ? 1 : 0;
    this.colour += (this.target - this.colour) * (1 - Math.exp(-dt / 1.5));
    this.uniforms.uColour.value = this.colour;
  }
}
