// One consistent icon family: 16px grid, 1.4px round strokes, currentColor. Static trusted markup only.

const wrap = (body, extra = '') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

const STAR = 'M8 2.2l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.8l-3.4 1.9.7-3.8L2.5 6.2l3.8-.5z';

export const ICONS = {
  back: wrap('<path d="M9.5 3.5 5 8l4.5 4.5"/>'),
  forward: wrap('<path d="M6.5 3.5 11 8l-4.5 4.5"/>'),
  reload: wrap('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.6h-2.6"/>'),
  close: wrap('<path d="m4 4 8 8M12 4l-8 8"/>'),
  plus: wrap('<path d="M8 3.5v9M3.5 8h9"/>'),
  star: wrap(`<path d="${STAR}"/>`),
  starFilled: wrap(`<path d="${STAR}" fill="currentColor"/>`),
  sidebar: wrap('<rect x="2" y="3" width="12" height="10" rx="2.2"/><path d="M6 3v10"/>'),
  more: wrap('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
  sliders: wrap('<path d="M2.5 5h5M11.5 5h2M2.5 11h2M8.5 11h5"/><circle cx="9.5" cy="5" r="1.6"/><circle cx="6.5" cy="11" r="1.6"/>'),
  globe: wrap('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2.2 1.9 2.2 9.1 0 11M8 2.5c-2.2 1.9-2.2 9.1 0 11"/>'),
  search: wrap('<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>'),
  puzzle: wrap('<path d="M6 2.5h-3v4a2 2 0 1 0 0 3v4h4a2 2 0 1 1 3 0h3v-4a2 2 0 1 0 0-3v-4h-4a2 2 0 1 0-3 0z"/>'),
  clock: wrap('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>'),
  lock: wrap('<rect x="3.8" y="7" width="8.4" height="6" rx="1.6"/><path d="M5.7 7V5.5a2.3 2.3 0 0 1 4.6 0V7"/>'),
  info: wrap('<circle cx="8" cy="8" r="5.5"/><path d="M8 7.4v3.2M8 5.3v.1"/>'),
  pin: wrap('<path d="M6 2.8h4l-.5 3.6 2 2H4.5l2-2z"/><path d="M8 8.4v4.8"/>'),
  check: wrap('<path d="m3.5 8.5 3 3 6-6.5"/>'),
  bookmark: wrap('<path d="M4 2.8h8v10.4L8 10.8l-4 2.4z"/>'),
  warning: wrap('<path d="M8 3 13.5 12.5h-11z"/><path d="M8 7v2.6M8 11.2v.1"/>'),
};

/** Parse trusted icon markup into an element. */
export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstElementChild;
}
