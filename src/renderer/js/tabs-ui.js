import { h } from './dom.js';
import { icon } from './icons.js';
import { Spring, SPRINGS } from './spring.js';

const DRAG_THRESHOLD = 5;

/**
 * Renders the tab list into a horizontal strip or a vertical sidebar.
 *  - Spring-driven open/close (size + opacity)
 *  - FLIP + spring for every reorder, so neighbours glide instead of jumping
 *  - Pointer-driven drag to reorder, interruptible at any moment
 * The main process remains the source of truth; this only presents it.
 */
export class TabList {
  constructor({ onActivate, onClose, onMove, onMenu }) {
    Object.assign(this, { onActivate, onClose, onMove, onMenu });
    this.items = new Map(); // id -> { el, grow: Spring, fx: Spring, fy: Spring, dx, dy, info }
    this.container = null;
    this.axis = 'x';
    this.drag = null;
    this.pending = null;
    this.rowHeight = 34; // vertical-mode row height, set by the host from the layout metrics
  }

  /** (Re)attach to a container. Switching orientation drops all elements; they re-enter without animation. */
  mount(container, axis) {
    if (this.container === container && this.axis === axis) return;
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
    this.container = container;
    this.axis = axis;
  }

  render(tabs, activeId) {
    if (this.drag) {
      this.pending = { tabs, activeId };
      for (const t of tabs) this.items.get(t.id) && this.#update(this.items.get(t.id), t, t.id === activeId);
      return;
    }
    this.pending = null;
    const first = this.items.size === 0;
    const before = this.#measure();

    const ids = new Set(tabs.map((t) => t.id));
    for (const [id, it] of this.items) if (!ids.has(id) && !it.leaving) this.#leave(it);

    for (const t of tabs) {
      let it = this.items.get(t.id);
      if (!it) it = this.#create(t, !first);
      this.#update(it, t, t.id === activeId);
    }

    // Put elements in state order, skipping those that are animating out.
    let ref = this.container.firstElementChild;
    for (const t of tabs) {
      const el = this.items.get(t.id).el;
      while (ref && ref !== el && this.items.get(ref.dataset.id)?.leaving) ref = ref.nextElementSibling;
      if (ref === el) ref = ref.nextElementSibling;
      else this.container.insertBefore(el, ref);
    }
    this.#flip(before);
  }

  // ---- element lifecycle -------------------------------------------------------------------

  #create(info, animate) {
    const el = h('div', { class: 'tab', role: 'tab', tabIndex: 0, dataset: { id: info.id } });
    const it = { el, info, leaving: false, dx: 0, dy: 0 };
    it.grow = new Spring(animate ? 0 : 1, (t) => this.#applyGrow(it, t), SPRINGS.snappy);
    it.fx = new Spring(0, (v) => ((it.dx = v), this.#applyTransform(it)), SPRINGS.snappy);
    it.fy = new Spring(0, (v) => ((it.dy = v), this.#applyTransform(it)), SPRINGS.snappy);
    this.items.set(info.id, it);

    el.addEventListener('pointerdown', (e) => this.#pointerDown(e, it));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onActivate(it.info.id); } if (e.key === 'Delete') this.onClose(it.info.id); });
    el.addEventListener('auxclick', (e) => e.button === 1 && (e.preventDefault(), this.onClose(it.info.id)));
    el.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
    el.addEventListener('contextmenu', (e) => (e.preventDefault(), this.onMenu(it.info.id, e.clientX, e.clientY)));

    this.container.append(el);
    this.#applyGrow(it, it.grow.value);
    if (animate) it.grow.to(1);
    return it;
  }

  #update(it, info, active) {
    it.info = info;
    const el = it.el;
    if (!it.leaving) this.#applyGrow(it, it.grow.value); // picks up pin / density changes
    el.classList.toggle('pinned', info.pinned);
    el.classList.toggle('crashed', info.crashed);
    el.setAttribute('aria-selected', String(active));
    el.title = info.crashed ? `${info.title} (crashed, reload to recover)` : info.title;

    let titleEl = el.querySelector('.tab-title');
    if (!titleEl) {
      const close = h('button', { class: 'tab-close', 'aria-label': 'Close tab', tabIndex: -1 }, icon('close'));
      close.addEventListener('pointerdown', (e) => e.stopPropagation());
      close.addEventListener('click', (e) => (e.stopPropagation(), this.onClose(it.info.id)));
      titleEl = h('span', { class: 'tab-title' });
      el.append(h('span', { class: 'tab-icon' }), titleEl, close);
    }
    if (titleEl.textContent !== info.title) titleEl.textContent = info.title;

    const iconEl = el.querySelector('.tab-icon');
    const key = info.crashed ? 'crash' : info.loading ? 'load' : info.favicon ? `img:${info.favicon}` : 'globe';
    if (iconEl.dataset.key !== key) {
      iconEl.dataset.key = key;
      iconEl.replaceChildren(
        key === 'crash'
          ? icon('warning')
          : key === 'load'
            ? h('span', { class: 'spinner' })
            : key === 'globe'
              ? icon('globe')
              : h('img', { src: info.favicon, alt: '', draggable: false, onerror: (e) => e.target.replaceWith(icon('globe')) }),
      );
    }
  }

  #leave(it) {
    it.leaving = true;
    it.el.classList.add('leaving');
    it.grow.onSettle = () => {
      it.el.remove();
      this.items.delete(it.info.id);
    };
    it.grow.to(0);
  }

  /** Size/opacity of an entering or leaving tab, 0..1. */
  #applyGrow(it, t) {
    const s = it.el.style;
    t = Math.max(0, t);
    s.opacity = String(Math.min(1, t));
    if (this.axis === 'x') {
      if (it.info.pinned) s.flex = `0 0 ${36 * t}px`;
      else {
        s.flex = `1 1 ${180 * t}px`;
        s.minWidth = t < 1 ? '0px' : '';
      }
    } else {
      s.height = `${this.rowHeight * t}px`;
    }
  }

  #applyTransform(it) {
    const x = it.dx + (it.dragX ?? 0);
    const y = it.dy + (it.dragY ?? 0);
    it.el.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : '';
  }

  // ---- FLIP --------------------------------------------------------------------------------

  #measure(skip) {
    const out = new Map();
    for (const [id, it] of this.items) {
      if (it === skip) continue;
      const r = it.el.getBoundingClientRect();
      out.set(it, { x: r.left, y: r.top });
    }
    return out;
  }

  /** After a DOM change, spring every moved element from where it was to where it now is. */
  #flip(before, skip) {
    for (const [it, b] of before) {
      if (it === skip) continue;
      const r = it.el.getBoundingClientRect();
      // r includes the current spring offset; subtract it to get the natural layout position
      const ax = r.left - it.dx;
      const ay = r.top - it.dy;
      const dx = b.x - ax;
      const dy = b.y - ay;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      if (this.axis === 'x') it.fx.from(dx, 0);
      else it.fy.from(dy, 0);
      if (this.axis === 'x') it.fy.set(0);
      else it.fx.set(0);
    }
  }

  // ---- drag to reorder ---------------------------------------------------------------------

  #pointerDown(e, it) {
    if (e.button !== 0 || it.leaving) return;
    this.onActivate(it.info.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const el = it.el;
    const grab = { x: startX - el.getBoundingClientRect().left, y: startY - el.getBoundingClientRect().top };
    let started = false;

    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        this.drag = { it };
        el.classList.add('dragging');
        el.setPointerCapture?.(e.pointerId);
        it.fx.set(0);
        it.fy.set(0);
      }
      this.#dragTo(it, ev, grab);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (started) this.#drop(it);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.setPointerCapture?.(e.pointerId);
  }

  #dragTo(it, ev, grab) {
    const horizontal = this.axis === 'x';
    const el = it.el;
    const siblings = [...this.container.children].filter((c) => c !== el && !this.items.get(c.dataset.id)?.leaving);

    // Where should the dragged tab sit? Compare its centre with each neighbour's natural centre.
    const rect = el.getBoundingClientRect();
    const center = horizontal ? ev.clientX - grab.x + rect.width / 2 : ev.clientY - grab.y + rect.height / 2;
    let target = null;
    for (const s of siblings) {
      const sit = this.items.get(s.dataset.id);
      const r = s.getBoundingClientRect();
      const mid = horizontal ? r.left - sit.dx + r.width / 2 : r.top - sit.dy + r.height / 2;
      if (center < mid) {
        target = s;
        break;
      }
    }
    const current = el.nextElementSibling;
    const nextSkipping = (n) => {
      while (n && this.items.get(n.dataset?.id)?.leaving) n = n.nextElementSibling;
      return n;
    };
    if (nextSkipping(current) !== target) {
      const before = this.#measure(it);
      this.container.insertBefore(el, target);
      this.#flip(before, it);
    }

    // Follow the pointer along the axis, measured from the natural (untransformed) position.
    const r2 = el.getBoundingClientRect();
    if (horizontal) {
      it.dragX = ev.clientX - grab.x - (r2.left - (it.dragX ?? 0));
      it.dragY = 0;
    } else {
      it.dragY = ev.clientY - grab.y - (r2.top - (it.dragY ?? 0));
      it.dragX = 0;
    }
    this.#applyTransform(it);
  }

  #drop(it) {
    const el = it.el;
    const ordered = [...this.container.children].filter((c) => !this.items.get(c.dataset.id)?.leaving);
    const index = ordered.indexOf(el);
    // Hand the leftover pointer offset to the spring so the tab settles into its slot.
    const dx = it.dragX ?? 0;
    const dy = it.dragY ?? 0;
    it.dragX = it.dragY = 0;
    it.dx = dx;
    it.dy = dy;
    it.fx.value = dx;
    it.fy.value = dy;
    it.fx.onSettle = it.fy.onSettle = () => el.classList.remove('dragging');
    it.fx.to(0);
    it.fy.to(0);
    if (!dx && !dy) el.classList.remove('dragging');
    this.drag = null;
    this.onMove(it.info.id, index);
    if (this.pending) this.render(this.pending.tabs, this.pending.activeId);
  }
}
