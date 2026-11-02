// A tiny critically-tuned spring engine. One shared rAF loop drives every active spring,
// so animations stay in lockstep with the display refresh rate (60/120/144 Hz alike).
// Springs are interruptible: calling .to() mid-flight keeps the current velocity.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export const SPRINGS = {
  // fast, barely any overshoot: tab movement, layout
  snappy: { stiffness: 620, damping: 48, mass: 1 },
  // slightly softer: sidebar, panels
  smooth: { stiffness: 340, damping: 36, mass: 1 },
};

const active = new Set();
let raf = 0;
let last = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  for (const s of [...active]) s.step(dt);
  raf = active.size ? requestAnimationFrame(frame) : 0;
}

function wake() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

export class Spring {
  /**
   * @param {number} value initial value
   * @param {(v:number)=>void} onUpdate called on every frame with the current value
   * @param {{stiffness:number,damping:number,mass:number}} config
   */
  constructor(value, onUpdate, config = SPRINGS.snappy) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.onUpdate = onUpdate;
    this.config = config;
    this.onSettle = null;
  }

  /** Jump without animating. */
  set(value) {
    this.value = this.target = value;
    this.velocity = 0;
    active.delete(this);
    this.onUpdate(value);
    this.onSettle?.();
  }

  /** Animate towards target, keeping whatever velocity we already have. */
  to(target) {
    this.target = target;
    if (reduceMotion.matches) return this.set(target);
    if (this.value === target && this.velocity === 0) return;
    active.add(this);
    wake();
  }

  /** Start from `from` (visual position) and animate to `target`, preserving current velocity. */
  from(from, target) {
    this.value = from;
    this.to(target);
  }

  step(dt) {
    const { stiffness, damping, mass } = this.config;
    const h = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-9) {
      const d = Math.min(h, remaining);
      const a = (-stiffness * (this.value - this.target) - damping * this.velocity) / mass;
      this.velocity += a * d;
      this.value += this.velocity * d;
      remaining -= d;
    }
    if (Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.5) {
      this.value = this.target;
      this.velocity = 0;
      active.delete(this);
      this.onUpdate(this.value);
      this.onSettle?.();
    } else {
      this.onUpdate(this.value);
    }
  }
}
