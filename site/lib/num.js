// Whole numbers as a visitor reads them. ISOMORPHIC: imported by the build and served to the browser
// (assets/js/lib/num.js); no imports, no Node built-ins, no Intl and no toLocaleString — the build
// host's and the visitor's locale data must never change what a page says.
//
// This is the ONE formatter (tests/num.test.js): every count on the site goes through fmtInt, so a
// count of four or more digits always carries thousands separators (1,114 · 10,081). Attributes
// scripts read back (data-*) keep the raw integer and never come here.

/** 1114 -> '1,114'; 999 -> '999'. Only a whole number: anything else throws rather than print a guess. */
export function fmtInt(n) {
  if (!Number.isSafeInteger(n)) throw new TypeError(`fmtInt: not a whole number: ${typeof n === 'bigint' ? `${n}n` : String(n)}`);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '1 fixture', '1,114 fixtures'. */
export function plural(n, one, many) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
