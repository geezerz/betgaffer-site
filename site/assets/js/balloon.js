// The floating accuracy ring (spec §6, §15). Browser module, loaded on / and every day page; the
// build puts the figures on <main> (data-ring-* for the shown day, data-yday-* for the day before).
//
// One design at every width. From 1024 px: the large ring, today then yesterday. Below: the same
// ring at ~64 px with today's figure and fraction only, and not shown at all while nothing is graded
// (the day header's static ring already says "No results yet"). Both sizes:
//   - drag anywhere with pointer events + setPointerCapture; movement is transform-only during the
//     gesture (composited, no layout per frame) and commits to left/top once, on release;
//   - a tap or click (movement within 4 px) opens Our Record; the click that ends a real drag does
//     not; a keyboard activation never is swallowed;
//   - the position is saved only after a real drag, per size (bg.balloon.pos / bg.balloon.pos.sm),
//     restored with Number.isFinite checks and RE-CLAMPED to the current viewport on load, resize,
//     orientation change and when the sticky header or the card changes size — a spot saved on a
//     larger screen would otherwise restore off-screen with no way to drag it back;
//   - never above the sticky header + toolbar; where the viewport has no room below them, hidden.
// Until the visitor drags it, the CSS default anchor is in charge (desktop: top right under the
// toolbar; phone: bottom right above the safe area) and no coordinate is written.
//
// The figures are validated first and anything invalid draws nothing (fail closed). Everything is
// built with DOM calls and textContent; the arc is the --pct custom property set through CSSOM
// (style.setProperty), never a style attribute — allowed under style-src 'self'.
//
// Imports resolve to /assets/js/lib/ (the build copies the isomorphic modules there).

import {
  GAP, NOMINAL, PAD, clamp, msToLagosMidnight, readFigures, ringModel, sizeClass, storageKey,
} from './lib/balloon-model.js';

/** Pointer travel (px) that turns a press into a drag: a steady-handed click still moves a pixel or two. */
export const MOVED = 4;

/** window.localStorage, or null where reading the property itself throws (blocked storage). */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A stored position: {left, top} of finite, sane numbers, else null (never throws). */
export function readPos(storage, key) {
  let raw;
  try {
    raw = storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw.length > 200) return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const { left, top } = v;
  if (!Number.isFinite(left) || !Number.isFinite(top) || Math.abs(left) > 1e6 || Math.abs(top) > 1e6) return null;
  return { left, top };
}

function writePos(storage, key, pos) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(pos));
  } catch {
    // Not remembered (blocked or full storage); the ring stays where it was put for this view.
  }
}

function span(doc, cls, text) {
  const e = doc.createElement('span');
  e.className = cls;
  if (text !== null) e.textContent = text;
  return e;
}

/** The ring's inner content for one model and size. */
function content(doc, m, compact) {
  const inner = span(doc, 'bg-balloon__inner', null);
  const lines = [];
  if (m.state === 'none') {
    lines.push(span(doc, 'bg-balloon__none', m.label), span(doc, 'bg-balloon__label', m.dayText));
  } else if (m.state === 'perfect' || m.pctText === null) {
    // No percentage: the fraction is the figure.
    lines.push(span(doc, 'bg-balloon__pct bg-balloon__pct--frac', m.fracText));
    if (m.state === 'perfect') {
      const landed = span(doc, 'bg-balloon__landed', null);
      landed.append(span(doc, 'bg-balloon__w', 'landed'), ' ', span(doc, 'bg-balloon__w', 'so far'));
      lines.push(landed);
    }
    if (!compact) lines.push(span(doc, 'bg-balloon__label', m.dayText));
  } else {
    lines.push(span(doc, 'bg-balloon__pct', `${m.pctText}%`));
    if (!compact) lines.push(span(doc, 'bg-balloon__label', m.dayText));
    lines.push(span(doc, 'bg-balloon__frac', m.fracText));
  }
  if (m.yday) {
    const prev = span(doc, 'bg-balloon__prev', null);
    prev.append(span(doc, 'bg-balloon__prev-day', m.yday.dayText));
    if (m.yday.pctText !== null) {
      prev.append(span(doc, 'bg-balloon__prev-pct', `${m.yday.pctText}%`), span(doc, 'bg-balloon__prev-frac', m.yday.fracText));
    } else {
      prev.append(span(doc, 'bg-balloon__prev-pct', m.yday.fracText));
    }
    lines.push(prev);
  }
  inner.append(...lines);
  return inner;
}

/**
 * Build the ring and wire it. Every dependency is injectable (tests drive it with a fake DOM); in
 * the browser it runs with the defaults. Returns null when the page carries no valid figures.
 */
export function init({
  doc = globalThis.document,
  win = globalThis.window,
  storage = defaultStorage(),
  raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  cancelRaf = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  ResizeObserver: RO = globalThis.ResizeObserver,
} = {}) {
  if (!doc || !win || !doc.body || !doc.documentElement) return null;
  const main = doc.querySelector('main');
  if (!main || doc.querySelector('.bg-balloon')) return null;
  const figures = readFigures((name) => main.getAttribute(`data-${name}`));
  if (!figures) return null;

  const html = doc.documentElement;
  const el = doc.createElement('a');
  el.className = 'bg-balloon';
  el.href = '/our-record/';
  // A link starts the browser's own drag on pointerdown, which would cancel this pointer stream.
  el.setAttribute('draggable', 'false');
  el.setAttribute('data-figure', 'ring');
  el.hidden = true;
  doc.body.append(el);

  let size = sizeClass(win.innerWidth);
  let hasContent = false;
  let pos = null; // the committed (dragged or restored) position for this size; null = CSS anchor

  function render() {
    const compact = size === 'compact';
    const m = ringModel(figures.today, {
      date: figures.today.date, yesterday: figures.yesterday, compact, nowMs: now(),
    });
    hasContent = !(compact && m.state === 'none');
    el.setAttribute('data-size', size);
    el.setAttribute('data-state', m.state);
    el.setAttribute('aria-label', m.aria);
    // "240 of 290" is wider than the small ring's chord at the usual size.
    if (m.fracText !== null && m.fracText.length > 8) el.setAttribute('data-long', '');
    else el.removeAttribute('data-long');
    if (m.arc === null) {
      el.removeAttribute('data-arc');
      el.style.removeProperty('--pct');
    } else {
      el.setAttribute('data-arc', '');
      el.style.setProperty('--pct', String(m.arc));
    }
    el.replaceChildren(content(doc, m, compact));
  }

  function show(on) {
    if (el.hidden === on) el.hidden = !on;
    html.classList.toggle('has-balloon', on);
  }

  /** The floor: the bottom of the sticky header, plus the sticky toolbar when it is shown. */
  function minTop() {
    const bar = doc.querySelector('.bg-topbar');
    const barBottom = bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    const tools = doc.querySelector('[data-day-tools]');
    const toolsH = tools && !tools.hidden && Number.isFinite(tools.offsetHeight) ? tools.offsetHeight : 0;
    return Math.max(0, Number.isFinite(barBottom) ? barBottom : 0) + toolsH + GAP;
  }

  function box() {
    return {
      vw: win.innerWidth,
      vh: win.innerHeight,
      w: el.offsetWidth || NOMINAL[size],
      h: el.offsetHeight || NOMINAL[size],
      minTop: minTop(),
      pad: PAD,
    };
  }

  function setXY(left, top) {
    el.style.setProperty('left', `${left}px`);
    el.style.setProperty('top', `${top}px`);
    // The default anchors are right/bottom or right/top: release both, or the ring stretches.
    el.style.setProperty('right', 'auto');
    el.style.setProperty('bottom', 'auto');
  }

  function clearXY() {
    for (const k of ['left', 'top', 'right', 'bottom']) el.style.removeProperty(k);
  }

  /** Position and show (or hide) the ring for the current size and viewport. */
  function place() {
    if (!hasContent) {
      show(false);
      return;
    }
    let b;
    try {
      b = box();
      if (pos) {
        const c = clamp(pos, b);
        if (c.fits) setXY(Math.round(c.left), Math.round(c.top));
        show(c.fits);
        return;
      }
      show(clamp({ left: b.vw, top: b.vh }, b).fits);
    } catch {
      show(false); // an unmeasurable viewport: nothing rather than a misplaced ring
    }
  }

  function restore() {
    pos = readPos(storage, storageKey(size));
    if (!pos) clearXY();
  }

  render();
  restore();
  place();

  // ---- drag
  let dragging = false;
  let moved = false;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let dx = 0;
  let dy = 0;
  let dragBox = null;
  let pending = null;
  let frame = 0;

  function step(e) {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    if (Math.abs(e.clientX - startX) > MOVED || Math.abs(e.clientY - startY) > MOVED) moved = true;
    const c = clamp({ left: startLeft + (e.clientX - startX), top: startTop + (e.clientY - startY) }, dragBox);
    dx = c.left - startLeft;
    dy = c.top - startTop;
    el.style.setProperty('transform', `translate3d(${dx}px,${dy}px,0)`);
  }

  function flush() {
    frame = 0;
    if (!dragging || !pending) return;
    const e = pending;
    pending = null;
    step(e);
  }

  el.addEventListener('pointerdown', (e) => {
    // Primary button only: a right-click drag loses its pointerup to the context menu.
    if (e.button !== 0 || e.isPrimary === false || dragging) return;
    const r = el.getBoundingClientRect();
    try {
      dragBox = box();
    } catch {
      return;
    }
    dragging = true;
    moved = false;
    suppressClick = false;
    dx = 0;
    dy = 0;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;
    el.classList.add('is-dragging');
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // No capture (an already-released pointer): the drag still follows while over the ring.
    }
  });

  // A mouse reports far faster than the screen redraws: keep the latest event, work once a frame.
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pending = e;
    if (!frame) frame = raf(flush);
  }, { passive: true });

  function end(e) {
    if (!dragging) return;
    dragging = false;
    if (frame) {
      cancelRaf(frame);
      frame = 0;
    }
    // A release before the next frame still counts its movement (a fast flick is a drag, not a click).
    if (pending) step(pending);
    else if (e && e.type === 'pointerup') step(e);
    pending = null;
    el.classList.remove('is-dragging');
    el.style.removeProperty('transform');
    suppressClick = moved;
    if (!moved) return; // a click: the anchor and the stored position are untouched
    pos = { left: Math.round(startLeft + dx), top: Math.round(startTop + dy) };
    setXY(pos.left, pos.top);
    writePos(storage, storageKey(size), pos);
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);

  el.addEventListener('click', (e) => {
    // detail 0: a keyboard activation, never the tail of a drag.
    if (suppressClick && e.detail !== 0) e.preventDefault();
    suppressClick = false;
  });

  // ---- re-clamp: resize / orientation change / the sticky stack or the card changing size
  let relayoutFrame = 0;
  function relayout() {
    if (relayoutFrame) return;
    relayoutFrame = raf(() => {
      relayoutFrame = 0;
      if (dragging) return; // the release commits; the next change re-clamps
      const s = sizeClass(win.innerWidth);
      if (s !== size) {
        size = s;
        render();
        restore();
      }
      place();
    });
  }
  if (typeof win.addEventListener === 'function') {
    win.addEventListener('resize', relayout, { passive: true });
    win.addEventListener('orientationchange', relayout, { passive: true });
  }
  if (typeof RO === 'function') {
    try {
      const ro = new RO(relayout);
      const bar = doc.querySelector('.bg-topbar');
      if (bar) ro.observe(bar);
      ro.observe(main);
    } catch {
      // No observer: resize still re-clamps.
    }
  }

  // ---- the day word ("Today") is the visitor's date: re-render at each Lagos midnight.
  const midnight = () => setTimer(() => {
    try {
      render();
      place();
    } catch {
      show(false);
    }
    midnight();
  }, msToLagosMidnight(now()) + 500);
  midnight();

  return {
    el,
    get size() { return size; },
    get custom() { return pos !== null; },
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => {
    try {
      init();
    } catch {
      // The day header's static ring still carries the figure.
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
