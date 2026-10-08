// A minimal, hand-rolled fake DOM for driving the browser modules' init() in Node (no jsdom: the
// repo has no dependencies). It is built from tests/html-scan.js's strict parse of REAL built
// pages, and supports exactly what stale.js, day.js, predictions.js and their tests use: single
// compound selectors (tag, .class, #id, [attr], [attr="v"]), dataset, attributes, hidden,
// textContent, innerHTML (set), append, before, replaceChildren, remove, createElement, classList,
// style.setProperty (CSSOM: never a style attribute), value/checked, focus, events dispatched on
// their target only (no bubbling: the modules listen on the element itself), <dialog>
// showModal/close, scrollIntoView (recorded), a ResizeObserver stub, and for balloon.js: a
// test-assigned layout box (getBoundingClientRect / offsetWidth), recorded pointer capture and
// serialize() back to HTML.

import { parse } from './html-scan.js';

const camelToData = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** A minimal Event: type, target, preventDefault. */
export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.target = null;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

/** Dispatch a FakeEvent of `type` on `el` (extra fields from init, e.g. { key: 'Escape' }). */
export function fire(el, type, init = {}) {
  const ev = new FakeEvent(type, init);
  el.dispatchEvent(ev);
  return ev;
}

/** ResizeObserver stand-in: records observed targets; trigger() runs the callback. */
export class FakeResizeObserver {
  constructor(cb) {
    this.cb = cb;
    this.targets = [];
    FakeResizeObserver.last = this;
  }
  observe(el) { this.targets.push(el); }
  unobserve(el) { this.targets = this.targets.filter((t) => t !== el); }
  disconnect() { this.targets = []; }
  trigger() { this.cb(this.targets.map((target) => ({ target })), this); }
}

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.data = text;
    this.parentNode = null;
  }
  get textContent() { return this.data; }
}

const SEL_RE = /^([a-z][a-z0-9-]*)?((?:\.[\w-]+|#[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i;
const PART_RE = /\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;

function compile(sel) {
  const m = SEL_RE.exec(sel.trim());
  if (!m) throw new Error(`fake-dom: unsupported selector ${JSON.stringify(sel)}`);
  const tag = m[1] ? m[1].toLowerCase() : null;
  const parts = [...(m[2] ?? '').matchAll(PART_RE)];
  return (el) => {
    if (tag && el.localName !== tag) return false;
    return parts.every(([, cls, id, attr, val]) => {
      if (cls) return (el.getAttribute('class') ?? '').split(/\s+/).includes(cls);
      if (id) return el.getAttribute('id') === id;
      if (val !== undefined) return el.getAttribute(attr) === val;
      return el.hasAttribute(attr);
    });
  };
}

export class FakeElement {
  constructor(tag, attrs = {}, ownerDocument = null) {
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.attrs = { ...attrs };
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.listeners = {};
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? self.getAttribute(camelToData(k)) ?? undefined : undefined),
      set: (_, k, v) => { self.setAttribute(camelToData(k), v); return true; },
      has: (_, k) => self.hasAttribute(camelToData(k)),
    });
  }

  getAttribute(n) { return Object.hasOwn(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return Object.hasOwn(this.attrs, n); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get type() { return this.getAttribute('type') ?? ''; }
  set type(v) { this.setAttribute('type', v); }
  get value() { return this._value ?? this.getAttribute('value') ?? ''; }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked ?? this.hasAttribute('checked'); }
  set checked(v) { this._checked = Boolean(v); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get open() { return this.hasAttribute('open'); }
  get classList() {
    const get = () => this.className.split(/\s+/).filter(Boolean);
    const put = (list) => this.setAttribute('class', list.join(' '));
    return {
      contains: (c) => get().includes(c),
      add: (...cs) => put([...new Set([...get(), ...cs])]),
      remove: (...cs) => put(get().filter((x) => !cs.includes(x))),
      toggle: (c, force) => {
        const on = force === undefined ? !get().includes(c) : Boolean(force);
        if (on) put([...new Set([...get(), c])]); else put(get().filter((x) => x !== c));
        return on;
      },
    };
  }
  /** CSSOM only: custom properties land here, never in a style attribute. */
  get style() {
    if (!this._style) {
      const props = new Map();
      this._style = {
        props,
        setProperty: (k, v) => { props.set(k, String(v)); },
        getPropertyValue: (k) => props.get(k) ?? '',
        removeProperty: (k) => { props.delete(k); },
      };
    }
    return this._style;
  }
  get offsetHeight() { return this._offsetHeight ?? 0; }
  set offsetHeight(v) { this._offsetHeight = v; }
  get offsetWidth() { return this._offsetWidth ?? 0; }
  set offsetWidth(v) { this._offsetWidth = v; }
  /** Layout box: whatever a test assigns to _rect (zeros otherwise; the fake has no layout). */
  getBoundingClientRect() {
    const r = this._rect ?? {};
    const left = r.left ?? 0;
    const top = r.top ?? 0;
    const width = r.width ?? (r.right !== undefined ? r.right - left : 0);
    const height = r.height ?? (r.bottom !== undefined ? r.bottom - top : 0);
    return { left, top, width, height, right: r.right ?? left + width, bottom: r.bottom ?? top + height, x: left, y: top };
  }
  /** Pointer capture, recorded: the id last captured (null once released). */
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture(id) { if (this.captured === id) this.captured = null; }
  hasPointerCapture(id) { return this.captured === id; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  scrollIntoView(opts) { (this.scrolls ??= []).push(opts); }
  /** <dialog>: open + focus the [autofocus] descendant (else the dialog), as the dialog focusing steps do. */
  showModal() {
    if (this.open) throw new Error('InvalidStateError: the dialog is already open');
    this.setAttribute('open', '');
    (this.querySelector('[autofocus]') ?? this).focus();
  }
  close() {
    if (!this.open) return;
    this.removeAttribute('open');
    fire(this, 'close');
  }
  get href() { return this.getAttribute('href') ?? ''; }
  set href(v) { this.setAttribute('href', v); }
  get rel() { return this.getAttribute('rel') ?? ''; }
  set rel(v) { this.setAttribute('rel', v); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }

  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  set innerHTML(html) { this.replaceChildren(...fromTree(parse(html), this.ownerDocument).childNodes.slice()); }

  #adopt(n) {
    const node = typeof n === 'string' ? new FakeText(n) : n;
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { for (const n of nodes) this.childNodes.push(this.#adopt(n)); }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  before(...nodes) {
    const p = this.parentNode;
    if (!p) return;
    for (const n of nodes) {
      const node = this.#adopt(n);
      node.parentNode = p;
      p.childNodes.splice(p.childNodes.indexOf(this), 0, node);
    }
  }
  remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    ev.currentTarget = this;
    for (const fn of [...(this.listeners[ev.type] ?? [])]) fn.call(this, ev);
    return !ev.defaultPrevented;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }

  querySelectorAll(sel) {
    const match = compile(sel);
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (match(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

function fromTree(node, doc) {
  const el = new FakeElement(node.tag === '#root' ? 'fragment' : node.tag, node.attrs, doc);
  for (const c of node.children) {
    if (c.tag === undefined) el.append(new FakeText(c.text));
    else el.append(fromTree(c, doc));
  }
  return el;
}

const escText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttrVal = (t) => escText(t).replace(/"/g, '&quot;');

/** Serialise a fake node back to HTML (a test feeds the result to the claim scanner). */
export function serialize(node) {
  if (node.nodeType === 3) return escText(node.data);
  const attrs = Object.entries(node.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttrVal(v)}"`)).join('');
  return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

/** A fake `document` for a full HTML page. */
export function fakeDocument(html) {
  const doc = {
    readyState: 'complete',
    createElement: (tag) => new FakeElement(tag, {}, doc),
    getElementById: (id) => doc.root.querySelector(`#${id}`),
    querySelector: (s) => doc.root.querySelector(s),
    querySelectorAll: (s) => doc.root.querySelectorAll(s),
    addEventListener: () => {},
    activeElement: null,
  };
  doc.root = fromTree(parse(html), doc);
  doc.documentElement = doc.root.querySelector('html');
  doc.body = doc.root.querySelector('body');
  doc.activeElement = doc.body;
  return doc;
}
