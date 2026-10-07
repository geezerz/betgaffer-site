// HTML escaping. ISOMORPHIC: imported by the build and served to the browser for the archive.
// Every interpolated value in generated HTML goes through escHtml (text) or escAttr (attribute).
//
// Accepted inputs: string, number, null/undefined (-> ''). Anything else throws a TypeError: an
// object reaching a template is a bug, and String(obj) would hide it behind "[object Object]" or
// run an attacker-shaped toString().

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RE = /[&<>"']/g;

function esc(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') {
    throw new TypeError(`esc: refusing to interpolate a ${Array.isArray(v) ? 'array' : typeof v}`);
  }
  return v.replace(RE, (c) => MAP[c]);
}

/** Escape for HTML text content. */
export function escHtml(v) {
  return esc(v);
}

/** Escape for a double- or single-quoted HTML attribute value. */
export function escAttr(v) {
  return esc(v);
}
