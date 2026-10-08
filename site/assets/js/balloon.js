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
//   - never above the floor: the sticky header, or the sticky toolbar while it is stuck under it
//     (re-checked on scroll); where the viewport has no room below the floor, hidden.
// Until the visitor drags it, the ring starts top right (operator, 2026-10-08): right from the CSS
// (12px / 24px in, plus the right safe area), top = just below the header — or below the founding
// banner while it is on screen, so its close button stays tappable — written through CSSOM.
// While the ring is shown, <html> carries has-balloon and the CSS hides the day header's static
// ring (the same figure); without JS, or with the ring hidden, the static ring stays.
//
// The figures are validated first and anything invalid draws nothing (fail closed). Everything is
// built with DOM calls and textContent; the arc is the --pct custom property set through CSSOM
// (style.setProperty), never a style attribute — allowed under style-src 'self'.
//
// Imports resolve to /assets/js/lib/ (the build copies the isomorphic modules there).

import {
  NOMINAL, PAD, clamp, defaultTop, floorTop, msToLagosMidnight, readFigures, ringModel, sizeClass, storageKey,
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

  /** The bottom of the sticky header (px from the viewport top). */
  function barBottom() {
    const bar = doc.querySelector('.bg-topbar');
    const b = bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    return Number.isFinite(b) ? Math.max(0, b) : 0;
  }
  /** The floor: under the header, or under the toolbar while it is stuck there. */
  function minTop() {
    const tools = doc.querySelector('[data-day-tools]');
    const r = tools && !tools.hidden ? tools.getBoundingClientRect() : null;
    return floorTop(barBottom(), r && r.height > 0 ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null);
  }
  /** The founding banner's bottom while it is in the page and displayed, else null. */
  function bannerBottom() {
    const banner = doc.querySelector('[data-banner]');
    if (!banner || banner.hidden) return null;
    const r = banner.getBoundingClientRect();
    return r.height > 0 && Number.isFinite(r.bottom) ? Math.round(r.bottom) : null;
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

  // Inline-style writes only when the value changes (relayout runs once a frame while scrolling).
  function put(k, v) {
    if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
  }
  function drop(k) {
    if (el.style.getPropertyValue(k) !== '') el.style.removeProperty(k);
  }

  function setXY(left, top) {
    put('left', `${left}px`);
    put('top', `${top}px`);
    // The CSS anchor is right/top: release right (and bottom), or the ring stretches.
    put('right', 'auto');
    put('bottom', 'auto');
  }

  function clearXY() {
    for (const k of ['left', 'top', 'right', 'bottom']) drop(k);
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
      // Not dragged: right from the CSS anchor, top just below the header (or the banner).
      const c = clamp({ left: b.vw, top: defaultTop({ barBottom: barBottom(), bannerBottom: bannerBottom(), floor: b.minTop }) }, b);
      if (c.fits) {
        for (const k of ['left', 'right', 'bottom']) drop(k);
        put('top', `${Math.round(c.top)}px`);
      }
      show(c.fits);
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
    if (moved) {
      pos = { left: Math.round(startLeft + dx), top: Math.round(startTop + dy) };
      setXY(pos.left, pos.top);
      writePos(storage, storageKey(size), pos);
    } // else a click: the anchor and the stored position are untouched
    relayout(); // catch up with anything skipped while dragging (a resize, the sticky stack)
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
    // The toolbar sticks (raising the floor) and the banner scrolls away only as the page scrolls.
    // Once a frame: measure, then write only what changed. A parked ring above the floor (the stuck
    // toolbar) is shown below it; the stored position is never rewritten, so it returns there.
    win.addEventListener('scroll', relayout, { passive: true });
  }
  if (typeof RO === 'function') {
    try {
      const ro = new RO(relayout);
      const bar = doc.querySelector('.bg-topbar');
      if (bar) ro.observe(bar);
      ro.observe(main);
      const banner = doc.querySelector('[data-banner]');
      if (banner) ro.observe(banner);
    } catch {
      // No observer: resize still re-clamps.
    }
  }

  // Dismissing the banner (banner.js removes it on this click) frees the space under the header;
  // the relayout runs on the next frame, after the removal.
  const close = doc.querySelector('[data-banner-close]');
  if (close) close.addEventListener('click', relayout);

  // ---- the day word ("Today") is the visitor's date: re-render at each Lagos midnight.
  const midnight = (ms = msToLagosMidnight(now()) + 500) => setTimer(() => {
    // Never rebuild the ring under a live pointer: try again a second later.
    if (dragging) {
      midnight(1000);
      return;
    }
    try {
      render();
      place();
    } catch {
      show(false);
    }
    midnight();
  }, ms);
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
