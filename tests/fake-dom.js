// A minimal, hand-rolled fake DOM for driving the browser modules' init() in Node (no jsdom: the
// repo has no dependencies). It is built from tests/html-scan.js's strict parse of REAL built
// pages, and supports exactly what stale.js, day.js and their tests use: single compound
// selectors (tag, .class, #id, [attr], [attr="v"]), dataset, attributes, hidden, textContent,
// innerHTML (set), append, replaceChildren, remove, createElement.

import { parse } from './html-scan.js';

const camelToData = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

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
  remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }

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

/** A fake `document` for a full HTML page. */
export function fakeDocument(html) {
  const doc = {
    readyState: 'complete',
    createElement: (tag) => new FakeElement(tag, {}, doc),
    getElementById: (id) => doc.root.querySelector(`#${id}`),
    querySelector: (s) => doc.root.querySelector(s),
    querySelectorAll: (s) => doc.root.querySelectorAll(s),
    addEventListener: () => {},
  };
  doc.root = fromTree(parse(html), doc);
  return doc;
}
