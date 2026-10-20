// Keyboard + mouse + gamepad, merged into one per-frame state object.

const DEADZONE = 0.18;
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function deadzone(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * s, y * s];
}

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.prev = { jump: false, chirp: false, start: false, confirm: false };
    this.state = {
      move: { x: 0, y: 0 },
      padLook: { x: 0, y: 0 },
      mouseDX: 0, mouseDY: 0,
      jumpHeld: false, jumpPressed: false,
      chirpHeld: false, chirpPressed: false,
      pausePressed: false, confirmPressed: false,
      usingPad: false,
    };

    addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
  }

  key(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  update() {
    const s = this.state;
    let mx = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    let my = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    const km = Math.hypot(mx, my);
    if (km > 1) { mx /= km; my /= km; }

    let jump = this.key('Space');
    let chirp = this.key('KeyE');
    let start = false;
    let confirm = false;
    s.padLook.x = s.padLook.y = 0;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (pad) {
      const [lx, ly] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const [rx, ry] = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      if (Math.hypot(lx, ly) > Math.hypot(mx, my)) { mx = lx; my = -ly; s.usingPad = true; }
      s.padLook.x = rx;
      s.padLook.y = ry;
      const b = (i) => !!pad.buttons[i]?.pressed;
      jump ||= b(0);
      chirp ||= b(2) || b(1);
      start = b(9);
      confirm = b(0);
      if (b(0) || b(2) || rx || ry) s.usingPad = true;
    }
    if (km > 0 || this.mouseDX || this.mouseDY) s.usingPad = false;

    s.move.x = mx;
    s.move.y = my;
    s.mouseDX = this.mouseDX;
    s.mouseDY = this.mouseDY;
    s.jumpPressed = jump && !this.prev.jump;
    s.chirpPressed = chirp && !this.prev.chirp;
    s.jumpHeld = jump;
    s.chirpHeld = chirp;
    s.pausePressed = start && !this.prev.start;
    s.confirmPressed = confirm && !this.prev.confirm;
    this.prev.jump = jump;
    this.prev.chirp = chirp;
    this.prev.start = start;
    this.prev.confirm = confirm;
    this.mouseDX = this.mouseDY = 0;
    return s;
  }
}
